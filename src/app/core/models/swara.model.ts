/**
 * The twelve swaras of the Hindustani chromatic scale, indexed by their
 * semitone distance above the tonic Sa.
 */
export type SwaraId =
  | 'sa'
  | 'komal_re'
  | 're'
  | 'komal_ga'
  | 'ga'
  | 'ma'
  | 'tivra_ma'
  | 'pa'
  | 'komal_dha'
  | 'dha'
  | 'komal_ni'
  | 'ni';

export type SwaraBase = 'Sa' | 'Re' | 'Ga' | 'Ma' | 'Pa' | 'Dha' | 'Ni';

/** achal = immovable (Sa, Pa). */
export type SwaraVariant = 'achal' | 'komal' | 'shuddh' | 'tivra';

export interface SwaraDefinition {
  readonly id: SwaraId;
  /** Semitones above Sa, 0–11. */
  readonly semitone: number;
  readonly base: SwaraBase;
  readonly variant: SwaraVariant;
  /** Full display name, e.g. "Komal Re". */
  readonly name: string;
  /** Compact label for dense layouts, e.g. "Re". The variant is shown through notation marks. */
  readonly short: string;
}

export const SWARAS: readonly SwaraDefinition[] = [
  { id: 'sa', semitone: 0, base: 'Sa', variant: 'achal', name: 'Sa', short: 'Sa' },
  { id: 'komal_re', semitone: 1, base: 'Re', variant: 'komal', name: 'Komal Re', short: 'Re' },
  { id: 're', semitone: 2, base: 'Re', variant: 'shuddh', name: 'Shuddh Re', short: 'Re' },
  { id: 'komal_ga', semitone: 3, base: 'Ga', variant: 'komal', name: 'Komal Ga', short: 'Ga' },
  { id: 'ga', semitone: 4, base: 'Ga', variant: 'shuddh', name: 'Shuddh Ga', short: 'Ga' },
  { id: 'ma', semitone: 5, base: 'Ma', variant: 'shuddh', name: 'Shuddh Ma', short: 'Ma' },
  { id: 'tivra_ma', semitone: 6, base: 'Ma', variant: 'tivra', name: 'Tivra Ma', short: 'Ma' },
  { id: 'pa', semitone: 7, base: 'Pa', variant: 'achal', name: 'Pa', short: 'Pa' },
  { id: 'komal_dha', semitone: 8, base: 'Dha', variant: 'komal', name: 'Komal Dha', short: 'Dha' },
  { id: 'dha', semitone: 9, base: 'Dha', variant: 'shuddh', name: 'Shuddh Dha', short: 'Dha' },
  { id: 'komal_ni', semitone: 10, base: 'Ni', variant: 'komal', name: 'Komal Ni', short: 'Ni' },
  { id: 'ni', semitone: 11, base: 'Ni', variant: 'shuddh', name: 'Shuddh Ni', short: 'Ni' },
];

const SWARA_BY_ID = new Map<SwaraId, SwaraDefinition>(SWARAS.map((s) => [s.id, s]));

export function swaraById(id: SwaraId): SwaraDefinition {
  const swara = SWARA_BY_ID.get(id);
  if (!swara) {
    throw new Error(`Unknown swara id: ${id}`);
  }
  return swara;
}

export function swaraBySemitone(semitone: number): SwaraDefinition {
  return SWARAS[((Math.round(semitone) % 12) + 12) % 12];
}

export function isSwaraId(value: unknown): value is SwaraId {
  return typeof value === 'string' && SWARA_BY_ID.has(value as SwaraId);
}

/**
 * Saptak (register / octave of the swara system) relative to the configured
 * Madhya (middle) Sa. Offset 0 is Madhya, -1 Mandra, +1 Taar.
 */
export interface SaptakDefinition {
  readonly offset: number;
  readonly name: string;
  readonly short: string;
}

export const SAPTAKS: readonly SaptakDefinition[] = [
  { offset: -3, name: 'Ati-ati-mandra', short: 'AAM' },
  { offset: -2, name: 'Ati-mandra', short: 'AM' },
  { offset: -1, name: 'Mandra', short: 'M' },
  { offset: 0, name: 'Madhya', short: '' },
  { offset: 1, name: 'Taar', short: 'T' },
  { offset: 2, name: 'Ati-taar', short: 'AT' },
  { offset: 3, name: 'Ati-ati-taar', short: 'AAT' },
];

export const MIN_SAPTAK = -3;
export const MAX_SAPTAK = 3;

export function saptakByOffset(offset: number): SaptakDefinition {
  const found = SAPTAKS.find((s) => s.offset === offset);
  if (found) {
    return found;
  }
  return { offset, name: offset < 0 ? `Mandra ${offset}` : `Taar +${offset}`, short: `${offset}` };
}
