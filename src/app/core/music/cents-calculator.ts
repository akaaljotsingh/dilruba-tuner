/** Signed deviation in cents of `frequency` from `reference`. Positive = sharp, negative = flat. */
export function centsBetween(frequency: number, reference: number): number {
  if (!(frequency > 0) || !(reference > 0)) {
    return Number.NaN;
  }
  return 1200 * Math.log2(frequency / reference);
}

/** Deviation in cents of a continuous MIDI value from its nearest equal-tempered semitone, in [-50, 50). */
export function centsFromNearestSemitone(midi: number): number {
  const nearest = Math.round(midi);
  return (midi - nearest) * 100;
}

/** Applies a cents offset to a frequency. */
export function offsetByCents(frequency: number, cents: number): number {
  return frequency * Math.pow(2, cents / 1200);
}
