import { saptakByOffset, SaptakDefinition } from '../models/swara.model';
import { midiOctave } from './western-note-mapper';

/** Scientific-pitch octave of an integer MIDI note (independent of the selected Sa). */
export function westernOctaveOf(midi: number): number {
  return midiOctave(midi);
}

/**
 * Saptak offset of an integer MIDI note relative to the MIDI note of Madhya Sa.
 * The saptak changes at every Sa, not at every C, which is why it must be
 * computed separately from the Western octave.
 */
export function saptakOffsetOf(midi: number, madhyaSaMidi: number): number {
  return Math.floor((Math.round(midi) - madhyaSaMidi) / 12);
}

export function saptakOf(midi: number, madhyaSaMidi: number): SaptakDefinition {
  return saptakByOffset(saptakOffsetOf(midi, madhyaSaMidi));
}
