import { InstrumentConfiguration } from '../models/instrument-configuration.model';
import { StringConfiguration } from '../models/string-configuration.model';
import { swaraBySemitone, SwaraId } from '../models/swara.model';

/** Note sets used to fill sympathetic (taraf) strings. The ten thaats of Hindustani music plus chromatic. */
export interface ScalePreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly semitones: readonly number[];
}

export const SCALE_PRESETS: readonly ScalePreset[] = [
  {
    id: 'bilawal',
    name: 'Bilawal',
    description: 'All shuddh swaras',
    semitones: [0, 2, 4, 5, 7, 9, 11],
  },
  { id: 'kalyan', name: 'Kalyan', description: 'Tivra Ma', semitones: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'khamaj', name: 'Khamaj', description: 'Komal Ni', semitones: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'kafi', name: 'Kafi', description: 'Komal Ga, Ni', semitones: [0, 2, 3, 5, 7, 9, 10] },
  {
    id: 'asavari',
    name: 'Asavari',
    description: 'Komal Ga, Dha, Ni',
    semitones: [0, 2, 3, 5, 7, 8, 10],
  },
  {
    id: 'bhairavi',
    name: 'Bhairavi',
    description: 'Komal Re, Ga, Dha, Ni',
    semitones: [0, 1, 3, 5, 7, 8, 10],
  },
  {
    id: 'bhairav',
    name: 'Bhairav',
    description: 'Komal Re, Dha',
    semitones: [0, 1, 4, 5, 7, 8, 11],
  },
  {
    id: 'marwa',
    name: 'Marwa',
    description: 'Komal Re, Tivra Ma',
    semitones: [0, 1, 4, 6, 7, 9, 11],
  },
  {
    id: 'purvi',
    name: 'Purvi',
    description: 'Komal Re, Dha, Tivra Ma',
    semitones: [0, 1, 4, 6, 7, 8, 11],
  },
  {
    id: 'todi',
    name: 'Todi',
    description: 'Komal Re, Ga, Dha, Tivra Ma',
    semitones: [0, 1, 3, 6, 7, 8, 11],
  },
  {
    id: 'chromatic',
    name: 'Chromatic',
    description: 'All twelve swaras',
    semitones: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
];

export function scalePresetById(id: string): ScalePreset {
  return SCALE_PRESETS.find((p) => p.id === id) ?? SCALE_PRESETS[0];
}

/** The i-th (0-based) ascending note of a scale starting at `startSaptak`. */
export function scaleNote(
  preset: ScalePreset,
  index: number,
  startSaptak = 0,
): { swara: SwaraId; saptak: number } {
  const len = preset.semitones.length;
  const octave = Math.floor(index / len);
  return { swara: swaraBySemitone(preset.semitones[index % len]).id, saptak: startSaptak + octave };
}

export function mainStringId(order: number): string {
  return `main-${order}`;
}

export function sympatheticStringId(order: number): string {
  return `taraf-${order}`;
}

export function mainStringName(order: number): string {
  return order === 1 ? 'Main 1 · Melody' : `Main ${order}`;
}

export function sympatheticStringName(order: number): string {
  return `Taraf ${order}`;
}

/**
 * Editable starter tuning for the four main wires (Sa = tonic):
 * Main 1 Ma, Main 2 Sa, Main 3 Mandra Pa, Main 4 Mandra Sa.
 * This is an example preset, not a universal standard.
 */
export const DEFAULT_MAIN_TUNING: readonly { swara: SwaraId; saptak: number }[] = [
  { swara: 'ma', saptak: 0 },
  { swara: 'sa', saptak: 0 },
  { swara: 'pa', saptak: -1 },
  { swara: 'sa', saptak: -1 },
];

/** Default for main wires beyond the four in the starter preset. */
export function defaultMainNote(order: number): { swara: SwaraId; saptak: number } {
  return DEFAULT_MAIN_TUNING[order - 1] ?? { swara: 'sa', saptak: 0 };
}

export const DEFAULT_SYMPATHETIC_PRESET = 'bilawal';
export const DEFAULT_SYMPATHETIC_START_SAPTAK = 0;
export const DEFAULT_SYMPATHETIC_COUNT = 15;

export function createMainString(order: number): StringConfiguration {
  const note = defaultMainNote(order);
  return {
    id: mainStringId(order),
    name: mainStringName(order),
    category: 'main',
    order,
    swara: note.swara,
    saptak: note.saptak,
    centsOffset: 0,
  };
}

export function createSympatheticString(
  order: number,
  presetId: string,
  startSaptak: number,
): StringConfiguration {
  const note = scaleNote(scalePresetById(presetId), order - 1, startSaptak);
  return {
    id: sympatheticStringId(order),
    name: sympatheticStringName(order),
    category: 'sympathetic',
    order,
    swara: note.swara,
    saptak: note.saptak,
    centsOffset: 0,
  };
}

export interface InstrumentState extends InstrumentConfiguration {
  readonly sympatheticPreset: string;
  readonly sympatheticStartSaptak: number;
}

export function createDefaultInstrument(): InstrumentState {
  const strings: StringConfiguration[] = [];
  for (let i = 1; i <= DEFAULT_MAIN_TUNING.length; i++) strings.push(createMainString(i));
  for (let i = 1; i <= DEFAULT_SYMPATHETIC_COUNT; i++) {
    strings.push(
      createSympatheticString(i, DEFAULT_SYMPATHETIC_PRESET, DEFAULT_SYMPATHETIC_START_SAPTAK),
    );
  }
  return {
    version: 1,
    name: 'My Dilruba',
    strings,
    sympatheticPreset: DEFAULT_SYMPATHETIC_PRESET,
    sympatheticStartSaptak: DEFAULT_SYMPATHETIC_START_SAPTAK,
  };
}
