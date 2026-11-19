import { SmoothedPitch } from '../models/pitch-result.model';

export interface PitchSmootherOptions {
  /** Frames below this confidence are treated as drop-outs. */
  minConfidence: number;
  /** How long (s) to hold the last reading through drop-outs before going inactive. */
  holdSeconds: number;
  /** Median filter length (odd). */
  medianLength: number;
  /** A change larger than this (cents) is treated as a new note rather than drift. */
  jumpCents: number;
  /** Number of consecutive agreeing frames needed to accept a jump. */
  jumpFrames: number;
  /** Max spread (cents) over the stability window for a reading to count as stable. */
  stableCents: number;
  /** Number of recent frames considered for stability. */
  stableFrames: number;
  /** Smoothing time constant in seconds for small changes. */
  timeConstant: number;
}

export const DEFAULT_SMOOTHER_OPTIONS: PitchSmootherOptions = {
  minConfidence: 0.8,
  holdSeconds: 0.35,
  medianLength: 5,
  jumpCents: 60,
  jumpFrames: 3,
  stableCents: 8,
  stableFrames: 6,
  timeConstant: 0.06,
};

/**
 * Temporal smoothing for monophonic pitch readings, operating in the log
 * (cents) domain: median filter → jump detection → adaptive exponential
 * smoothing → stability estimate. Allocation-free per update.
 */
export class PitchSmoother {
  readonly output: SmoothedPitch = {
    frequency: 0,
    confidence: 0,
    active: false,
    stable: false,
    held: false,
  };

  private options: PitchSmootherOptions;
  private readonly history: Float64Array;
  private readonly sortScratch: Float64Array;
  private readonly recent: Float64Array;
  private historyCount = 0;
  private historyIndex = 0;
  private recentCount = 0;
  private recentIndex = 0;
  private smoothedCents = 0;
  private hasValue = false;
  private lastValidTime = -Infinity;
  private jumpCount = 0;
  private lastConfidence = 0;

  constructor(options: Partial<PitchSmootherOptions> = {}) {
    this.options = { ...DEFAULT_SMOOTHER_OPTIONS, ...options };
    this.history = new Float64Array(Math.max(1, this.options.medianLength));
    this.sortScratch = new Float64Array(this.history.length);
    this.recent = new Float64Array(Math.max(2, this.options.stableFrames));
  }

  configure(
    options: Partial<Pick<PitchSmootherOptions, 'minConfidence' | 'holdSeconds' | 'stableCents'>>,
  ): void {
    this.options = { ...this.options, ...options };
  }

  reset(): void {
    this.historyCount = this.historyIndex = 0;
    this.recentCount = this.recentIndex = 0;
    this.hasValue = false;
    this.jumpCount = 0;
    this.lastValidTime = -Infinity;
    const o = this.output;
    o.frequency = 0;
    o.confidence = 0;
    o.active = false;
    o.stable = false;
    o.held = false;
  }

  /**
   * @param frequency raw detected frequency (0 when none)
   * @param confidence 0–1
   * @param time monotonically increasing time in seconds
   */
  update(frequency: number, confidence: number, time: number, dt: number): SmoothedPitch {
    const o = this.output;
    const opts = this.options;
    const valid = frequency > 0 && confidence >= opts.minConfidence;

    if (!valid) {
      if (this.hasValue && time - this.lastValidTime <= opts.holdSeconds) {
        o.held = true;
        o.active = true;
        o.stable = false;
        o.confidence = this.lastConfidence * 0.9;
        this.lastConfidence = o.confidence;
        return o;
      }
      this.reset();
      return o;
    }

    const cents = 1200 * Math.log2(frequency / 440);
    this.lastValidTime = time;
    this.lastConfidence = confidence;

    // Median filter over raw values.
    this.history[this.historyIndex] = cents;
    this.historyIndex = (this.historyIndex + 1) % this.history.length;
    if (this.historyCount < this.history.length) this.historyCount++;
    const median = this.median();

    if (!this.hasValue) {
      this.smoothedCents = cents;
      this.hasValue = true;
      this.jumpCount = 0;
    } else {
      const diff = cents - this.smoothedCents;
      if (Math.abs(diff) > opts.jumpCents) {
        // Possibly a new note: accept once the raw value agrees for several frames.
        this.jumpCount++;
        if (this.jumpCount >= opts.jumpFrames) {
          this.smoothedCents = cents;
          this.resetHistoryTo(cents);
          this.recentCount = this.recentIndex = 0;
          this.jumpCount = 0;
        }
      } else {
        this.jumpCount = 0;
        const target = median;
        const delta = target - this.smoothedCents;
        // Adaptive: faster response for larger deviations so turning a peg feels immediate.
        const tc = opts.timeConstant / (1 + Math.abs(delta) / 15);
        const alpha = 1 - Math.exp(-Math.max(dt, 1e-4) / tc);
        this.smoothedCents += delta * alpha;
      }
    }

    // Stability over recent raw (median-filtered) readings.
    this.recent[this.recentIndex] = median;
    this.recentIndex = (this.recentIndex + 1) % this.recent.length;
    if (this.recentCount < this.recent.length) this.recentCount++;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < this.recentCount; i++) {
      const v = this.recent[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }

    o.frequency = 440 * Math.pow(2, this.smoothedCents / 1200);
    o.confidence = confidence;
    o.active = true;
    o.held = false;
    o.stable =
      this.recentCount >= this.recent.length &&
      max - min <= opts.stableCents &&
      this.jumpCount === 0;
    return o;
  }

  private resetHistoryTo(cents: number): void {
    this.history.fill(cents);
    this.historyCount = 1;
    this.historyIndex = 1 % this.history.length;
    this.history[0] = cents;
  }

  private median(): number {
    const n = this.historyCount;
    const s = this.sortScratch;
    for (let i = 0; i < n; i++) s[i] = this.history[i];
    // insertion sort – n ≤ 7
    for (let i = 1; i < n; i++) {
      const v = s[i];
      let j = i - 1;
      while (j >= 0 && s[j] > v) {
        s[j + 1] = s[j];
        j--;
      }
      s[j + 1] = v;
    }
    return n % 2 === 1 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
  }
}

/** Simple attack/release envelope follower used for visual intensity. */
export function approach(
  current: number,
  target: number,
  dt: number,
  attackSeconds: number,
  releaseSeconds: number,
): number {
  const tc = target > current ? attackSeconds : releaseSeconds;
  const alpha = 1 - Math.exp(-dt / Math.max(tc, 1e-4));
  return current + (target - current) * alpha;
}
