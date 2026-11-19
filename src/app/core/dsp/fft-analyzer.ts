/**
 * In-place iterative radix-2 complex FFT with precomputed twiddles and
 * bit-reversal table. Allocation-free after construction.
 */
export class FFT {
  readonly size: number;
  private readonly reverse: Uint32Array;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${size}`);
    }
    this.size = size;
    const bits = Math.log2(size);
    this.reverse = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) {
        r = (r << 1) | ((i >>> b) & 1);
      }
      this.reverse[i] = r;
    }
    const half = size >> 1;
    this.cosTable = new Float64Array(half);
    this.sinTable = new Float64Array(half);
    for (let k = 0; k < half; k++) {
      this.cosTable[k] = Math.cos((2 * Math.PI * k) / size);
      this.sinTable[k] = Math.sin((2 * Math.PI * k) / size);
    }
  }

  /** Transforms (re, im) in place. The inverse transform is scaled by 1/N. */
  transform(re: Float64Array, im: Float64Array, inverse = false): void {
    const n = this.size;
    const rev = this.reverse;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    const sign = inverse ? 1 : -1;
    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0, k = 0; j < halfLen; j++, k += step) {
          const wr = this.cosTable[k];
          const wi = sign * this.sinTable[k];
          const a = i + j;
          const b = a + halfLen;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    if (inverse) {
      const scale = 1 / n;
      for (let i = 0; i < n; i++) {
        re[i] *= scale;
        im[i] *= scale;
      }
    }
  }
}

/**
 * Hann-windowed magnitude spectrum in dBFS. A full-scale sinusoid centred on a
 * bin reads ≈ 0 dB. These are relative digital levels, not acoustic dB SPL.
 */
export class FftAnalyzer {
  readonly size: number;
  readonly sampleRate: number;
  readonly binCount: number;
  readonly binHz: number;
  /** Latest spectrum in dBFS, length = size / 2 + 1. */
  readonly magnitudesDb: Float32Array;

  private readonly fft: FFT;
  private readonly window: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly amplitudeScale: number;

  constructor(size: number, sampleRate: number) {
    this.size = size;
    this.sampleRate = sampleRate;
    this.binCount = size / 2 + 1;
    this.binHz = sampleRate / size;
    this.fft = new FFT(size);
    this.window = new Float64Array(size);
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
      this.window[i] = w;
      sum += w;
    }
    this.amplitudeScale = 2 / sum;
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.magnitudesDb = new Float32Array(this.binCount);
  }

  binToFrequency(bin: number): number {
    return bin * this.binHz;
  }

  frequencyToBin(frequency: number): number {
    return frequency / this.binHz;
  }

  /** Analyses the first `size` samples of `samples`. Returns {@link magnitudesDb}. */
  analyze(samples: ArrayLike<number>): Float32Array {
    const n = this.size;
    const re = this.re;
    const im = this.im;
    for (let i = 0; i < n; i++) {
      re[i] = samples[i] * this.window[i];
      im[i] = 0;
    }
    this.fft.transform(re, im);
    const out = this.magnitudesDb;
    const scale = this.amplitudeScale;
    for (let k = 0; k < this.binCount; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * scale;
      out[k] = 20 * Math.log10(mag + 1e-12);
    }
    return out;
  }
}

/**
 * Parabolic interpolation of a peak at index k of `values`.
 * Returns the fractional offset in [-0.5, 0.5] and writes the interpolated height to `out[0]`.
 */
export function parabolicPeak(values: ArrayLike<number>, k: number, out: Float64Array): number {
  const a = values[k - 1];
  const b = values[k];
  const c = values[k + 1];
  const denom = a - 2 * b + c;
  if (denom === 0 || !Number.isFinite(denom)) {
    out[0] = b;
    return 0;
  }
  let p = (0.5 * (a - c)) / denom;
  if (p > 0.5) p = 0.5;
  else if (p < -0.5) p = -0.5;
  out[0] = b - 0.25 * (a - c) * p;
  return p;
}
