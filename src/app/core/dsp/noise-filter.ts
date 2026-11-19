/**
 * Second-order Butterworth high-pass (RBJ cookbook biquad). Removes DC offset,
 * handling rumble and most mains hum below the instrument's range.
 */
export class BiquadHighPass {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private readonly sampleRate: number,
    cutoff: number,
    private readonly q = Math.SQRT1_2,
  ) {
    this.setCutoff(cutoff);
  }

  setCutoff(cutoff: number): void {
    if (!(cutoff > 0)) {
      // Bypass
      this.b0 = 1;
      this.b1 = this.b2 = this.a1 = this.a2 = 0;
      return;
    }
    const w0 = (2 * Math.PI * Math.min(cutoff, this.sampleRate * 0.45)) / this.sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * this.q);
    const a0 = 1 + alpha;
    this.b0 = (1 + cos) / 2 / a0;
    this.b1 = -(1 + cos) / a0;
    this.b2 = (1 + cos) / 2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }

  process(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

export type NoiseFilterLevel = 'off' | 'low' | 'medium' | 'high';

export interface NoiseFilterProfile {
  /** dB the signal must exceed the adaptive noise floor by. */
  readonly gateMarginDb: number;
  /** Absolute minimum level in dBFS for a reading to be considered. */
  readonly absoluteMinDb: number;
  /** Additional dB the spectrum peaks must exceed the spectral floor by. */
  readonly spectrumExtraMarginDb: number;
}

export const NOISE_FILTER_PROFILES: Record<NoiseFilterLevel, NoiseFilterProfile> = {
  off: { gateMarginDb: 0, absoluteMinDb: -95, spectrumExtraMarginDb: 0 },
  low: { gateMarginDb: 6, absoluteMinDb: -80, spectrumExtraMarginDb: 2 },
  medium: { gateMarginDb: 10, absoluteMinDb: -70, spectrumExtraMarginDb: 4 },
  high: { gateMarginDb: 16, absoluteMinDb: -60, spectrumExtraMarginDb: 8 },
};

/**
 * Tracks the background (unvoiced) level and gates frames that are not
 * sufficiently above it. The floor only adapts upward while no periodic signal is
 * present, so a long sustained note cannot "teach" the gate to close on itself.
 */
export class AdaptiveNoiseGate {
  floorDb: number;

  constructor(
    private readonly riseDbPerSecond = 4,
    private readonly fallDbPerSecond = 40,
    private readonly initialFloorDb = -75,
    private readonly maxFloorDb = -30,
  ) {
    this.floorDb = initialFloorDb;
  }

  reset(): void {
    this.floorDb = this.initialFloorDb;
  }

  /**
   * Feeds a frame level. Pass `voiced` = "the detector found a clear periodic
   * signal", independent of whether the gate was open – otherwise a closed gate
   * would treat a sustained note as noise and lock itself shut. The floor is
   * rate-limited in both directions, so a single transient frame (pluck, bow
   * change, pitch jump) cannot move it far.
   */
  update(levelDb: number, voiced: boolean, dtSeconds: number): void {
    if (!Number.isFinite(levelDb)) {
      levelDb = -120;
    }
    if (levelDb < this.floorDb) {
      this.floorDb = Math.max(levelDb, this.floorDb - this.fallDbPerSecond * dtSeconds);
    } else if (!voiced) {
      this.floorDb = Math.min(levelDb, this.floorDb + this.riseDbPerSecond * dtSeconds);
    }
    if (this.floorDb < -120) this.floorDb = -120;
    if (this.floorDb > this.maxFloorDb) this.floorDb = this.maxFloorDb;
  }

  isOpen(levelDb: number, profile: NoiseFilterProfile): boolean {
    return levelDb >= profile.absoluteMinDb && levelDb >= this.floorDb + profile.gateMarginDb;
  }
}
