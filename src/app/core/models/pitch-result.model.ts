/** Raw single-frame output of a monophonic pitch detector. Objects are reused – copy if you keep them. */
export interface PitchEstimate {
  /** Detected fundamental in Hz, or 0 when no periodic signal was found. */
  frequency: number;
  /** 0–1. For YIN this is 1 − d′(τ) at the chosen period. */
  confidence: number;
  /** True when the detector found a dip below its absolute threshold. */
  periodic: boolean;
  /** RMS level of the analysed window in dBFS (relative to digital full scale). */
  rmsDb: number;
}

/** Output of the temporal smoother. */
export interface SmoothedPitch {
  /** Smoothed fundamental in Hz, 0 when inactive. */
  frequency: number;
  confidence: number;
  /** A pitch is currently being tracked (possibly held through a short drop-out). */
  active: boolean;
  /** The reading has been steady for several frames – safe to give tuning advice. */
  stable: boolean;
  /** The current value is being held from a previous frame because the latest one was unreliable. */
  held: boolean;
}
