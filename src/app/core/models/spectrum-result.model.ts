/** How a spectral peak has been interpreted by the harmonic analyser. */
export const PeakClass = {
  /** Most likely the fundamental of a played (or strongly ringing) note. */
  Fundamental: 0,
  /** An overtone of a detected fundamental – not a separately played swara. */
  Harmonic: 1,
  /** A weaker, isolated, steady tone – typically a sympathetic (taraf) string ringing. */
  Resonance: 2,
  /** A peak we cannot interpret reliably. Displayed faintly, without a swara label. */
  LowConfidence: 3,
  /** Barely above the noise floor. */
  Noise: 4,
} as const;

export type PeakClass = (typeof PeakClass)[keyof typeof PeakClass];

export const PEAK_CLASS_LABELS: Record<PeakClass, string> = {
  0: 'Fundamental',
  1: 'Harmonic',
  2: 'Resonance',
  3: 'Uncertain',
  4: 'Noise',
};

/**
 * Peaks are transported from the audio thread as a flat Float32Array with this stride:
 * [frequency, dBFS, dB above noise floor, intensity 0–1, class, harmonic number]
 */
export const PEAK_STRIDE = 6;
export const PEAK_FIELD = {
  frequency: 0,
  db: 1,
  snr: 2,
  intensity: 3,
  cls: 4,
  harmonic: 5,
} as const;

export interface SpectralPeak {
  frequency: number;
  /** Level relative to digital full scale (a full-scale sine ≈ 0 dB). Not dB SPL. */
  db: number;
  /** Level above the estimated noise floor in dB. */
  snr: number;
  /** Relative intensity 0–1 after noise-floor removal and dynamic-range normalisation. */
  intensity: number;
  cls: PeakClass;
  /** 1 for fundamentals, n for the n-th harmonic, 0 when unrelated. */
  harmonic: number;
}
