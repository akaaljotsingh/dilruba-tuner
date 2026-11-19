import { PitchSmoother } from './audio-smoother';
import { AdaptiveNoiseGate, BiquadHighPass, NOISE_FILTER_PROFILES } from './noise-filter';
import { seededRandom } from './testing/synthetic-signals';

describe('PitchSmoother', () => {
  const dt = 0.02;

  it('becomes stable on a steady pitch', () => {
    const s = new PitchSmoother();
    let out = s.update(220, 0.95, 0, dt);
    for (let i = 1; i < 10; i++) out = s.update(220, 0.95, i * dt, dt);
    expect(out.active).toBe(true);
    expect(out.stable).toBe(true);
    expect(out.frequency).toBeCloseTo(220, 3);
  });

  it('removes single-frame outliers (e.g. an octave blip)', () => {
    const s = new PitchSmoother();
    for (let i = 0; i < 8; i++) s.update(220, 0.95, i * dt, dt);
    const out = s.update(440, 0.95, 8 * dt, dt);
    expect(Math.abs(out.frequency - 220)).toBeLessThan(1);
  });

  it('accepts a genuine new note after several agreeing frames', () => {
    const s = new PitchSmoother();
    for (let i = 0; i < 8; i++) s.update(220, 0.95, i * dt, dt);
    let out = s.update(330, 0.95, 8 * dt, dt);
    for (let i = 9; i < 14; i++) out = s.update(330, 0.95, i * dt, dt);
    expect(Math.abs(out.frequency - 330)).toBeLessThan(2);
  });

  it('holds briefly through low-confidence frames, then goes inactive', () => {
    const s = new PitchSmoother({ holdSeconds: 0.2 });
    for (let i = 0; i < 6; i++) s.update(220, 0.95, i * dt, dt);
    let out = s.update(0, 0, 0.12, dt);
    expect(out.active).toBe(true);
    expect(out.held).toBe(true);
    expect(out.stable).toBe(false);
    out = s.update(0, 0, 0.5, dt);
    expect(out.active).toBe(false);
  });

  it('is not stable on jittery input (unstable signal)', () => {
    const s = new PitchSmoother({ stableCents: 5 });
    const rnd = seededRandom(5);
    let out = s.update(220, 0.95, 0, dt);
    for (let i = 1; i < 20; i++) {
      const cents = (rnd() - 0.5) * 60;
      out = s.update(220 * Math.pow(2, cents / 1200), 0.95, i * dt, dt);
    }
    expect(out.stable).toBe(false);
  });

  it('follows slow peg-turning drift', () => {
    const s = new PitchSmoother();
    let out = s.update(200, 0.95, 0, dt);
    for (let i = 1; i <= 50; i++) out = s.update(200 + i * 0.2, 0.95, i * dt, dt);
    expect(Math.abs(out.frequency - 210)).toBeLessThan(1);
  });
});

describe('Noise filtering', () => {
  it('high-pass attenuates 20 Hz rumble and passes 200 Hz', () => {
    const sr = 48000;
    const rms = (f: number) => {
      const hp = new BiquadHighPass(sr, 50);
      let sum = 0;
      const n = sr;
      for (let i = 0; i < n; i++) {
        const y = hp.process(Math.sin((2 * Math.PI * f * i) / sr));
        if (i > sr / 2) sum += y * y;
      }
      return Math.sqrt(sum / (n / 2));
    };
    expect(rms(20)).toBeLessThan(0.15);
    expect(rms(200)).toBeGreaterThan(0.65);
  });

  it('noise gate adapts to background and opens for louder signals', () => {
    const gate = new AdaptiveNoiseGate();
    for (let i = 0; i < 300; i++) gate.update(-60, false, 0.02); // ~6 s of room noise
    expect(gate.floorDb).toBeCloseTo(-60, 0);
    expect(gate.isOpen(-58, NOISE_FILTER_PROFILES.medium)).toBe(false);
    expect(gate.isOpen(-30, NOISE_FILTER_PROFILES.medium)).toBe(true);
  });

  it('a transient unvoiced frame during a loud note cannot lock the gate shut', () => {
    const gate = new AdaptiveNoiseGate();
    for (let i = 0; i < 50; i++) gate.update(-16, true, 0.02);
    gate.update(-16, false, 0.02); // e.g. pitch change / bow reversal
    for (let i = 0; i < 500; i++) gate.update(-16, true, 0.02);
    expect(gate.isOpen(-16, NOISE_FILTER_PROFILES.medium)).toBe(true);
  });

  it('a sustained voiced note does not raise the floor', () => {
    const gate = new AdaptiveNoiseGate();
    for (let i = 0; i < 50; i++) gate.update(-65, false, 0.02);
    for (let i = 0; i < 1000; i++) gate.update(-20, true, 0.02);
    expect(gate.floorDb).toBeLessThan(-60);
  });
});
