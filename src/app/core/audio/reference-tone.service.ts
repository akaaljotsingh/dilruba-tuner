import { Injectable, signal } from '@angular/core';
import { audioContextConstructor } from './microphone-permission.service';

/**
 * Plays a short, soft reference pitch so the player can also tune by ear.
 * Uses its own small AudioContext (created on the user's tap) so it never
 * interferes with the analysis graph.
 */
@Injectable({ providedIn: 'root' })
export class ReferenceToneService {
  readonly playingFrequency = signal<number | null>(null);
  private ctx: AudioContext | null = null;
  private current: { osc: OscillatorNode; gain: GainNode } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  play(frequency: number, seconds = 2.2): void {
    const Ctor = audioContextConstructor();
    if (!Ctor || !(frequency > 0)) return;
    this.stopNow();
    if (!this.ctx || this.ctx.state === 'closed') this.ctx = new Ctor();
    const ctx = this.ctx;
    void ctx.resume().catch(() => undefined);

    // Gentle bowed-string-like timbre: decaying harmonic series.
    const harmonics = 8;
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);
    for (let h = 1; h <= harmonics; h++) imag[h] = 1 / (h * h * 0.6 + 0.4);
    const wave = ctx.createPeriodicWave(real, imag);

    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.value = frequency;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.08);
    gain.gain.setTargetAtTime(0.0001, t + seconds - 0.4, 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + seconds + 0.2);
    this.current = { osc, gain };
    this.playingFrequency.set(frequency);
    this.timer = setTimeout(() => this.stopNow(), (seconds + 0.25) * 1000);
  }

  stopNow(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.current) {
      try {
        this.current.osc.stop();
        this.current.osc.disconnect();
        this.current.gain.disconnect();
      } catch {
        /* already stopped */
      }
      this.current = null;
    }
    this.playingFrequency.set(null);
  }
}
