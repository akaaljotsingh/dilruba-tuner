import { TuningResult, TuningStatus, TuningTolerances } from '../models/tuning-result.model';
import { centsBetween } from './cents-calculator';

export interface ReadingQuality {
  /** Detector confidence is high enough to trust the reading. */
  readonly confident: boolean;
  /** The reading has been steady for several frames. */
  readonly stable: boolean;
}

/** Boundary (cents) between "Flat/Sharp" and "Very Flat/Very Sharp". */
export function farThreshold(tolerances: TuningTolerances): number {
  return Math.max(25, tolerances.acceptableCents * 2.5);
}

export function tuningStatus(cents: number, tolerances: TuningTolerances): TuningStatus {
  const a = Math.abs(cents);
  if (a <= tolerances.perfectCents) return 'in-tune';
  const flat = cents < 0;
  if (a <= tolerances.acceptableCents) return flat ? 'slightly-flat' : 'slightly-sharp';
  if (a <= farThreshold(tolerances)) return flat ? 'flat' : 'sharp';
  return flat ? 'very-flat' : 'very-sharp';
}

/**
 * Compares a detected frequency with a wire's target and produces the
 * player-facing status and tightening / loosening advice.
 *
 * Physics: string pitch rises with tension, so a flat (low) reading means the
 * wire is too loose → tighten; a sharp (high) reading means too tight → loosen.
 * No advice is given unless the reading is both confident and stable.
 */
export function evaluateTuning(
  detectedHz: number,
  targetHz: number,
  tolerances: TuningTolerances,
  quality: ReadingQuality,
): TuningResult {
  const cents = centsBetween(detectedHz, targetHz);
  const status = Number.isFinite(cents) ? tuningStatus(cents, tolerances) : 'in-tune';
  const withinPerfect = Math.abs(cents) <= tolerances.perfectCents;
  const withinAcceptable = Math.abs(cents) <= tolerances.acceptableCents;
  const octaveOffset = Math.abs(cents) >= 600 ? Math.round(cents / 1200) : 0;

  const base = { cents, status, withinPerfect, withinAcceptable, octaveOffset };

  if (!Number.isFinite(cents) || !quality.confident) {
    return {
      ...base,
      action: 'wait',
      headline: 'Listening…',
      guidance: 'Play the selected wire on its own and let it ring.',
    };
  }

  if (octaveOffset !== 0) {
    const n = Math.abs(octaveOffset);
    const where = octaveOffset > 0 ? 'above' : 'below';
    return {
      ...base,
      action: 'wait',
      headline: `${n === 1 ? 'One octave' : `${n} octaves`} ${where} the target`,
      guidance:
        octaveOffset > 0
          ? 'This may be a harmonic or a different wire. Check you are playing the selected wire, and the target octave in Instrument settings.'
          : 'Check you are playing the selected wire. Never tighten a wire by a large amount at once.',
    };
  }

  if (!quality.stable) {
    return {
      ...base,
      action: 'wait',
      headline: 'Hold the note steady…',
      guidance: 'Wait for a stable pitch reading before turning the peg.',
    };
  }

  if (withinPerfect) {
    return {
      ...base,
      action: 'none',
      headline: 'Perfectly Tuned!',
      guidance: 'Stop adjusting – this wire is centred.',
    };
  }

  const flat = cents < 0;
  if (withinAcceptable) {
    return {
      ...base,
      action: flat ? 'tighten' : 'loosen',
      headline: flat ? 'Almost there – a touch flat' : 'Almost there – a touch sharp',
      guidance: flat ? 'Tighten very slightly.' : 'Loosen very slightly.',
    };
  }

  const far = Math.abs(cents) > farThreshold(tolerances);
  if (flat) {
    return {
      ...base,
      action: 'tighten',
      headline: 'Wire is too loose.',
      guidance: far ? 'Tighten gradually, re-playing the wire as you go.' : 'Tighten slightly.',
    };
  }
  return {
    ...base,
    action: 'loosen',
    headline: 'Wire is too tight.',
    guidance: far ? 'Loosen gradually, re-playing the wire as you go.' : 'Loosen slightly.',
  };
}
