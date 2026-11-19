/**
 * AudioWorklet entry point. Bundled separately (scripts/build-worklet.mjs) into
 * public/worklets/sur-analysis.worklet.js because worklet modules are loaded by
 * URL through `audioWorklet.addModule()`, outside the Angular bundle.
 *
 * All pitch detection and spectral analysis runs here, on the real-time audio
 * thread, so the Angular main thread only receives compact result frames
 * (~50 per second, a few hundred bytes each). No audio is recorded, stored or
 * transmitted – samples live only in a small in-memory ring buffer.
 */
import { AnalysisPipeline } from '../../dsp/analysis-pipeline';
import {
  ANALYSIS_PROCESSOR_NAME,
  MainToWorkletMessage,
  WorkletReadyMessage,
} from '../analysis-protocol';

// Minimal AudioWorkletGlobalScope typings (not part of lib.dom).
declare const sampleRate: number;
declare function registerProcessor(
  name: string,
  ctor: new (options?: unknown) => AudioWorkletProcessorBase,
): void;
interface AudioWorkletProcessorBase {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessorBase;
  new (options?: unknown): AudioWorkletProcessorBase;
};

class SurAnalysisProcessor extends AudioWorkletProcessor {
  private readonly pipeline = new AnalysisPipeline(sampleRate);
  private alive = true;

  constructor(options?: unknown) {
    super(options);
    this.port.onmessage = (event: MessageEvent<MainToWorkletMessage | { type: 'dispose' }>) => {
      const msg = event.data;
      if (msg.type === 'configure') {
        this.pipeline.configure(msg.config);
      } else if (msg.type === 'reset') {
        this.pipeline.reset();
      } else if (msg.type === 'dispose') {
        this.alive = false;
      }
    };
    const ready: WorkletReadyMessage = {
      type: 'ready',
      sampleRate,
      pitchWindow: this.pipeline.pitchWindow,
      fftSize: this.pipeline.fftSize,
      hopSize: this.pipeline.hopSize,
    };
    this.port.postMessage(ready);
  }

  override process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      const frame = this.pipeline.push(channel);
      if (frame) {
        if (frame.spectrum) {
          this.port.postMessage(frame, [frame.spectrum.peaks.buffer]);
        } else {
          this.port.postMessage(frame);
        }
      }
    }
    // Output stays silent (zero-filled by the engine). Keep alive until disposed.
    return this.alive;
  }
}

registerProcessor(ANALYSIS_PROCESSOR_NAME, SurAnalysisProcessor);
