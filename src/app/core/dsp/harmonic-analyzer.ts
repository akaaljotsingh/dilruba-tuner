import { PeakClass } from '../models/spectrum-result.model';
import { PeakSet } from './frequency-analyzer';

export interface HarmonicAnalyzerOptions {
  /** Tolerance (cents) for matching a peak to n·f0. */
  toleranceCents: number;
  /** Looser tolerance for assigning leftover peaks as high harmonics (string inharmonicity). */
  looseToleranceCents: number;
  maxHarmonics: number;
  maxFundamentals: number;
  minFundamental: number;
  maxFundamental: number;
  /** A lone peak (no harmonics) counts as a fundamental only if this far above the floor. */
  strongSingleSnrDb: number;
  /** Secondary fundamentals must be within this many dB of the strongest one. */
  secondaryRangeDb: number;
  /** Isolated tones this much weaker than the main note are treated as sympathetic resonance. */
  resonanceDropDb: number;
  /** Resonance must sit within this many cents of an equal-tempered note. */
  resonanceCents: number;
  /** Frames flatter (noisier) than this get no fundamentals. */
  maxFlatness: number;
  a4: number;
}

export const DEFAULT_HARMONIC_OPTIONS: HarmonicAnalyzerOptions = {
  toleranceCents: 35,
  looseToleranceCents: 55,
  maxHarmonics: 12,
  maxFundamentals: 4,
  minFundamental: 50,
  maxFundamental: 1600,
  strongSingleSnrDb: 30,
  secondaryRangeDb: 24,
  resonanceDropDb: 12,
  resonanceCents: 30,
  maxFlatness: 0.5,
  a4: 440,
};

/**
 * Groups spectral peaks into harmonic series so that overtones are not shown
 * as separately played swaras.
 *
 * For each unassigned peak f0 in the fundamental range we sum the linear
 * amplitudes of unassigned peaks lying at n·f0 (n = 1…H). The best-scoring
 * series is accepted as a fundamental when it has at least one supporting
 * harmonic, agrees with the time-domain (YIN) pitch, or is a very strong single
 * tone. Its members are marked as harmonics and the search repeats for
 * additional simultaneous notes. Because a candidate must itself be a peak,
 * the analyser never invents sub-octave fundamentals; because the true f0's
 * series contains the series of 2·f0, octave-up candidates always score lower.
 */
export class HarmonicAnalyzer {
  private options: HarmonicAnalyzerOptions;
  private readonly amp: Float64Array;
  private readonly fundamentals: Float64Array;
  private readonly fundamentalDb: Float64Array;
  private readonly skip: Uint8Array;
  fundamentalCount = 0;

  constructor(capacity = 32, options: Partial<HarmonicAnalyzerOptions> = {}) {
    this.options = { ...DEFAULT_HARMONIC_OPTIONS, ...options };
    this.amp = new Float64Array(capacity);
    this.skip = new Uint8Array(capacity);
    this.fundamentals = new Float64Array(this.options.maxFundamentals + 1);
    this.fundamentalDb = new Float64Array(this.options.maxFundamentals + 1);
  }

  configure(options: Partial<HarmonicAnalyzerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Classifies peaks in place. Peaks must be sorted by frequency.
   * @param hintFrequency time-domain pitch estimate (0 if none)
   * @param hintConfidence 0–1
   * @param flatness spectral flatness of the frame
   * @param marginDb the analyser's detection margin above the floor
   */
  analyze(
    peaks: PeakSet,
    hintFrequency: number,
    hintConfidence: number,
    flatness: number,
    marginDb: number,
  ): number {
    const o = this.options;
    const n = peaks.count;
    const UNASSIGNED = 255;
    for (let i = 0; i < n; i++) {
      peaks.cls[i] = UNASSIGNED;
      peaks.harmonic[i] = 0;
      this.amp[i] = Math.pow(10, peaks.db[i] / 20);
      this.skip[i] = 0;
    }
    this.fundamentalCount = 0;
    const tolRatio = Math.pow(2, o.toleranceCents / 1200);
    const maxPeakFreq = n > 0 ? peaks.frequency[n - 1] : 0;
    const hintValid = hintFrequency > 0 && hintConfidence >= 0.7;
    let strongestFundDb = -Infinity;

    if (flatness <= o.maxFlatness) {
      for (let iter = 0; iter < o.maxFundamentals; iter++) {
        let bestScore = 0;
        let bestIndex = -1;
        let bestMatches = 0;
        let bestOddMatches = 0;
        let bestSecond = -1;
        for (let i = 0; i < n; i++) {
          if (peaks.cls[i] !== UNASSIGNED || this.skip[i]) continue;
          const f0 = peaks.frequency[i];
          if (f0 < o.minFundamental || f0 > o.maxFundamental) continue;
          let score = this.amp[i];
          let matches = 1;
          let oddMatches = 0;
          let second = -1;
          for (let h = 2; h <= o.maxHarmonics; h++) {
            const target = h * f0;
            if (target > maxPeakFreq * tolRatio) break;
            const j = this.nearestUnassigned(peaks, target, tolRatio, UNASSIGNED);
            if (j >= 0) {
              score += this.amp[j];
              matches++;
              if (h % 2 === 1) oddMatches++;
              if (h === 2) second = j;
            }
          }
          if (hintValid && Math.abs(1200 * Math.log2(f0 / hintFrequency)) < 40) {
            score *= 1.5;
          }
          if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
            bestMatches = matches;
            bestOddMatches = oddMatches;
            bestSecond = second;
          }
        }
        if (bestIndex < 0) break;

        // A weak low peak whose "series" consists only of even harmonics is really a
        // separate tone an octave (or more) below a louder note – e.g. a taraf string
        // ringing. Skip it as a fundamental candidate and let the louder note win.
        if (
          bestMatches >= 3 &&
          bestOddMatches === 0 &&
          bestSecond >= 0 &&
          this.amp[bestSecond] > this.amp[bestIndex] * 1.5 &&
          !(
            hintValid && Math.abs(1200 * Math.log2(peaks.frequency[bestIndex] / hintFrequency)) < 40
          )
        ) {
          this.skip[bestIndex] = 1;
          iter--;
          continue;
        }

        const f0 = peaks.frequency[bestIndex];
        const agreesWithHint = hintValid && Math.abs(1200 * Math.log2(f0 / hintFrequency)) < 40;
        const strongSingle = peaks.snr[bestIndex] >= o.strongSingleSnrDb;
        const supported = bestMatches >= 2 && peaks.snr[bestIndex] >= marginDb + 3;
        if (!(supported || agreesWithHint || strongSingle)) break;
        if (iter > 0 && peaks.db[bestIndex] < strongestFundDb - o.secondaryRangeDb) break;
        // A secondary tone with no overtones of its own that is much quieter than the
        // played note is far more likely a sympathetic string ringing than a second
        // played note – leave it for the resonance classification below.
        if (
          iter > 0 &&
          bestMatches < 2 &&
          !agreesWithHint &&
          peaks.db[bestIndex] < strongestFundDb - o.resonanceDropDb
        ) {
          this.skip[bestIndex] = 1;
          iter--;
          continue;
        }

        peaks.cls[bestIndex] = PeakClass.Fundamental;
        peaks.harmonic[bestIndex] = 1;
        if (peaks.db[bestIndex] > strongestFundDb) strongestFundDb = peaks.db[bestIndex];
        this.fundamentals[this.fundamentalCount] = f0;
        this.fundamentalDb[this.fundamentalCount] = peaks.db[bestIndex];
        this.fundamentalCount++;
        for (let h = 2; h <= o.maxHarmonics; h++) {
          const target = h * f0;
          if (target > maxPeakFreq * tolRatio) break;
          const j = this.nearestUnassigned(peaks, target, tolRatio, UNASSIGNED);
          if (j >= 0) {
            peaks.cls[j] = PeakClass.Harmonic;
            peaks.harmonic[j] = h;
          }
        }
      }
    }

    // Leftover peaks.
    const looseRatio = Math.pow(2, o.looseToleranceCents / 1200);
    for (let i = 0; i < n; i++) {
      if (peaks.cls[i] !== UNASSIGNED) continue;
      const f = peaks.frequency[i];
      let harmonicOf = 0;
      for (let k = 0; k < this.fundamentalCount && harmonicOf === 0; k++) {
        const ratio = f / this.fundamentals[k];
        const h = Math.round(ratio);
        if (h >= 2 && h <= 20) {
          const r = ratio / h;
          if (r < looseRatio && r > 1 / looseRatio) harmonicOf = h;
        }
      }
      if (harmonicOf > 0) {
        peaks.cls[i] = PeakClass.Harmonic;
        peaks.harmonic[i] = Math.min(255, harmonicOf);
        continue;
      }
      if (peaks.snr[i] < marginDb + 4) {
        peaks.cls[i] = PeakClass.Noise;
        continue;
      }
      if (flatness > o.maxFlatness) {
        peaks.cls[i] = PeakClass.LowConfidence;
        continue;
      }
      const midi = 69 + 12 * Math.log2(f / o.a4);
      const nearEt = Math.abs(midi - Math.round(midi)) * 100 <= o.resonanceCents;
      const weaker =
        this.fundamentalCount === 0 || peaks.db[i] < strongestFundDb - o.resonanceDropDb;
      if (nearEt && weaker && f >= o.minFundamental && f <= o.maxFundamental * 2) {
        peaks.cls[i] = PeakClass.Resonance;
      } else {
        peaks.cls[i] = PeakClass.LowConfidence;
      }
    }
    return this.fundamentalCount;
  }

  fundamentalFrequency(index: number): number {
    return this.fundamentals[index];
  }

  private nearestUnassigned(
    peaks: PeakSet,
    target: number,
    tolRatio: number,
    unassigned: number,
  ): number {
    let best = -1;
    let bestErr = Infinity;
    const lo = target / tolRatio;
    const hi = target * tolRatio;
    for (let j = 0; j < peaks.count; j++) {
      const f = peaks.frequency[j];
      if (f < lo) continue;
      if (f > hi) break;
      if (peaks.cls[j] !== unassigned) continue;
      const err = Math.abs(Math.log(f / target));
      if (err < bestErr) {
        bestErr = err;
        best = j;
      }
    }
    return best;
  }
}
