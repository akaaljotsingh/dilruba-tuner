/** Deterministic synthetic test signals for DSP unit tests. */

export interface Partial {
  frequency: number;
  amplitude: number;
  phase?: number;
}

/** Mulberry32 PRNG – deterministic noise. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sumOfPartials(
  partials: Partial[],
  sampleRate: number,
  length: number,
  startSample = 0,
): Float32Array {
  const out = new Float32Array(length);
  for (const p of partials) {
    const w = (2 * Math.PI * p.frequency) / sampleRate;
    const phase = p.phase ?? 0;
    for (let i = 0; i < length; i++) {
      out[i] += p.amplitude * Math.sin(w * (i + startSample) + phase);
    }
  }
  return out;
}

export function sine(
  frequency: number,
  sampleRate: number,
  length: number,
  amplitude = 0.5,
): Float32Array {
  return sumOfPartials([{ frequency, amplitude }], sampleRate, length);
}

/** Harmonic tone with the given relative amplitudes for harmonics 1..n. */
export function harmonicTone(
  f0: number,
  amplitudes: number[],
  sampleRate: number,
  length: number,
): Float32Array {
  return sumOfPartials(
    amplitudes.map((amplitude, i) => ({ frequency: f0 * (i + 1), amplitude, phase: i * 0.7 })),
    sampleRate,
    length,
  );
}

/** A bowed-string-like tone: sawtooth-ish 1/n rolloff. */
export function stringTone(
  f0: number,
  sampleRate: number,
  length: number,
  amplitude = 0.3,
  harmonics = 12,
): Float32Array {
  const amps: number[] = [];
  for (let h = 1; h <= harmonics; h++) {
    if (f0 * h > sampleRate / 2.2) break;
    amps.push(amplitude / h);
  }
  return harmonicTone(f0, amps, sampleRate, length);
}

export function whiteNoise(length: number, amplitude: number, seed = 1): Float32Array {
  const rnd = seededRandom(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = (rnd() * 2 - 1) * amplitude;
  return out;
}

export function mix(...signals: Float32Array[]): Float32Array {
  const length = Math.max(...signals.map((s) => s.length));
  const out = new Float32Array(length);
  for (const s of signals) for (let i = 0; i < s.length; i++) out[i] += s[i];
  return out;
}

export function centsError(measured: number, expected: number): number {
  return Math.abs(1200 * Math.log2(measured / expected));
}
