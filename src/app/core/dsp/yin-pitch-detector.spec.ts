import {
  centsError,
  harmonicTone,
  mix,
  sine,
  stringTone,
  sumOfPartials,
  whiteNoise,
} from './testing/synthetic-signals';
import { YinPitchDetector } from './yin-pitch-detector';

describe('YinPitchDetector', () => {
  const SR = 48000;
  const N = 4096;
  const detector = new YinPitchDetector(SR, N, { minFrequency: 50, maxFrequency: 1600 });

  describe('pure sine waves', () => {
    // Dilruba-relevant range: Mandra Pa (~104 Hz) to Taar register (~1 kHz).
    const frequencies = [
      65.41, 82.41, 103.83, 138.59, 185.0, 220, 277.18, 440, 554.37, 880, 1108.73,
    ];
    for (const f of frequencies) {
      it(`detects ${f} Hz within 1 cent`, () => {
        const r = detector.detect(sine(f, SR, N));
        expect(r.periodic).toBe(true);
        expect(centsError(r.frequency, f)).toBeLessThan(1);
        expect(r.confidence).toBeGreaterThan(0.95);
      });
    }

    it('works at 44.1 kHz', () => {
      const d = new YinPitchDetector(44100, 4096);
      const r = d.detect(sine(146.83, 44100, 4096));
      expect(centsError(r.frequency, 146.83)).toBeLessThan(1);
    });

    it('resolves a 2-cent detuning', () => {
      const target = 138.59;
      const detuned = target * Math.pow(2, 2 / 1200);
      const r = detector.detect(sine(detuned, SR, N));
      const measuredCents = 1200 * Math.log2(r.frequency / target);
      expect(measuredCents).toBeGreaterThan(1.5);
      expect(measuredCents).toBeLessThan(2.5);
    });
  });

  describe('harmonic-rich tones (fundamental, not loudest harmonic)', () => {
    it('fundamental with a strong 2nd harmonic (2.5×)', () => {
      const r = detector.detect(harmonicTone(138.59, [0.2, 0.5, 0.1], SR, N));
      expect(centsError(r.frequency, 138.59)).toBeLessThan(2);
    });

    it('fundamental with a strong 3rd harmonic (3×)', () => {
      const r = detector.detect(harmonicTone(185, [0.15, 0.1, 0.45, 0.05], SR, N));
      expect(centsError(r.frequency, 185)).toBeLessThan(2);
    });

    it('bowed-string-like sawtooth spectrum', () => {
      const r = detector.detect(stringTone(103.83, SR, N));
      expect(centsError(r.frequency, 103.83)).toBeLessThan(2);
    });

    it('missing fundamental still yields the period of the series', () => {
      // Harmonics 2–6 of 110 Hz, no energy at 110 Hz itself.
      const r = detector.detect(harmonicTone(110, [0, 0.3, 0.3, 0.2, 0.2, 0.1], SR, N));
      expect(centsError(r.frequency, 110)).toBeLessThan(3);
    });
  });

  describe('difficult input', () => {
    it('low-volume signal (-50 dBFS) is still detected', () => {
      const r = detector.detect(sine(220, SR, N, 0.003));
      expect(centsError(r.frequency, 220)).toBeLessThan(1);
      expect(r.rmsDb).toBeLessThan(-50);
    });

    it('signal in moderate noise (≈20 dB SNR)', () => {
      const s = mix(stringTone(138.59, SR, N, 0.3), whiteNoise(N, 0.03, 7));
      const r = detector.detect(s);
      expect(centsError(r.frequency, 138.59)).toBeLessThan(5);
      expect(r.confidence).toBeGreaterThan(0.7);
    });

    it('white noise alone is not reported as a confident pitch', () => {
      const r = detector.detect(whiteNoise(N, 0.2, 3));
      expect(r.periodic && r.confidence > 0.85).toBe(false);
    });

    it('silence returns no pitch', () => {
      const r = detector.detect(new Float32Array(N));
      expect(r.frequency).toBe(0);
      expect(r.confidence).toBe(0);
      expect(r.periodic).toBe(false);
    });

    it('played wire plus quieter sympathetic resonance: tracks the played wire', () => {
      // Main wire at F#3 with an unrelated taraf string ringing ~16 dB lower.
      const s = sumOfPartials(
        [
          { frequency: 185, amplitude: 0.4 },
          { frequency: 261.63, amplitude: 0.06 },
        ],
        SR,
        N,
      );
      const r = detector.detect(s);
      expect(centsError(r.frequency, 185)).toBeLessThan(10);
    });

    it('a pitch glide (unstable input) is tracked approximately', () => {
      // 1% glide across the window.
      const out = new Float32Array(N);
      let phase = 0;
      for (let i = 0; i < N; i++) {
        const f = 200 * (1 + (0.01 * i) / N);
        phase += (2 * Math.PI * f) / SR;
        out[i] = 0.4 * Math.sin(phase);
      }
      const r = detector.detect(out);
      expect(r.frequency).toBeGreaterThan(198);
      expect(r.frequency).toBeLessThan(203);
    });

    it('rejects pitches outside the configured range', () => {
      const d = new YinPitchDetector(SR, N, { minFrequency: 100, maxFrequency: 500 });
      const r = d.detect(sine(1500, SR, N));
      // 1500 Hz is out of range; YIN may only report a sub-multiple (750, 500…) or nothing.
      if (r.frequency > 0) {
        expect(r.frequency).toBeLessThanOrEqual(505);
      }
    });
  });
});
