import { PEAK_STRIDE, PeakClass } from '../models/spectrum-result.model';
import { approach } from './audio-smoother';

export interface PitchLine {
  readonly id: number;
  /** Smoothed frequency (Hz). */
  frequency: number;
  /** Displayed intensity 0–1 (attack/release smoothed). */
  intensity: number;
  /** Latest measured intensity 0–1 (0 once the peak disappears). */
  target: number;
  /** Displayed classification (with hysteresis). */
  cls: PeakClass;
  harmonic: number;
  /** Level above noise floor (dB) of the latest observation. */
  snr: number;
  /** Consecutive frames this line has been observed. */
  age: number;
  /** Seconds since the line was last observed. */
  sinceSeen: number;
}

export interface PitchLineTrackerOptions {
  matchCents: number;
  attackSeconds: number;
  releaseSeconds: number;
  /** Frames a new classification must persist before it is displayed. */
  classHysteresisFrames: number;
  maxLines: number;
}

export const DEFAULT_TRACKER_OPTIONS: PitchLineTrackerOptions = {
  matchCents: 40,
  attackSeconds: 0.035,
  releaseSeconds: 0.45,
  classHysteresisFrames: 3,
  maxLines: 64,
};

interface InternalLine extends PitchLine {
  pendingCls: PeakClass;
  pendingCount: number;
  matched: boolean;
}

/**
 * Turns per-frame spectral peaks into stable, smoothly fading visual lines.
 * Runs on the main thread at display rate; frames from the audio thread are
 * ingested as they arrive and {@link step} is called once per animation frame.
 */
export class PitchLineTracker {
  private readonly options: PitchLineTrackerOptions;
  private readonly active: InternalLine[] = [];
  private nextId = 1;

  constructor(options: Partial<PitchLineTrackerOptions> = {}) {
    this.options = { ...DEFAULT_TRACKER_OPTIONS, ...options };
  }

  get lines(): readonly PitchLine[] {
    return this.active;
  }

  clear(): void {
    this.active.length = 0;
  }

  /** True when nothing is visible any more (render loop may idle). */
  get idle(): boolean {
    return this.active.length === 0;
  }

  ingest(packed: Float32Array, count: number): void {
    const o = this.options;
    const ratio = Math.pow(2, o.matchCents / 1200);
    for (const line of this.active) line.matched = false;

    for (let p = 0; p < count; p++) {
      const base = p * PEAK_STRIDE;
      const freq = packed[base];
      const snr = packed[base + 2];
      const intensity = packed[base + 3];
      const cls = packed[base + 4] as PeakClass;
      const harmonic = packed[base + 5];
      if (!(freq > 0)) continue;

      let best: InternalLine | null = null;
      let bestErr = Infinity;
      for (const line of this.active) {
        if (line.matched) continue;
        const r = freq / line.frequency;
        if (r > ratio || r < 1 / ratio) continue;
        const err = Math.abs(Math.log(r));
        if (err < bestErr) {
          bestErr = err;
          best = line;
        }
      }

      if (!best) {
        if (this.active.length >= o.maxLines) {
          // Replace the weakest line.
          let weakest = 0;
          for (let i = 1; i < this.active.length; i++) {
            if (this.active[i].intensity < this.active[weakest].intensity) weakest = i;
          }
          if (this.active[weakest].intensity > intensity) continue;
          this.active.splice(weakest, 1);
        }
        best = {
          id: this.nextId++,
          frequency: freq,
          intensity: 0,
          target: intensity,
          cls,
          harmonic,
          snr,
          age: 0,
          sinceSeen: 0,
          pendingCls: cls,
          pendingCount: 0,
          matched: false,
        };
        this.active.push(best);
      } else {
        // Smooth frequency in the log domain.
        best.frequency = best.frequency * Math.pow(freq / best.frequency, 0.4);
        best.target = intensity;
      }

      best.matched = true;
      best.age++;
      best.sinceSeen = 0;
      best.snr = snr;
      if (cls === best.cls) {
        best.pendingCount = 0;
        best.harmonic = harmonic;
      } else if (cls === best.pendingCls) {
        best.pendingCount++;
        if (best.pendingCount >= o.classHysteresisFrames || best.age <= 1) {
          best.cls = cls;
          best.harmonic = harmonic;
          best.pendingCount = 0;
        }
      } else {
        best.pendingCls = cls;
        best.pendingCount = 1;
      }
    }

    for (const line of this.active) {
      if (!line.matched) {
        line.target = 0;
        line.age = 0;
      }
    }
  }

  /** Advances visual smoothing by dt seconds. */
  step(dt: number): void {
    const o = this.options;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const line = this.active[i];
      line.sinceSeen += dt;
      line.intensity = approach(line.intensity, line.target, dt, o.attackSeconds, o.releaseSeconds);
      if (line.target === 0 && line.intensity < 0.004) {
        this.active.splice(i, 1);
      }
    }
  }
}
