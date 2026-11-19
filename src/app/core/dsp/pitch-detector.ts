import { PitchEstimate } from '../models/pitch-result.model';

export interface PitchDetector {
  /** Number of samples the detector expects per call. */
  readonly bufferSize: number;
  /** Analyses the latest `bufferSize` samples. The returned object is reused between calls. */
  detect(samples: Float32Array): PitchEstimate;
}

export function createPitchEstimate(): PitchEstimate {
  return { frequency: 0, confidence: 0, periodic: false, rmsDb: -Infinity };
}

/** Next power of two ≥ value. */
export function nextPowerOfTwo(value: number): number {
  let p = 1;
  while (p < value) p <<= 1;
  return p;
}

export function rmsToDb(rms: number): number {
  return 20 * Math.log10(rms + 1e-12);
}
