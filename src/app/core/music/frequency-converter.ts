export const DEFAULT_A4 = 440;
export const A4_MIDI = 69;
export const MIN_A4 = 400;
export const MAX_A4 = 480;

/** Continuous (fractional) MIDI note number for a frequency in equal temperament. */
export function frequencyToMidi(frequency: number, a4 = DEFAULT_A4): number {
  if (!(frequency > 0) || !(a4 > 0)) {
    return Number.NaN;
  }
  return A4_MIDI + 12 * Math.log2(frequency / a4);
}

/** Frequency in Hz for a (possibly fractional) MIDI note number. */
export function midiToFrequency(midi: number, a4 = DEFAULT_A4): number {
  return a4 * Math.pow(2, (midi - A4_MIDI) / 12);
}
