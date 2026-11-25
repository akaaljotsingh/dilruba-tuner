import {
  PitchDirection,
  TuningMode,
  TuningResult,
  TuningStatus,
  TuningTolerances,
} from '../models/tuning-result.model';
import { centsBetween } from './cents-calculator';

export interface ReadingQuality {
  /** Detector confidence is high enough to trust the reading. */
  readonly confident: boolean;
  /** The reading has been steady for several frames. */
  readonly stable: boolean;
}

/** Half the meter's span: beyond this the needle pegs. */
export const METER_RANGE_CENTS = 50;

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

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "2 saptaks above", "1 saptak + 3 semitones below", "5 semitones above". */
export function describeDistance(cents: number): string {
  const semis = Math.round(Math.abs(cents) / 100);
  if (semis === 0) return '';
  const octaves = Math.floor(semis / 12);
  const rest = semis % 12;
  const where = cents > 0 ? 'above' : 'below';
  const parts: string[] = [];
  if (octaves) parts.push(plural(octaves, 'saptak'));
  if (rest) parts.push(plural(rest, 'semitone'));
  return `${parts.join(' + ')} ${where}`;
}

/**
 * Compares a detected frequency with a wire's target and produces the
 * player-facing status, direction and tightening / loosening advice.
 *
 * Physics: string pitch rises with tension, so a flat (low) reading means the
 * wire is too loose → tighten; a sharp (high) reading means too tight → loosen.
 *
 * A reading that is the same swara in another saptak (very common: the tuner
 * hears the wire's 2nd or 4th harmonic) is tuned on its octave-equivalent pitch,
 * since every harmonic rises and falls with the wire. Readings that are a
 * different note get a coarse direction and distance instead of a pegged meter.
 *
 * No tighten / loosen advice is given unless the reading is confident and stable.
 */
export function evaluateTuning(
  detectedHz: number,
  targetHz: number,
  tolerances: TuningTolerances,
  quality: ReadingQuality,
): TuningResult {
  const cents = centsBetween(detectedHz, targetHz);
  const valid = Number.isFinite(cents);
  const octaveOffset = valid ? Math.round(cents / 1200) : 0;
  const folded = valid ? cents - 1200 * octaveOffset : 0;

  let mode: TuningMode;
  let meterCents: number;
  if (!valid || (octaveOffset === 0 && Math.abs(cents) <= METER_RANGE_CENTS)) {
    mode = 'direct';
    meterCents = valid ? cents : 0;
  } else if (octaveOffset !== 0 && Math.abs(folded) <= METER_RANGE_CENTS) {
    mode = 'octave';
    meterCents = folded;
  } else {
    mode = 'far';
    meterCents = Math.sign(cents) * (METER_RANGE_CENTS + 10);
  }

  const status = tuningStatus(meterCents, tolerances);
  const withinPerfect = mode !== 'far' && Math.abs(meterCents) <= tolerances.perfectCents;
  const withinAcceptable = mode !== 'far' && Math.abs(meterCents) <= tolerances.acceptableCents;
  const direction: PitchDirection =
    !valid || withinPerfect ? 'none' : meterCents < 0 ? 'up' : 'down';
  const semitones = valid ? Math.round(cents / 100) : 0;
  const distanceLabel =
    mode === 'octave'
      ? `${plural(Math.abs(octaveOffset), 'saptak')} ${octaveOffset > 0 ? 'above' : 'below'}`
      : mode === 'far'
        ? describeDistance(cents)
        : '';

  const base = {
    cents,
    meterCents,
    mode,
    direction,
    status,
    withinPerfect,
    withinAcceptable,
    octaveOffset,
    semitones,
    distanceLabel,
  };

  if (!valid || !quality.confident) {
    return {
      ...base,
      direction: 'none',
      action: 'wait',
      headline: 'Listening…',
      guidance: 'Play the selected wire on its own and let it ring.',
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

  if (mode === 'far') {
    const below = cents < 0;
    const overAnOctaveAbove = !below && cents > 1200 - METER_RANGE_CENTS;
    if (overAnOctaveAbove) {
      return {
        ...base,
        action: 'check',
        headline: 'Far above the target',
        guidance:
          'This is probably a different wire or an overtone. Check the selected wire; if it really is this wire, loosen gradually.',
      };
    }
    return {
      ...base,
      action: below ? 'tighten' : 'loosen',
      headline: below ? 'Wire is far too loose.' : 'Wire is far too tight.',
      guidance: below
        ? 'Tighten gradually, re-playing the wire as you go. Never turn a peg a long way at once.'
        : 'Loosen gradually, re-playing the wire as you go.',
    };
  }

  const viaOctave =
    mode === 'octave'
      ? ` (Hearing it ${plural(Math.abs(octaveOffset), 'saptak')} ${octaveOffset > 0 ? 'higher' : 'lower'} – tuning still works.)`
      : '';

  if (withinPerfect) {
    return {
      ...base,
      action: 'none',
      headline: 'Perfectly Tuned!',
      guidance: `Stop adjusting – this wire is centred.${viaOctave}`,
    };
  }

  const flat = meterCents < 0;
  if (withinAcceptable) {
    return {
      ...base,
      action: flat ? 'tighten' : 'loosen',
      headline: flat ? 'Almost there – a touch flat' : 'Almost there – a touch sharp',
      guidance: `${flat ? 'Tighten very slightly.' : 'Loosen very slightly.'}${viaOctave}`,
    };
  }

  const far = Math.abs(meterCents) > farThreshold(tolerances);
  if (flat) {
    return {
      ...base,
      action: 'tighten',
      headline: 'Wire is too loose.',
      guidance: `${far ? 'Tighten gradually, re-playing the wire as you go.' : 'Tighten slightly.'}${viaOctave}`,
    };
  }
  return {
    ...base,
    action: 'loosen',
    headline: 'Wire is too tight.',
    guidance: `${far ? 'Loosen gradually, re-playing the wire as you go.' : 'Loosen slightly.'}${viaOctave}`,
  };
}
