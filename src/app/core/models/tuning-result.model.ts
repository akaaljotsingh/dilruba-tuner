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

export type TuningAction = 'tighten' | 'loosen' | 'none' | 'wait';

export interface TuningResult {
  readonly cents: number;
  readonly status: TuningStatus;
  readonly withinPerfect: boolean;
  readonly withinAcceptable: boolean;
  readonly action: TuningAction;
  /** Short headline, e.g. "Perfectly Tuned!" */
  readonly headline: string;
  /** Extra guidance for the player. */
  readonly guidance: string;
  /** Detected pitch is roughly an octave (or more) away from the target. */
  readonly octaveOffset: number;
}
