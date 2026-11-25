export type TuningStatus =
  'very-flat' | 'flat' | 'slightly-flat' | 'in-tune' | 'slightly-sharp' | 'sharp' | 'very-sharp';

export const TUNING_STATUS_LABELS: Record<TuningStatus, string> = {
  'very-flat': 'Very Flat',
  flat: 'Flat',
  'slightly-flat': 'Slightly Flat',
  'in-tune': 'In Tune',
  'slightly-sharp': 'Slightly Sharp',
  sharp: 'Sharp',
  'very-sharp': 'Very Sharp',
};

export interface TuningTolerances {
  /** |cents| within this is "Perfectly tuned". */
  readonly perfectCents: number;
  /** |cents| within this is acceptable (slightly flat / sharp). */
  readonly acceptableCents: number;
}

export const DEFAULT_TOLERANCES: TuningTolerances = { perfectCents: 3, acceptableCents: 10 };

export type TuningAction = 'tighten' | 'loosen' | 'none' | 'wait' | 'check';

/**
 * How the reading relates to the target:
 * - `direct`: within ±50¢ of the target – normal fine tuning.
 * - `octave`: the same swara one or more saptaks away (usually a harmonic). Tuning
 *   still works on the octave-equivalent pitch, because the harmonic moves with the wire.
 * - `far`:    a different note – coarse direction only.
 */
export type TuningMode = 'direct' | 'octave' | 'far';

/** Which way the pitch has to move: `up` = tighten, `down` = loosen. */
export type PitchDirection = 'up' | 'down' | 'none';

export interface TuningResult {
  /** Raw deviation from the target in cents. */
  readonly cents: number;
  /** Deviation shown on the ±50¢ meter (octave-folded, or pegged when far). */
  readonly meterCents: number;
  readonly mode: TuningMode;
  readonly direction: PitchDirection;
  readonly status: TuningStatus;
  readonly withinPerfect: boolean;
  readonly withinAcceptable: boolean;
  readonly action: TuningAction;
  /** Short headline, e.g. "Perfectly Tuned!" */
  readonly headline: string;
  /** Extra guidance for the player. */
  readonly guidance: string;
  /** Whole octaves between the reading and the target (positive = above). */
  readonly octaveOffset: number;
  /** Signed whole semitones from the target. */
  readonly semitones: number;
  /** Human distance, e.g. "2 saptaks above", "3 semitones below", "" when within ±50¢. */
  readonly distanceLabel: string;
}
