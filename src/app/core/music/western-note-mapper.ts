export type AccidentalStyle = 'sharp' | 'flat';

export const SHARP_NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;
export const FLAT_NOTE_NAMES = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
] as const;

export interface WesternNote {
  readonly midi: number;
  /** 0 = C … 11 = B */
  readonly pitchClass: number;
  /** Note name without octave, e.g. "F#" */
  readonly name: string;
  /** Scientific pitch octave (C4 = middle C, A4 = MIDI 69). */
  readonly octave: number;
  /** Name with octave, e.g. "F#3" */
  readonly label: string;
}

export function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

export function pitchClassName(pitchClass: number, style: AccidentalStyle = 'sharp'): string {
  const names = style === 'flat' ? FLAT_NOTE_NAMES : SHARP_NOTE_NAMES;
  return names[mod12(Math.round(pitchClass))];
}

/** Scientific pitch octave for an integer MIDI note. MIDI 60 = C4. */
export function midiOctave(midi: number): number {
  return Math.floor(Math.round(midi) / 12) - 1;
}

export function midiToWesternNote(midi: number, style: AccidentalStyle = 'sharp'): WesternNote {
  const rounded = Math.round(midi);
  const pitchClass = mod12(rounded);
  const name = pitchClassName(pitchClass, style);
  const octave = midiOctave(rounded);
  return { midi: rounded, pitchClass, name, octave, label: `${name}${octave}` };
}

export function westernNoteToMidi(pitchClass: number, octave: number): number {
  return (octave + 1) * 12 + mod12(pitchClass);
}

const NAME_TO_PC: Record<string, number> = {
  C: 0,
  'B#': 0,
  'C#': 1,
  DB: 1,
  D: 2,
  'D#': 3,
  EB: 3,
  E: 4,
  FB: 4,
  F: 5,
  'E#': 5,
  'F#': 6,
  GB: 6,
  G: 7,
  'G#': 8,
  AB: 8,
  A: 9,
  'A#': 10,
  BB: 10,
  B: 11,
  CB: 11,
};

/** Parses a pitch-class name like "C#", "Db", "f#" or "C♯". Returns null when not recognised. */
export function parsePitchClass(name: string): number | null {
  const normalised = name.trim().replace('♯', '#').replace('♭', 'b').toUpperCase();
  const pc = NAME_TO_PC[normalised];
  return pc === undefined ? null : pc;
}
