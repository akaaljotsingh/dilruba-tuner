import { DEFAULT_ANALYSIS_CONFIG } from '../audio/analysis-protocol';
import { PEAK_STRIDE, PeakClass } from '../models/spectrum-result.model';
import { AnalysisPipeline } from './analysis-pipeline';
import { centsError, mix, stringTone, whiteNoise } from './testing/synthetic-signals';

/** Streams a signal through the pipeline in 128-sample render quanta, like an AudioWorklet. */
function stream(pipeline: AnalysisPipeline, signal: Float32Array) {
  const frames = [];
  for (let i = 0; i + 128 <= signal.length; i += 128) {
    const f = pipeline.push(signal.subarray(i, i + 128));
    if (f) frames.push(f);
  }
  return frames;
}

describe('AnalysisPipeline (end-to-end, synthetic input)', () => {
  const SR = 48000;

  it('chooses window sizes appropriate to the sample rate', () => {
    expect(new AnalysisPipeline(48000).pitchWindow).toBe(4096);
    expect(new AnalysisPipeline(44100).pitchWindow).toBe(4096);
    expect(new AnalysisPipeline(96000).pitchWindow).toBe(8192);
    expect(new AnalysisPipeline(48000).fftSize).toBe(8192);
    expect(new AnalysisPipeline(48000).hopSize % 128).toBe(0);
  });

  it('produces a stable smoothed pitch for a sustained string tone', () => {
    const p = new AnalysisPipeline(SR);
    const signal = mix(
      whiteNoise(SR / 2, 0.0003, 1),
      stringTone(185, SR, SR, 0.3).subarray(0, SR / 2),
    );
    const frames = stream(p, mix(whiteNoise(SR / 4, 0.0003, 2), new Float32Array(0)));
    frames.push(...stream(p, signal));
    const last = frames[frames.length - 1];
    expect(last.active).toBe(true);
    expect(last.stable).toBe(true);
    expect(centsError(last.frequency, 185)).toBeLessThan(1.5);
    // ~50 analyses per second
    expect(frames.length).toBeGreaterThan(30);
  });

  it('keeps tracking across sudden pitch changes (regression: gate lock-out)', () => {
    const p = new AnalysisPipeline(SR);
    p.configure({ ...DEFAULT_ANALYSIS_CONFIG, spectrumEnabled: true });
    const notes = [185.6, 181, 185.1, 138.59, 185.6, 103.83];
    for (const f of notes) {
      const frames = stream(p, stringTone(f, SR, SR / 2, 0.3));
      const last = frames[frames.length - 1];
      expect(last.gateOpen).toBe(true);
      expect(last.active).toBe(true);
      expect(centsError(last.frequency, f)).toBeLessThan(2);
    }
  });

  it('reports no pitch in background noise', () => {
    const p = new AnalysisPipeline(SR);
    const frames = stream(p, whiteNoise(SR, 0.01, 4));
    const confident = frames.filter((f) => f.active && f.stable);
    expect(confident.length).toBe(0);
  });

  it('emits classified spectrum peaks only when the spectrum is enabled', () => {
    const p = new AnalysisPipeline(SR);
    let frames = stream(p, stringTone(138.59, SR, SR / 2, 0.3));
    expect(frames[frames.length - 1].spectrum).toBeNull();

    p.configure({ ...DEFAULT_ANALYSIS_CONFIG, spectrumEnabled: true });
    frames = stream(p, stringTone(138.59, SR, SR / 2, 0.3));
    const spec = frames[frames.length - 1].spectrum!;
    expect(spec).not.toBeNull();
    expect(spec.peaks.length).toBe(spec.count * PEAK_STRIDE);
    const fundamentals: number[] = [];
    for (let i = 0; i < spec.count; i++) {
      if (spec.peaks[i * PEAK_STRIDE + 4] === PeakClass.Fundamental)
        fundamentals.push(spec.peaks[i * PEAK_STRIDE]);
    }
    expect(fundamentals.length).toBe(1);
    expect(centsError(fundamentals[0], 138.59)).toBeLessThan(5);
  });
});
