import { PEAK_STRIDE, PeakClass } from '../models/spectrum-result.model';
import { FFT, FftAnalyzer } from './fft-analyzer';
import { FrequencyAnalyzer, PeakSet, quickSelect } from './frequency-analyzer';
import { HarmonicAnalyzer } from './harmonic-analyzer';
import { PitchLineTracker } from './pitch-line-tracker';
import {
  centsError,
  harmonicTone,
  mix,
  sine,
  stringTone,
  whiteNoise,
} from './testing/synthetic-signals';

const SR = 48000;
const N = 8192;

function peaksOf(set: PeakSet) {
  const out = [];
  for (let i = 0; i < set.count; i++) {
    out.push({
      f: set.frequency[i],
      db: set.db[i],
      cls: set.cls[i] as PeakClass,
      h: set.harmonic[i],
      intensity: set.intensity[i],
    });
  }
  return out;
}

function analyse(signal: Float32Array, frames = 6) {
  const fa = new FrequencyAnalyzer(SR, N, 32, {
    minFrequency: 50,
    maxFrequency: 5000,
    marginDb: 14,
  });
  for (let i = 0; i < frames; i++) fa.analyze(signal, 0.02);
  return fa;
}

describe('FFT', () => {
  it('rejects non power-of-two sizes', () => {
    expect(() => new FFT(1000)).toThrow();
  });

  it('forward then inverse is identity', () => {
    const fft = new FFT(64);
    const re = new Float64Array(64).map((_, i) => Math.sin(i * 0.3) + 0.2 * i);
    const im = new Float64Array(64);
    const copy = Float64Array.from(re);
    fft.transform(re, im);
    fft.transform(re, im, true);
    for (let i = 0; i < 64; i++) {
      expect(re[i]).toBeCloseTo(copy[i], 9);
      expect(im[i]).toBeCloseTo(0, 9);
    }
  });

  it('maps a bin-centred sine to the correct bin at ≈0 dBFS', () => {
    const an = new FftAnalyzer(N, SR);
    const bin = 200;
    const f = an.binToFrequency(bin);
    const db = an.analyze(sine(f, SR, N, 1));
    let maxBin = 0;
    for (let k = 1; k < an.binCount; k++) if (db[k] > db[maxBin]) maxBin = k;
    expect(maxBin).toBe(bin);
    expect(db[bin]).toBeGreaterThan(-0.5);
    expect(db[bin]).toBeLessThan(0.5);
    expect(an.frequencyToBin(f)).toBeCloseTo(bin, 9);
  });

  it('bin resolution is sampleRate / size', () => {
    expect(new FftAnalyzer(8192, 48000).binHz).toBeCloseTo(5.859375, 6);
    expect(new FftAnalyzer(8192, 44100).binHz).toBeCloseTo(5.383, 3);
  });
});

describe('quickSelect', () => {
  it('finds the median', () => {
    const v = Float32Array.from([9, 1, 8, 2, 7, 3, 6, 4, 5]);
    expect(quickSelect(v, 9, 4)).toBe(5);
  });
});

describe('FrequencyAnalyzer – peaks, floor and intensity', () => {
  it('locates an off-bin peak within 3 cents by parabolic interpolation', () => {
    const fa = analyse(sine(277.18, SR, N, 0.3));
    const peaks = peaksOf(fa.peaks);
    expect(peaks.length).toBeGreaterThanOrEqual(1);
    const strongest = peaks.reduce((a, b) => (b.db > a.db ? b : a));
    expect(centsError(strongest.f, 277.18)).toBeLessThan(3);
  });

  it('estimates a noise floor that tracks the background level', () => {
    const quiet = analyse(whiteNoise(N, 0.001, 2));
    const loud = analyse(whiteNoise(N, 0.03, 2));
    expect(loud.noiseFloorDb - quiet.noiseFloorDb).toBeGreaterThan(25);
    expect(loud.noiseFloorDb - quiet.noiseFloorDb).toBeLessThan(34);
  });

  it('pure noise produces high spectral flatness; a tone produces low flatness', () => {
    expect(analyse(whiteNoise(N, 0.05, 4)).spectralFlatness).toBeGreaterThan(0.4);
    expect(analyse(sine(220, SR, N, 0.3)).spectralFlatness).toBeLessThan(0.1);
  });

  it('a loud pure tone produces one peak – window sidelobes are not reported', () => {
    for (const f of [110, 185.3, 440.7, 1234.5]) {
      const fa = analyse(mix(sine(f, SR, N, 0.8), whiteNoise(N, 0.00001, 12)));
      const peaks = peaksOf(fa.peaks);
      expect(peaks.length).toBe(1);
      expect(centsError(peaks[0].f, f)).toBeLessThan(3);
    }
  });

  it('silence yields no peaks', () => {
    expect(analyse(new Float32Array(N)).peaks.count).toBe(0);
  });

  it('normalised intensity increases with signal level', () => {
    const noise = whiteNoise(N, 0.0005, 9);
    const fa = new FrequencyAnalyzer(SR, N, 32, { marginDb: 12 });
    // Establish the reference with a loud tone first.
    for (let i = 0; i < 4; i++) fa.analyze(mix(sine(220, SR, N, 0.5), noise), 0.02);
    const intensityAt = (amp: number) => {
      fa.analyze(mix(sine(220, SR, N, amp), noise), 0.02);
      const p = peaksOf(fa.peaks).find((x) => centsError(x.f, 220) < 20);
      return p ? p.intensity : 0;
    };
    const strong = intensityAt(0.5);
    const medium = intensityAt(0.05);
    const weak = intensityAt(0.005);
    expect(strong).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(weak);
    expect(strong).toBeLessThanOrEqual(1);
    expect(weak).toBeGreaterThanOrEqual(0);
  });

  it('resolves two simultaneous tones a whole tone apart', () => {
    const fa = analyse(mix(sine(185, SR, N, 0.3), sine(207.65, SR, N, 0.3)));
    const peaks = peaksOf(fa.peaks);
    expect(peaks.some((p) => centsError(p.f, 185) < 10)).toBe(true);
    expect(peaks.some((p) => centsError(p.f, 207.65) < 10)).toBe(true);
  });
});

describe('HarmonicAnalyzer – classification', () => {
  function classify(signal: Float32Array, hint = 0, hintConf = 0) {
    const fa = analyse(signal);
    const ha = new HarmonicAnalyzer(32);
    ha.analyze(fa.peaks, hint, hintConf, fa.spectralFlatness, fa.currentOptions.marginDb);
    return { peaks: peaksOf(fa.peaks), ha };
  }

  it('a harmonic-rich string tone yields one fundamental; overtones are harmonics', () => {
    const { peaks } = classify(mix(stringTone(138.59, SR, N, 0.4), whiteNoise(N, 0.0005, 3)));
    const fundamentals = peaks.filter((p) => p.cls === PeakClass.Fundamental);
    expect(fundamentals.length).toBe(1);
    expect(centsError(fundamentals[0].f, 138.59)).toBeLessThan(5);
    const harmonics = peaks.filter((p) => p.cls === PeakClass.Harmonic);
    expect(harmonics.length).toBeGreaterThanOrEqual(5);
    for (const h of harmonics) {
      expect(centsError(h.f, 138.59 * h.h)).toBeLessThan(40);
    }
  });

  it('does not label a loud 2nd harmonic as the played note', () => {
    const { peaks } = classify(harmonicTone(146.83, [0.1, 0.5, 0.2, 0.1], SR, N));
    const fundamentals = peaks.filter((p) => p.cls === PeakClass.Fundamental);
    expect(fundamentals.length).toBe(1);
    expect(centsError(fundamentals[0].f, 146.83)).toBeLessThan(5);
  });

  it('two simultaneous harmonic notes yield two fundamentals', () => {
    const { peaks } = classify(
      mix(stringTone(138.59, SR, N, 0.35, 6), stringTone(207.65, SR, N, 0.3, 6)),
    );
    const fundamentals = peaks.filter((p) => p.cls === PeakClass.Fundamental).map((p) => p.f);
    expect(fundamentals.some((f) => centsError(f, 138.59) < 10)).toBe(true);
    expect(fundamentals.some((f) => centsError(f, 207.65) < 10)).toBe(true);
  });

  it('a weak isolated in-tune tone beside a loud note is classified as resonance', () => {
    const signal = mix(
      stringTone(138.59, SR, N, 0.4, 6),
      sine(311.13, SR, N, 0.004),
      whiteNoise(N, 0.00005, 5),
    );
    const { peaks } = classify(signal, 138.59, 0.95);
    const res = peaks.find((p) => centsError(p.f, 311.13) < 15);
    expect(res).toBeDefined();
    expect(res!.cls).toBe(PeakClass.Resonance);
  });

  it('a quieter pure tone without overtones beside a played note is resonance, not a second note', () => {
    const signal = mix(
      stringTone(185, SR, N, 0.4, 8),
      sine(207.65, SR, N, 0.02),
      whiteNoise(N, 0.0001, 8),
    );
    const { peaks } = classify(signal, 185, 0.95);
    const taraf = peaks.find((p) => centsError(p.f, 207.65) < 15);
    expect(taraf).toBeDefined();
    expect(taraf!.cls).toBe(PeakClass.Resonance);
    expect(peaks.filter((p) => p.cls === PeakClass.Fundamental).length).toBe(1);
  });

  it('noise frames produce no fundamentals', () => {
    const { ha } = classify(whiteNoise(N, 0.1, 11));
    expect(ha.fundamentalCount).toBe(0);
  });

  it('a weak sub-octave tone does not steal the louder note’s harmonic series', () => {
    // Taraf at 92.5 Hz quietly ringing under a loud 185 Hz note.
    const signal = mix(stringTone(185, SR, N, 0.4, 8), sine(92.5, SR, N, 0.01));
    const { peaks } = classify(signal, 185, 0.95);
    const f185 = peaks.find((p) => centsError(p.f, 185) < 10);
    expect(f185?.cls).toBe(PeakClass.Fundamental);
    const f92 = peaks.find((p) => centsError(p.f, 92.5) < 10);
    if (f92) expect(f92.cls).not.toBe(PeakClass.Fundamental);
  });
});

describe('PitchLineTracker – visual smoothing and decay', () => {
  function packed(...peaks: [number, number, PeakClass][]) {
    const arr = new Float32Array(peaks.length * PEAK_STRIDE);
    peaks.forEach(([f, intensity, cls], i) => {
      arr.set([f, -20, 30, intensity, cls, cls === PeakClass.Fundamental ? 1 : 0], i * PEAK_STRIDE);
    });
    return arr;
  }

  it('attacks quickly and decays slowly after the sound stops', () => {
    const t = new PitchLineTracker();
    t.ingest(packed([220, 1, PeakClass.Fundamental]), 1);
    t.step(0.1);
    const afterAttack = t.lines[0].intensity;
    expect(afterAttack).toBeGreaterThan(0.9);
    t.ingest(new Float32Array(0), 0);
    t.step(0.1);
    const afterRelease = t.lines[0].intensity;
    expect(afterRelease).toBeLessThan(afterAttack);
    expect(afterRelease).toBeGreaterThan(0.6);
    for (let i = 0; i < 60; i++) t.step(0.05);
    expect(t.idle).toBe(true);
  });

  it('keeps one line for a slightly drifting pitch', () => {
    const t = new PitchLineTracker();
    for (let i = 0; i < 10; i++) {
      t.ingest(packed([220 + i * 0.3, 0.8, PeakClass.Fundamental]), 1);
      t.step(0.02);
    }
    expect(t.lines.length).toBe(1);
  });

  it('applies classification hysteresis to avoid flicker', () => {
    const t = new PitchLineTracker({ classHysteresisFrames: 3 });
    t.ingest(packed([220, 0.8, PeakClass.Fundamental]), 1);
    t.ingest(packed([220, 0.8, PeakClass.LowConfidence]), 1);
    expect(t.lines[0].cls).toBe(PeakClass.Fundamental);
    t.ingest(packed([220, 0.8, PeakClass.LowConfidence]), 1);
    t.ingest(packed([220, 0.8, PeakClass.LowConfidence]), 1);
    expect(t.lines[0].cls).toBe(PeakClass.LowConfidence);
  });

  it('tracks simultaneous components independently', () => {
    const t = new PitchLineTracker();
    t.ingest(packed([138.6, 0.9, PeakClass.Fundamental], [207.7, 0.4, PeakClass.Fundamental]), 2);
    t.step(0.1);
    expect(t.lines.length).toBe(2);
    expect(t.lines[0].intensity).toBeGreaterThan(t.lines[1].intensity);
  });
});
