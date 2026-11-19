import {
  SaptakDefinition,
  SWARAS,
  SwaraDefinition,
  SwaraId,
  swaraById,
  swaraBySemitone,
} from '../models/swara.model';
import { centsBetween } from './cents-calculator';
import { DEFAULT_A4, frequencyToMidi, midiToFrequency } from './frequency-converter';
import { saptakOf } from './octave-mapper';
import {
  AccidentalStyle,
  midiToWesternNote,
  mod12,
  WesternNote,
  westernNoteToMidi,
} from './western-note-mapper';

export interface TonicConfig {
  /** Pitch class of Sa: 0 = C … 11 = B. */
  readonly tonicPitchClass: number;
  /** Reference pitch for A4 in Hz. */
  readonly a4: number;
  /** Scientific-pitch octave in which Madhya (middle) Sa sits, e.g. 3 → C#3 when Sa = C#. */
  readonly madhyaSaOctave: number;
  readonly accidentals: AccidentalStyle;
}

export const DEFAULT_TONIC_CONFIG: TonicConfig = {
  tonicPitchClass: 1, // C#
  a4: DEFAULT_A4,
  madhyaSaOctave: 3,
  accidentals: 'sharp',
};

/** A pitch described in both systems. */
export interface SwaraNote {
  readonly swara: SwaraDefinition;
  readonly saptak: SaptakDefinition;
  readonly western: WesternNote;
  readonly midi: number;
  /** Equal-tempered frequency of this note under the current A4. */
  readonly frequency: number;
}

/** Result of mapping a measured frequency onto the nearest swara. */
export interface SwaraReading extends SwaraNote {
  readonly measuredFrequency: number;
  /** Continuous MIDI value of the measured frequency. */
  readonly exactMidi: number;
  /** Deviation of the measurement from the nearest equal-tempered swara, in cents. */
  readonly cents: number;
}

export interface SwaraMappingRow {
  readonly swara: SwaraDefinition;
  readonly western: WesternNote;
  readonly isUpperSa: boolean;
}

/**
 * Converts between frequencies, MIDI notes, Western notes and Hindustani swaras
 * relative to a movable tonic Sa. Immutable: use {@link withTonic} etc. to derive
 * a new mapper.
 */
export class SwaraMapper {
  readonly config: TonicConfig;
  /** MIDI note number of Madhya Sa. */
  readonly madhyaSaMidi: number;

  constructor(config: Partial<TonicConfig> = {}) {
    this.config = { ...DEFAULT_TONIC_CONFIG, ...config };
    this.madhyaSaMidi = westernNoteToMidi(this.config.tonicPitchClass, this.config.madhyaSaOctave);
  }

  // ---- transposition -------------------------------------------------------

  withTonic(tonicPitchClass: number): SwaraMapper {
    return new SwaraMapper({ ...this.config, tonicPitchClass: mod12(tonicPitchClass) });
  }

  withConfig(patch: Partial<TonicConfig>): SwaraMapper {
    return new SwaraMapper({ ...this.config, ...patch });
  }

  // ---- primitive conversions ---------------------------------------------

  frequencyToMidi(frequency: number): number {
    return frequencyToMidi(frequency, this.config.a4);
  }

  midiToFrequency(midi: number): number {
    return midiToFrequency(midi, this.config.a4);
  }

  midiToWestern(midi: number): WesternNote {
    return midiToWesternNote(midi, this.config.accidentals);
  }

  /** Swara whose pitch class matches a Western pitch class under the current tonic. */
  westernToSwara(pitchClass: number): SwaraDefinition {
    return swaraBySemitone(mod12(pitchClass - this.config.tonicPitchClass));
  }

  /** Western pitch class for a swara under the current tonic. */
  swaraToPitchClass(id: SwaraId): number {
    return mod12(this.config.tonicPitchClass + swaraById(id).semitone);
  }

  // ---- note construction --------------------------------------------------

  /** MIDI note of a swara in a saptak (0 = Madhya, -1 = Mandra, +1 = Taar). */
  targetMidi(id: SwaraId, saptak: number): number {
    return this.madhyaSaMidi + 12 * saptak + swaraById(id).semitone;
  }

  targetFrequency(id: SwaraId, saptak: number): number {
    return this.midiToFrequency(this.targetMidi(id, saptak));
  }

  noteForMidi(midi: number): SwaraNote {
    const rounded = Math.round(midi);
    return {
      midi: rounded,
      swara: this.westernToSwara(mod12(rounded)),
      saptak: saptakOf(rounded, this.madhyaSaMidi),
      western: this.midiToWestern(rounded),
      frequency: this.midiToFrequency(rounded),
    };
  }

  noteFor(id: SwaraId, saptak: number): SwaraNote {
    return this.noteForMidi(this.targetMidi(id, saptak));
  }

  // ---- measurement mapping -------------------------------------------------

  /** Maps a measured frequency to the nearest equal-tempered swara. Returns null for invalid input. */
  frequencyToSwara(frequency: number): SwaraReading | null {
    const exactMidi = this.frequencyToMidi(frequency);
    if (!Number.isFinite(exactMidi)) {
      return null;
    }
    const note = this.noteForMidi(exactMidi);
    return {
      ...note,
      measuredFrequency: frequency,
      exactMidi,
      cents: centsBetween(frequency, note.frequency),
    };
  }

  /** Western octave of a measured frequency (scientific pitch). */
  frequencyToWesternOctave(frequency: number): number | null {
    const reading = this.frequencyToSwara(frequency);
    return reading ? reading.western.octave : null;
  }

  /** Saptak of a measured frequency relative to Madhya Sa. */
  frequencyToSaptak(frequency: number): SaptakDefinition | null {
    const reading = this.frequencyToSwara(frequency);
    return reading ? reading.saptak : null;
  }

  /** Deviation of a measured frequency from a target, in cents. */
  centsFromTarget(frequency: number, targetFrequency: number): number {
    return centsBetween(frequency, targetFrequency);
  }

  // ---- tables ----------------------------------------------------------

  /** Twelve swaras plus upper Sa with their Western equivalents in Madhya saptak. */
  mappingTable(): SwaraMappingRow[] {
    const rows: SwaraMappingRow[] = SWARAS.map((swara) => ({
      swara,
      western: this.midiToWestern(this.madhyaSaMidi + swara.semitone),
      isUpperSa: false,
    }));
    rows.push({
      swara: SWARAS[0],
      western: this.midiToWestern(this.madhyaSaMidi + 12),
      isUpperSa: true,
    });
    return rows;
  }
}
