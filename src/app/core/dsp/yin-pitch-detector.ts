import { PitchEstimate } from '../models/pitch-result.model';
import { FFT } from './fft-analyzer';
import { createPitchEstimate, PitchDetector, rmsToDb } from './pitch-detector';

export interface YinOptions {
  minFrequency: number;
  maxFrequency: number;
  /** Absolute threshold on the cumulative mean normalised difference (typ. 0.10–0.20). */
  threshold: number;
  /**
   * A dip is only accepted as "first" if it is within this distance of the best
   * dip in range. This rejects the classic YIN octave-up error when a strong
   * 2nd harmonic produces a shallow dip at half the true period.
   */
  dipTolerance: number;
  /** When no dip is under the threshold, still report the global minimum if below this. */
  fallbackThreshold: number;
}

export const DEFAULT_YIN_OPTIONS: YinOptions = {
  minFrequency: 55,
  maxFrequency: 1600,
  threshold: 0.15,
  dipTolerance: 0.06,
  fallbackThreshold: 0.35,
};

/**
 * YIN fundamental-frequency estimator (de Cheveigné & Kawahara, 2002).
 *
 * The difference function d(τ) is computed in O(N log N) via FFT
 * cross-correlation rather than the naive O(N·W) double loop:
 *
 *   d(τ) = Σ_{j<W} (x_j − x_{j+τ})² = E(0) + E(τ) − 2·r(τ)
 *
 * where E(τ) is the energy of x[τ, τ+W) (from a prefix sum of squares) and
 * r(τ) = Σ_{j<W} x_j·x_{j+τ}. With N = 2W the circular correlation of size N
 * never wraps for τ < W, so a single FFT size N suffices.
 */
export class YinPitchDetector implements PitchDetector {
  readonly bufferSize: number;
  readonly windowSize: number;
  readonly sampleRate: number;
  readonly result: PitchEstimate = createPitchEstimate();
  /** Cumulative mean normalised difference function of the last call (for diagnostics/tests). */
  readonly cmnd: Float64Array;

  private options: YinOptions;
  private readonly fft: FFT;
  private readonly aRe: Float64Array;
  private readonly aIm: Float64Array;
  private readonly bRe: Float64Array;
  private readonly bIm: Float64Array;
  private readonly prefix: Float64Array;
  private readonly centred: Float64Array;

  constructor(sampleRate: number, bufferSize: number, options: Partial<YinOptions> = {}) {
    if ((bufferSize & (bufferSize - 1)) !== 0) {
      throw new Error('YIN buffer size must be a power of two');
    }
    this.sampleRate = sampleRate;
    this.bufferSize = bufferSize;
    this.windowSize = bufferSize >> 1;
    this.options = { ...DEFAULT_YIN_OPTIONS, ...options };
    this.fft = new FFT(bufferSize);
    this.aRe = new Float64Array(bufferSize);
    this.aIm = new Float64Array(bufferSize);
    this.bRe = new Float64Array(bufferSize);
    this.bIm = new Float64Array(bufferSize);
    this.prefix = new Float64Array(bufferSize + 1);
    this.centred = new Float64Array(bufferSize);
    this.cmnd = new Float64Array(this.windowSize);
  }

  configure(options: Partial<YinOptions>): void {
    this.options = { ...this.options, ...options };
  }

  get currentOptions(): Readonly<YinOptions> {
    return this.options;
  }

  detect(samples: Float32Array): PitchEstimate {
    const n = this.bufferSize;
    const w = this.windowSize;
    const out = this.result;
    const x = this.centred;
    const offset = samples.length - n;
    if (offset < 0) {
      throw new Error(`YIN expects at least ${n} samples, got ${samples.length}`);
    }

    // DC removal + RMS
    let mean = 0;
    for (let i = 0; i < n; i++) mean += samples[offset + i];
    mean /= n;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const v = samples[offset + i] - mean;
      x[i] = v;
      energy += v * v;
    }
    const rms = Math.sqrt(energy / n);
    out.rmsDb = rmsToDb(rms);
    out.frequency = 0;
    out.confidence = 0;
    out.periodic = false;
    if (rms < 1e-7) {
      return out;
    }

    // r(τ) via FFT cross-correlation of x[0, W) with x[0, N).
    const aRe = this.aRe;
    const aIm = this.aIm;
    const bRe = this.bRe;
    const bIm = this.bIm;
    for (let i = 0; i < n; i++) {
      aRe[i] = i < w ? x[i] : 0;
      aIm[i] = 0;
      bRe[i] = x[i];
      bIm[i] = 0;
    }
    this.fft.transform(aRe, aIm);
    this.fft.transform(bRe, bIm);
    for (let k = 0; k < n; k++) {
      // conj(A) · B
      const re = aRe[k] * bRe[k] + aIm[k] * bIm[k];
      const im = aRe[k] * bIm[k] - aIm[k] * bRe[k];
      aRe[k] = re;
      aIm[k] = im;
    }
    this.fft.transform(aRe, aIm, true);

    const prefix = this.prefix;
    prefix[0] = 0;
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i] * x[i];
    const e0 = prefix[w];

    // Cumulative mean normalised difference d'(τ)
    const cmnd = this.cmnd;
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau < w; tau++) {
      let d = e0 + (prefix[tau + w] - prefix[tau]) - 2 * aRe[tau];
      if (d < 0) d = 0;
      running += d;
      cmnd[tau] = running > 0 ? (d * tau) / running : 1;
    }

    const { minFrequency, maxFrequency, threshold, dipTolerance, fallbackThreshold } = this.options;
    const tauMin = Math.max(2, Math.floor(this.sampleRate / maxFrequency));
    const tauMax = Math.min(w - 2, Math.ceil(this.sampleRate / minFrequency));
    if (tauMin >= tauMax) {
      return out;
    }

    let best = Infinity;
    let bestTau = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau] < best) {
        best = cmnd[tau];
        bestTau = tau;
      }
    }

    // First dip below the absolute threshold whose local minimum is close to the best.
    let chosen = -1;
    let tau = tauMin;
    while (tau <= tauMax) {
      if (cmnd[tau] < threshold) {
        while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
        if (cmnd[tau] <= best + dipTolerance) {
          chosen = tau;
          break;
        }
        // Skip past this dip.
        while (tau + 1 <= tauMax && cmnd[tau + 1] < threshold) tau++;
      }
      tau++;
    }

    if (chosen < 0) {
      if (best < fallbackThreshold && bestTau > 0) {
        chosen = bestTau;
      } else {
        return out;
      }
    } else {
      out.periodic = true;
    }

    // A dip at the very edge of the search range is not a genuine minimum.
    if (chosen <= tauMin || chosen >= tauMax) {
      out.periodic = false;
      return out;
    }

    // Parabolic interpolation for sub-sample period.
    const c0 = cmnd[chosen - 1];
    const c1 = cmnd[chosen];
    const c2 = cmnd[chosen + 1];
    const denom = c0 - 2 * c1 + c2;
    let shift = denom > 0 ? (0.5 * (c0 - c2)) / denom : 0;
    if (shift > 1) shift = 1;
    else if (shift < -1) shift = -1;
    const period = chosen + shift;

    out.frequency = this.sampleRate / period;
    const conf = 1 - c1;
    out.confidence = conf < 0 ? 0 : conf > 1 ? 1 : conf;
    return out;
  }
}
