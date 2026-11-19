/**
 * Message protocol between the Angular main thread and the analysis AudioWorklet.
 * Shared by both sides – keep this file free of DOM / Angular imports.
 */
import { NoiseFilterLevel } from '../dsp/noise-filter';

export const ANALYSIS_PROCESSOR_NAME = 'sur-analysis-processor';
/** Served from /public, bundled by scripts/build-worklet.mjs. */
export const ANALYSIS_WORKLET_URL = 'worklets/sur-analysis.worklet.js';

export interface AnalysisConfig {
  /** Fundamental search range for the pitch detector (Hz). */
  minFrequency: number;
  maxFrequency: number;
  /** 0 (strict) … 1 (sensitive). Affects YIN threshold and spectral margin. */
  sensitivity: number;
  noiseFilter: NoiseFilterLevel;
  /** Enables FFT peak analysis (only needed by the Sur Spectrum). */
  spectrumEnabled: boolean;
  /** Upper frequency limit for spectrum peaks (Hz). */
  spectrumMaxFrequency: number;
  a4: number;
}

export const DEFAULT_ANALYSIS_CONFIG: AnalysisConfig = {
  minFrequency: 55,
  maxFrequency: 1400,
  sensitivity: 0.6,
  noiseFilter: 'medium',
  spectrumEnabled: false,
  spectrumMaxFrequency: 4000,
  a4: 440,
};

export type MainToWorkletMessage =
  { readonly type: 'configure'; readonly config: AnalysisConfig } | { readonly type: 'reset' };

export interface WorkletReadyMessage {
  readonly type: 'ready';
  readonly sampleRate: number;
  readonly pitchWindow: number;
  readonly fftSize: number;
  readonly hopSize: number;
}

export interface AnalysisFrameMessage {
  readonly type: 'frame';
  /** AudioContext time (s) at the end of the analysed window. */
  readonly time: number;
  /** RMS of the analysed window, dBFS. */
  readonly levelDb: number;
  /** Adaptive background level, dBFS. */
  readonly noiseFloorDb: number;
  readonly gateOpen: boolean;
  /** Smoothed, gated fundamental. 0 when none. */
  readonly frequency: number;
  readonly confidence: number;
  readonly active: boolean;
  readonly stable: boolean;
  readonly held: boolean;
  /** Unsmoothed detector output (diagnostics). */
  readonly rawFrequency: number;
  readonly rawConfidence: number;
  /** Spectrum data – present only when spectrum analysis is enabled. */
  readonly spectrum: {
    readonly floorDb: number;
    readonly flatness: number;
    readonly count: number;
    /** Packed with PEAK_STRIDE fields per peak (see spectrum-result.model.ts). */
    readonly peaks: Float32Array;
  } | null;
}

export type WorkletToMainMessage = WorkletReadyMessage | AnalysisFrameMessage;
