import {
  AnalysisConfig,
  AnalysisFrameMessage,
  DEFAULT_ANALYSIS_CONFIG,
} from '../audio/analysis-protocol';
import { PEAK_STRIDE } from '../models/spectrum-result.model';
import { PitchSmoother } from './audio-smoother';
import { FrequencyAnalyzer } from './frequency-analyzer';
import { HarmonicAnalyzer } from './harmonic-analyzer';
import { AdaptiveNoiseGate, BiquadHighPass, NOISE_FILTER_PROFILES } from './noise-filter';
import { nextPowerOfTwo } from './pitch-detector';
import { YinPitchDetector } from './yin-pitch-detector';

const MAX_PEAKS = 32;

/**
 * The complete real-time analysis chain, independent of where it runs.
 * The AudioWorklet feeds it 128-sample render quanta; unit tests feed it
 * synthetic signals directly.
 *
 *   input → high-pass → ring buffer ─┬→ YIN → noise gate → smoother → pitch
 *                                     └→ FFT → floor → peaks → harmonic classes
 */
export class AnalysisPipeline {
  readonly sampleRate: number;
  readonly pitchWindow: number;
  readonly fftSize: number;
  readonly hopSize: number;

  private config: AnalysisConfig = { ...DEFAULT_ANALYSIS_CONFIG };
  private readonly ring: Float32Array;
  private ringWrite = 0;
  private ringFilled = 0;
  private sinceHop = 0;
  private samplesProcessed = 0;
  private readonly pitchBuffer: Float32Array;
  private readonly spectrumBuffer: Float32Array;
  private readonly highpass: BiquadHighPass;
  private readonly yin: YinPitchDetector;
  private readonly gate = new AdaptiveNoiseGate();
  private readonly smoother = new PitchSmoother();
  private readonly spectrum: FrequencyAnalyzer;
  private readonly harmonics = new HarmonicAnalyzer(MAX_PEAKS);

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    // ≈85 ms window: ≥ 2 periods of 50 Hz with N/2 lag range. 4096 @ 44.1/48 kHz.
    this.pitchWindow = nextPowerOfTwo(Math.round(sampleRate * 0.085));
    // ≈170 ms window: ~5.9 Hz bins @ 48 kHz – resolves adjacent semitones down to ~110 Hz.
    this.fftSize = nextPowerOfTwo(Math.round(sampleRate * 0.17));
    // ≈50 analyses per second, aligned to 128-sample render quanta.
    this.hopSize = Math.max(128, Math.round(sampleRate / 50 / 128) * 128);
    const ringSize = Math.max(this.pitchWindow, this.fftSize);
    this.ring = new Float32Array(ringSize);
    this.pitchBuffer = new Float32Array(this.pitchWindow);
    this.spectrumBuffer = new Float32Array(this.fftSize);
    this.highpass = new BiquadHighPass(sampleRate, 40);
    this.yin = new YinPitchDetector(sampleRate, this.pitchWindow);
    this.spectrum = new FrequencyAnalyzer(sampleRate, this.fftSize, MAX_PEAKS);
    this.configure(this.config);
  }

  get currentConfig(): Readonly<AnalysisConfig> {
    return this.config;
  }

  configure(config: AnalysisConfig): void {
    const prev = this.config;
    this.config = { ...config };
    const s = Math.min(1, Math.max(0, config.sensitivity));
    const profile = NOISE_FILTER_PROFILES[config.noiseFilter] ?? NOISE_FILTER_PROFILES.medium;
    const minF = Math.max(20, config.minFrequency);
    const maxF = Math.max(minF * 2, config.maxFrequency);

    this.highpass.setCutoff(config.noiseFilter === 'off' ? 20 : Math.max(25, minF * 0.6));
    this.yin.configure({
      minFrequency: minF,
      maxFrequency: maxF,
      threshold: 0.1 + 0.12 * s,
      fallbackThreshold: 0.25 + 0.15 * s,
    });
    this.smoother.configure({ minConfidence: 0.86 - 0.12 * s });
    this.spectrum.configure({
      minFrequency: minF,
      maxFrequency: Math.max(maxF, config.spectrumMaxFrequency),
      marginDb: 16 - 8 * s + profile.spectrumExtraMarginDb,
      absoluteFloorDb: profile.absoluteMinDb - 20,
    });
    this.harmonics.configure({ minFundamental: minF, maxFundamental: maxF, a4: config.a4 });
    if (prev.minFrequency !== config.minFrequency || prev.maxFrequency !== config.maxFrequency) {
      this.smoother.reset();
    }
  }

  reset(): void {
    this.ring.fill(0);
    this.ringWrite = 0;
    this.ringFilled = 0;
    this.sinceHop = 0;
    this.highpass.reset();
    this.gate.reset();
    this.smoother.reset();
    this.spectrum.reset();
  }

  /**
   * Pushes samples. Returns a frame message every hop, otherwise null.
   * When several hops elapse within one call only the last frame is returned.
   */
  push(input: Float32Array): AnalysisFrameMessage | null {
    let frame: AnalysisFrameMessage | null = null;
    const ring = this.ring;
    const size = ring.length;
    for (let i = 0; i < input.length; i++) {
      ring[this.ringWrite] = this.highpass.process(input[i]);
      this.ringWrite = this.ringWrite + 1 === size ? 0 : this.ringWrite + 1;
      this.sinceHop++;
      if (this.sinceHop >= this.hopSize) {
        this.sinceHop = 0;
        this.ringFilled = Math.min(size, this.ringFilled + this.hopSize);
        if (this.ringFilled >= this.pitchWindow) {
          frame = this.analyse((this.samplesProcessed + i + 1) / this.sampleRate);
        }
      }
    }
    this.samplesProcessed += input.length;
    return frame;
  }

  private copyLatest(target: Float32Array): void {
    const ring = this.ring;
    const size = ring.length;
    const n = target.length;
    let start = this.ringWrite - n;
    if (start < 0) start += size;
    const firstPart = Math.min(n, size - start);
    target.set(ring.subarray(start, start + firstPart), 0);
    if (firstPart < n) target.set(ring.subarray(0, n - firstPart), firstPart);
  }

  private analyse(time: number): AnalysisFrameMessage {
    const dt = this.hopSize / this.sampleRate;
    const profile = NOISE_FILTER_PROFILES[this.config.noiseFilter] ?? NOISE_FILTER_PROFILES.medium;

    this.copyLatest(this.pitchBuffer);
    const estimate = this.yin.detect(this.pitchBuffer);
    const voiced = estimate.periodic && estimate.confidence > 0.75;
    const gateOpen = this.gate.isOpen(estimate.rmsDb, profile);
    this.gate.update(estimate.rmsDb, voiced, dt);

    const gatedFrequency = gateOpen ? estimate.frequency : 0;
    const gatedConfidence = gateOpen ? estimate.confidence : 0;
    const smoothed = this.smoother.update(gatedFrequency, gatedConfidence, time, dt);

    let spectrum: AnalysisFrameMessage['spectrum'] = null;
    if (this.config.spectrumEnabled && this.ringFilled >= this.fftSize) {
      this.copyLatest(this.spectrumBuffer);
      const peaks = this.spectrum.analyze(this.spectrumBuffer, dt);
      const hintF = smoothed.active && !smoothed.held ? smoothed.frequency : 0;
      this.harmonics.analyze(
        peaks,
        hintF,
        hintF > 0 ? smoothed.confidence : 0,
        this.spectrum.spectralFlatness,
        this.spectrum.currentOptions.marginDb,
      );
      const packed = new Float32Array(peaks.count * PEAK_STRIDE);
      for (let i = 0; i < peaks.count; i++) {
        const o = i * PEAK_STRIDE;
        packed[o] = peaks.frequency[i];
        packed[o + 1] = peaks.db[i];
        packed[o + 2] = peaks.snr[i];
        packed[o + 3] = peaks.intensity[i];
        packed[o + 4] = peaks.cls[i];
        packed[o + 5] = peaks.harmonic[i];
      }
      spectrum = {
        floorDb: this.spectrum.noiseFloorDb,
        flatness: this.spectrum.spectralFlatness,
        count: peaks.count,
        peaks: packed,
      };
    }

    return {
      type: 'frame',
      time,
      levelDb: estimate.rmsDb,
      noiseFloorDb: this.gate.floorDb,
      gateOpen,
      frequency: smoothed.active ? smoothed.frequency : 0,
      confidence: smoothed.confidence,
      active: smoothed.active,
      stable: smoothed.stable,
      held: smoothed.held,
      rawFrequency: estimate.frequency,
      rawConfidence: estimate.confidence,
      spectrum,
    };
  }
}
