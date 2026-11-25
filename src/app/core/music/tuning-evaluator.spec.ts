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

  describe('octave-equivalent readings (harmonics)', () => {
    it('two saptaks above, exactly in tune → perfectly tuned via the octave', () => {
      const r = at(2400);
      expect(r.mode).toBe('octave');
      expect(r.octaveOffset).toBe(2);
      expect(r.meterCents).toBeCloseTo(0, 6);
      expect(r.action).toBe('none');
      expect(r.distanceLabel).toBe('2 saptaks above');
      expect(r.guidance).toContain('2 saptaks higher');
    });

    it('one saptak above and 15¢ flat → tighten, with an upward direction', () => {
      const r = at(1200 - 15);
      expect(r.mode).toBe('octave');
      expect(r.meterCents).toBeCloseTo(-15, 6);
      expect(r.direction).toBe('up');
      expect(r.action).toBe('tighten');
      expect(r.distanceLabel).toBe('1 saptak above');
    });

    it('one saptak below and 20¢ sharp → loosen, with a downward direction', () => {
      const r = at(-1200 + 20);
      expect(r.mode).toBe('octave');
      expect(r.direction).toBe('down');
      expect(r.action).toBe('loosen');
      expect(r.distanceLabel).toBe('1 saptak below');
    });
  });

  describe('far-off readings (a different note)', () => {
    it('3 semitones flat → pegged meter, upward direction, tighten', () => {
      const r = at(-300);
      expect(r.mode).toBe('far');
      expect(r.meterCents).toBeLessThan(-50);
      expect(r.direction).toBe('up');
      expect(r.action).toBe('tighten');
      expect(r.distanceLabel).toBe('3 semitones below');
      expect(r.status).toBe('very-flat');
    });

    it('a fifth above → downward direction, loosen', () => {
      const r = at(700);
      expect(r.mode).toBe('far');
      expect(r.direction).toBe('down');
      expect(r.action).toBe('loosen');
      expect(r.distanceLabel).toBe('7 semitones above');
    });

    it('far below by more than an octave still says which way (tighten)', () => {
      const r = at(-1500);
      expect(r.direction).toBe('up');
      expect(r.action).toBe('tighten');
      expect(r.distanceLabel).toBe('1 saptak + 3 semitones below');
    });

    it('far above by more than an octave asks to check the wire, but still points down', () => {
      const r = at(1900);
      expect(r.direction).toBe('down');
      expect(r.action).toBe('check');
      expect(r.distanceLabel).toBe('1 saptak + 7 semitones above');
    });

    it('direction is shown even before the reading is stable', () => {
      const r = at(-400, { confident: true, stable: false });
      expect(r.direction).toBe('up');
      expect(r.action).toBe('wait');
    });

    it('no direction when the reading is not confident', () => {
      expect(at(-400, { confident: false, stable: false }).direction).toBe('none');
    });
  });
});
