import { SwaraId } from './swara.model';

export type StringCategory = 'main' | 'sympathetic';

/** A single wire of the instrument and the pitch it should be tuned to. */
export interface StringConfiguration {
  readonly id: string;
  readonly name: string;
  readonly category: StringCategory;
  /** 1-based order within its category. */
  readonly order: number;
  readonly swara: SwaraId;
  /** Saptak relative to Madhya Sa: -1 Mandra, 0 Madhya, +1 Taar … */
  readonly saptak: number;
  /** Optional fine offset in cents for players who tune a wire slightly off equal temperament. */
  readonly centsOffset: number;
}

/** A string together with its derived Western pitch and target frequency. */
export interface ResolvedString extends StringConfiguration {
  readonly swaraName: string;
  readonly westernNote: string;
  readonly westernOctave: number;
  readonly westernLabel: string;
  readonly saptakName: string;
  readonly midi: number;
  readonly targetFrequency: number;
}
