import { DEFAULT_TOLERANCES } from '../models/tuning-result.model';
import { offsetByCents } from './cents-calculator';
import { evaluateTuning, tuningStatus } from './tuning-evaluator';

describe('tuning evaluator', () => {
  const target = 185; // F#3
  const ok = { confident: true, stable: true };
  const at = (cents: number, q = ok) =>
    evaluateTuning(offsetByCents(target, cents), target, DEFAULT_TOLERANCES, q);

  it('status buckets with default tolerances (±3 perfect, ±10 acceptable)', () => {
    expect(tuningStatus(0, DEFAULT_TOLERANCES)).toBe('in-tune');
    expect(tuningStatus(2.9, DEFAULT_TOLERANCES)).toBe('in-tune');
    expect(tuningStatus(-3, DEFAULT_TOLERANCES)).toBe('in-tune');
    expect(tuningStatus(-6, DEFAULT_TOLERANCES)).toBe('slightly-flat');
    expect(tuningStatus(9, DEFAULT_TOLERANCES)).toBe('slightly-sharp');
    expect(tuningStatus(-18, DEFAULT_TOLERANCES)).toBe('flat');
    expect(tuningStatus(20, DEFAULT_TOLERANCES)).toBe('sharp');
    expect(tuningStatus(-40, DEFAULT_TOLERANCES)).toBe('very-flat');
    expect(tuningStatus(70, DEFAULT_TOLERANCES)).toBe('very-sharp');
  });

  it('respects custom tolerances', () => {
    expect(tuningStatus(4, { perfectCents: 5, acceptableCents: 15 })).toBe('in-tune');
    expect(tuningStatus(12, { perfectCents: 5, acceptableCents: 15 })).toBe('slightly-sharp');
  });

  it('flat → tighten, sharp → loosen', () => {
    const flat = at(-15);
    expect(flat.cents).toBeCloseTo(-15, 6);
    expect(flat.action).toBe('tighten');
    expect(flat.headline).toBe('Wire is too loose.');
    expect(flat.guidance).toBe('Tighten slightly.');

    const sharp = at(15);
    expect(sharp.action).toBe('loosen');
    expect(sharp.headline).toBe('Wire is too tight.');
    expect(sharp.guidance).toBe('Loosen slightly.');
  });

  it('within tolerance → Perfectly Tuned!', () => {
    const r = at(1.5);
    expect(r.action).toBe('none');
    expect(r.headline).toBe('Perfectly Tuned!');
    expect(r.withinPerfect).toBe(true);
  });

  it('gives no tightening/loosening advice when confidence is low', () => {
    expect(at(-30, { confident: false, stable: false }).action).toBe('wait');
    expect(at(30, { confident: false, stable: true }).action).toBe('wait');
  });

  it('waits for a stable reading before advising', () => {
    const r = at(-30, { confident: true, stable: false });
    expect(r.action).toBe('wait');
    expect(r.status).toBe('very-flat');
  });

  it('flags octave errors instead of advising a huge adjustment', () => {
    const up = at(1200);
    expect(up.octaveOffset).toBe(1);
    expect(up.action).toBe('wait');
    const down = at(-1190);
    expect(down.octaveOffset).toBe(-1);
    expect(down.action).toBe('wait');
  });
});
