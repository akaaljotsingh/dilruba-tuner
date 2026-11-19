import { PeakClass } from '../models/spectrum-result.model';
import { FftAnalyzer, parabolicPeak } from './fft-analyzer';

/** Fixed-capacity structure-of-arrays peak list (allocation-free on the audio thread). */
export class PeakSet {
  count = 0;
  readonly frequency: Float64Array;
  readonly db: Float64Array;
  readonly snr: Float64Array;
  readonly intensity: Float64Array;
  readonly cls: Uint8Array;
  readonly harmonic: Uint8Array;

  constructor(readonly capacity: number) {
    this.frequency = new Float64Array(capacity);
    this.db = new Float64Array(capacity);
    this.snr = new Float64Array(capacity);
    this.intensity = new Float64Array(capacity);
    this.cls = new Uint8Array(capacity);
    this.harmonic = new Uint8Array(capacity);
  }

  clear(): void {
    this.count = 0;
  }

  swap(a: number, b: number): void {
    if (a === b) return;
    let t = this.frequency[a];
    this.frequency[a] = this.frequency[b];
    this.frequency[b] = t;
    t = this.db[a];
    this.db[a] = this.db[b];
    this.db[b] = t;
    t = this.snr[a];
    this.snr[a] = this.snr[b];
    this.snr[b] = t;
    t = this.intensity[a];
    this.intensity[a] = this.intensity[b];
    this.intensity[b] = t;
    t = this.cls[a];
    this.cls[a] = this.cls[b];
    this.cls[b] = t;
    t = this.harmonic[a];
    this.harmonic[a] = this.harmonic[b];
    this.harmonic[b] = t;
  }

  sortByFrequency(): void {
    for (let i = 1; i < this.count; i++) {
      let j = i;
      while (j > 0 && this.frequency[j - 1] > this.frequency[j]) {
        this.swap(j - 1, j);
        j--;
      }
    }
  }
}

export interface FrequencyAnalyzerOptions {
  /** Lowest frequency considered for peaks (Hz). */
  minFrequency: number;
  /** Highest frequency considered for peaks (Hz) – include room for harmonics. */
  maxFrequency: number;
  /** Peaks must exceed the noise floor by this many dB. */
  marginDb: number;
  /** Peaks must also exceed this absolute level (dBFS). */
  absoluteFloorDb: number;
  /** A peak must stand this many dB above the lowest point of its ±4-bin neighbourhood. */
  prominenceDb: number;
  /** Dynamic range (dB) never shrinks below this when normalising intensity. */
  minDynamicRangeDb: number;
  /** How fast the intensity reference level decays (dB/s) after loud passages. */
  referenceDecayDbPerSecond: number;
  /** Noise-floor percentile (0–1) of in-range bins. */
  floorPercentile: number;
}

export const DEFAULT_FREQUENCY_ANALYZER_OPTIONS: FrequencyAnalyzerOptions = {
  minFrequency: 50,
  maxFrequency: 5000,
  marginDb: 14,
  absoluteFloorDb: -100,
  prominenceDb: 6,
  minDynamicRangeDb: 30,
  referenceDecayDbPerSecond: 6,
  floorPercentile: 0.5,
};

/**
 * Spectral analysis for the Sur Spectrum: FFT → dB → noise-floor estimate →
 * prominent-peak picking with parabolic interpolation → relative intensity.
 * Harmonic classification is done separately by {@link HarmonicAnalyzer}.
 */
export class FrequencyAnalyzer {
  readonly fft: FftAnalyzer;
  readonly peaks: PeakSet;
  /** Smoothed noise floor in dBFS. */
  noiseFloorDb = -100;
  /** Wiener entropy of the in-range spectrum: ≈0 tonal, ≈1 white noise. */
  spectralFlatness = 0;
  /** Upper end of the normalisation range (peak-hold of the strongest peak). */
  referenceDb = -60;

  private options: FrequencyAnalyzerOptions;
  private readonly scratch: Float32Array;
  private readonly interp = new Float64Array(1);
  private floorInitialised = false;

  constructor(
    sampleRate: number,
    fftSize: number,
    maxPeaks = 32,
    options: Partial<FrequencyAnalyzerOptions> = {},
  ) {
    this.fft = new FftAnalyzer(fftSize, sampleRate);
    this.peaks = new PeakSet(maxPeaks);
    this.options = { ...DEFAULT_FREQUENCY_ANALYZER_OPTIONS, ...options };
    this.scratch = new Float32Array(this.fft.binCount);
  }

  configure(options: Partial<FrequencyAnalyzerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  get currentOptions(): Readonly<FrequencyAnalyzerOptions> {
    return this.options;
  }

  reset(): void {
    this.floorInitialised = false;
    this.noiseFloorDb = -100;
    this.referenceDb = -60;
    this.peaks.clear();
  }

  /** Threshold peaks currently need to exceed (dBFS). */
  get thresholdDb(): number {
    return Math.max(this.noiseFloorDb + this.options.marginDb, this.options.absoluteFloorDb);
  }

  analyze(samples: ArrayLike<number>, dtSeconds: number): PeakSet {
    const o = this.options;
    const db = this.fft.analyze(samples);
    const binHz = this.fft.binHz;
    const minBin = Math.max(7, Math.floor(o.minFrequency / binHz));
    const maxBin = Math.min(this.fft.binCount - 8, Math.ceil(o.maxFrequency / binHz));
    const peaks = this.peaks;
    peaks.clear();
    if (maxBin <= minBin) return peaks;

    // --- noise floor & flatness ------------------------------------------
    const count = maxBin - minBin + 1;
    let logSum = 0;
    let linSum = 0;
    for (let k = minBin, i = 0; k <= maxBin; k++, i++) {
      const v = db[k];
      this.scratch[i] = v;
      logSum += v;
      linSum += Math.pow(10, v / 10);
    }
    const geo = Math.pow(10, logSum / count / 10);
    const arith = linSum / count;
    this.spectralFlatness = arith > 0 ? Math.min(1, geo / arith) : 0;

    const frameFloor = quickSelect(this.scratch, count, Math.floor(count * o.floorPercentile));
    if (!this.floorInitialised) {
      this.noiseFloorDb = frameFloor;
      this.floorInitialised = true;
    } else {
      // Fall quickly, rise slowly.
      const tc = frameFloor < this.noiseFloorDb ? 0.15 : 2.0;
      this.noiseFloorDb += (frameFloor - this.noiseFloorDb) * (1 - Math.exp(-dtSeconds / tc));
    }

    // --- peak picking -------------------------------------------------------
    const threshold = this.thresholdDb;
    const cap = peaks.capacity;
    for (let k = minBin; k <= maxBin; k++) {
      const v = db[k];
      if (v <= threshold) continue;
      if (!(v > db[k - 1] && v >= db[k + 1])) continue;
      // Two-sided prominence: a genuine partial dips on both sides, even when it sits
      // on the flank of a much louder neighbour (adjacent semitones at low pitch).
      const leftMin = Math.min(db[k - 1], db[k - 2], db[k - 3]);
      const rightMin = Math.min(db[k + 1], db[k + 2], db[k + 3]);
      const shallow = v - Math.max(leftMin, rightMin);
      const deep = v - Math.min(leftMin, rightMin);
      if (shallow < o.prominenceDb * 0.5 || deep < o.prominenceDb) continue;
      // Window sidelobe guard. Hann sidelobes sit ≥ 31 dB below their main lobe and
      // fall off further with distance, so the allowed level gap grows with distance.
      let sidelobe = false;
      for (let d = 2; d <= 6 && !sidelobe; d++) {
        const allowed = 28 + 6 * (d - 2);
        if (db[k - d] - v > allowed || db[k + d] - v > allowed) sidelobe = true;
      }
      if (sidelobe) continue;

      const p = parabolicPeak(db, k, this.interp);
      const peakDb = this.interp[0];
      const freq = (k + p) * binHz;

      // Keep the strongest `cap` peaks, ordered by level descending.
      let pos = peaks.count;
      if (pos === cap) {
        if (peakDb <= peaks.db[cap - 1]) continue;
        pos = cap - 1;
      } else {
        peaks.count++;
      }
      peaks.frequency[pos] = freq;
      peaks.db[pos] = peakDb;
      while (pos > 0 && peaks.db[pos - 1] < peaks.db[pos]) {
        peaks.swap(pos - 1, pos);
        pos--;
      }
    }

    // --- intensity normalisation ---------------------------------------------
    const strongest = peaks.count > 0 ? peaks.db[0] : -Infinity;
    this.referenceDb = Math.max(
      strongest,
      this.referenceDb - o.referenceDecayDbPerSecond * dtSeconds,
    );
    const range = Math.max(o.minDynamicRangeDb, this.referenceDb - threshold);
    for (let i = 0; i < peaks.count; i++) {
      peaks.snr[i] = peaks.db[i] - this.noiseFloorDb;
      const norm = (peaks.db[i] - threshold) / range;
      peaks.intensity[i] = norm <= 0 ? 0 : norm >= 1 ? 1 : norm;
      peaks.cls[i] = PeakClass.LowConfidence;
      peaks.harmonic[i] = 0;
    }
    peaks.sortByFrequency();
    return peaks;
  }
}

/** k-th smallest of the first n values (Hoare quickselect, in place). */
export function quickSelect(values: Float32Array, n: number, k: number): number {
  let left = 0;
  let right = n - 1;
  while (left < right) {
    const pivot = values[(left + right) >> 1];
    let i = left;
    let j = right;
    while (i <= j) {
      while (values[i] < pivot) i++;
      while (values[j] > pivot) j--;
      if (i <= j) {
        const t = values[i];
        values[i] = values[j];
        values[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) right = j;
    else if (k >= i) left = i;
    else break;
  }
  return values[k];
}
