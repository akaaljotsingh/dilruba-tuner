import { SWARAS, swaraById } from '../models/swara.model';
import { centsBetween, centsFromNearestSemitone, offsetByCents } from './cents-calculator';
import { frequencyToMidi, midiToFrequency } from './frequency-converter';
import { saptakOffsetOf, westernOctaveOf } from './octave-mapper';
import { SwaraMapper } from './swara-mapper';
import {
  midiToWesternNote,
  parsePitchClass,
  pitchClassName,
  SHARP_NOTE_NAMES,
  westernNoteToMidi,
} from './western-note-mapper';

describe('frequency conversion', () => {
  it('A4 = 440 Hz is MIDI 69', () => {
    expect(frequencyToMidi(440)).toBe(69);
    expect(midiToFrequency(69)).toBe(440);
  });

  it('middle C (MIDI 60) ≈ 261.63 Hz', () => {
    expect(midiToFrequency(60)).toBeCloseTo(261.6256, 3);
  });

  it('round-trips across the instrument range', () => {
    for (let midi = 30; midi <= 96; midi++) {
      expect(frequencyToMidi(midiToFrequency(midi))).toBeCloseTo(midi, 9);
    }
  });

  it('honours a custom A4 reference', () => {
    expect(midiToFrequency(69, 432)).toBe(432);
    expect(frequencyToMidi(432, 432)).toBe(69);
    expect(midiToFrequency(57, 442)).toBeCloseTo(221, 9);
  });

  it('returns NaN for invalid input', () => {
    expect(frequencyToMidi(0)).toBeNaN();
    expect(frequencyToMidi(-5)).toBeNaN();
  });
});

describe('Western note mapping', () => {
  it('maps MIDI to note names and scientific octaves', () => {
    expect(midiToWesternNote(60).label).toBe('C4');
    expect(midiToWesternNote(61).label).toBe('C#4');
    expect(midiToWesternNote(61, 'flat').label).toBe('Db4');
    expect(midiToWesternNote(59).label).toBe('B3');
    expect(midiToWesternNote(21).label).toBe('A0');
    expect(midiToWesternNote(49).label).toBe('C#3');
  });

  it('octave boundaries are at C', () => {
    expect(westernOctaveOf(59)).toBe(3);
    expect(westernOctaveOf(60)).toBe(4);
  });

  it('parses note names with sharps, flats and unicode accidentals', () => {
    expect(parsePitchClass('C#')).toBe(1);
    expect(parsePitchClass('db')).toBe(1);
    expect(parsePitchClass('F♯')).toBe(6);
    expect(parsePitchClass('Bb')).toBe(10);
    expect(parsePitchClass('H')).toBeNull();
    expect(westernNoteToMidi(1, 3)).toBe(49);
    expect(pitchClassName(-1)).toBe('B');
  });
});

describe('cents', () => {
  it('one semitone is 100 cents, one octave is 1200', () => {
    expect(centsBetween(midiToFrequency(70), midiToFrequency(69))).toBeCloseTo(100, 9);
    expect(centsBetween(880, 440)).toBeCloseTo(1200, 9);
  });

  it('sign: positive = sharp, negative = flat', () => {
    expect(centsBetween(445, 440)).toBeGreaterThan(0);
    expect(centsBetween(435, 440)).toBeLessThan(0);
    expect(centsBetween(offsetByCents(440, 7), 440)).toBeCloseTo(7, 9);
  });

  it('cents from nearest semitone', () => {
    expect(centsFromNearestSemitone(69.25)).toBeCloseTo(25, 9);
    expect(centsFromNearestSemitone(68.8)).toBeCloseTo(-20, 9);
  });
});

describe('SwaraMapper', () => {
  it('reproduces the documented Sa = C# table', () => {
    const m = new SwaraMapper({ tonicPitchClass: 1 });
    const names = m
      .mappingTable()
      .map((r) => `${r.isUpperSa ? 'Upper ' : ''}${r.swara.name}=${r.western.name}`);
    expect(names).toEqual([
      'Sa=C#',
      'Komal Re=D',
      'Shuddh Re=D#',
      'Komal Ga=E',
      'Shuddh Ga=F',
      'Shuddh Ma=F#',
      'Tivra Ma=G',
      'Pa=G#',
      'Komal Dha=A',
      'Shuddh Dha=A#',
      'Komal Ni=B',
      'Shuddh Ni=C',
      'Upper Sa=C#',
    ]);
  });

  describe('all 12 tonic selections × all 12 swaras', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      const tonicName = SHARP_NOTE_NAMES[tonic];
      describe(`Sa = ${tonicName}`, () => {
        const m = new SwaraMapper({ tonicPitchClass: tonic, madhyaSaOctave: 3 });

        it('maps every swara to the correct Western pitch class', () => {
          for (const swara of SWARAS) {
            const pc = (tonic + swara.semitone) % 12;
            expect(m.swaraToPitchClass(swara.id)).toBe(pc);
            expect(m.westernToSwara(pc).id).toBe(swara.id);
            expect(m.noteFor(swara.id, 0).western.name).toBe(SHARP_NOTE_NAMES[pc]);
          }
        });

        it('computes Madhya Sa in octave 3 and the octave of every swara independently', () => {
          expect(m.madhyaSaMidi).toBe(48 + tonic);
          for (const swara of SWARAS) {
            const note = m.noteFor(swara.id, 0);
            expect(note.saptak.offset).toBe(0);
            // Western octave rolls over at C, not at Sa.
            const expectedOctave = tonic + swara.semitone >= 12 ? 4 : 3;
            expect(note.western.octave).toBe(expectedOctave);
          }
        });

        it('computes target frequencies in equal temperament', () => {
          for (const swara of SWARAS) {
            for (const saptak of [-1, 0, 1]) {
              const midi = 48 + tonic + 12 * saptak + swara.semitone;
              expect(m.targetFrequency(swara.id, saptak)).toBeCloseTo(
                440 * Math.pow(2, (midi - 69) / 12),
                9,
              );
            }
          }
        });

        it('maps measured frequencies (±30 cents) back to the nearest swara and saptak', () => {
          for (const swara of SWARAS) {
            for (const saptak of [-2, -1, 0, 1, 2]) {
              for (const detune of [-30, 0, 30]) {
                const f = offsetByCents(m.targetFrequency(swara.id, saptak), detune);
                const r = m.frequencyToSwara(f)!;
                expect(r.swara.id).toBe(swara.id);
                expect(r.saptak.offset).toBe(saptak);
                expect(r.cents).toBeCloseTo(detune, 6);
              }
            }
          }
        });
      });
    }
  });

  it('transposes the whole mapping when Sa changes', () => {
    const cSharp = new SwaraMapper({ tonicPitchClass: 1 });
    const d = cSharp.withTonic(2);
    expect(d.noteFor('pa', 0).western.label).toBe('A3');
    expect(cSharp.noteFor('pa', 0).western.label).toBe('G#3');
    expect(d.frequencyToSwara(220)!.swara.id).toBe('pa');
    expect(cSharp.frequencyToSwara(220)!.swara.id).toBe('komal_dha');
  });

  it('Sa = C#: Shuddh Ni of Madhya saptak is C4 (next Western octave) but still Madhya', () => {
    const m = new SwaraMapper({ tonicPitchClass: 1, madhyaSaOctave: 3 });
    const ni = m.noteFor('ni', 0);
    expect(ni.western.label).toBe('C4');
    expect(ni.saptak.name).toBe('Madhya');
    const upperSa = m.noteFor('sa', 1);
    expect(upperSa.western.label).toBe('C#4');
    expect(upperSa.saptak.name).toBe('Taar');
  });

  it('starter Dilruba tuning (Sa = C#): Ma F#3, Sa C#3, Lower Pa G#2', () => {
    const m = new SwaraMapper({ tonicPitchClass: 1, madhyaSaOctave: 3 });
    expect(m.noteFor('ma', 0).western.label).toBe('F#3');
    expect(m.noteFor('sa', 0).western.label).toBe('C#3');
    expect(m.noteFor('pa', -1).western.label).toBe('G#2');
    expect(m.targetFrequency('sa', 0)).toBeCloseTo(138.591, 3);
    expect(m.targetFrequency('pa', -1)).toBeCloseTo(103.826, 3);
  });

  it('saptak changes at Sa, not at C', () => {
    const saMidi = 49; // C#3
    expect(saptakOffsetOf(48, saMidi)).toBe(-1); // C3 = Mandra Ni
    expect(saptakOffsetOf(49, saMidi)).toBe(0);
    expect(saptakOffsetOf(60, saMidi)).toBe(0); // C4 = Madhya Ni
    expect(saptakOffsetOf(61, saMidi)).toBe(1);
  });

  it('respects A4 and accidental preferences', () => {
    const m = new SwaraMapper({ tonicPitchClass: 1, a4: 442, accidentals: 'flat' });
    expect(m.noteFor('sa', 0).western.label).toBe('Db3');
    expect(m.targetFrequency('komal_dha', 0)).toBeCloseTo(221, 6); // Komal Dha = A3 at A4 = 442
  });

  it('returns null for invalid frequencies', () => {
    expect(new SwaraMapper().frequencyToSwara(0)).toBeNull();
  });

  it('swara definitions are complete and ordered', () => {
    expect(SWARAS.length).toBe(12);
    SWARAS.forEach((s, i) => expect(s.semitone).toBe(i));
    expect(swaraById('tivra_ma').name).toBe('Tivra Ma');
  });
});
