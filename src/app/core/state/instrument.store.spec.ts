import { TestBed } from '@angular/core/testing';
import { InstrumentStore, sanitizeInstrument } from './instrument.store';
import { SettingsStore, sanitizeSettings } from './settings.store';

describe('InstrumentStore', () => {
  let store: InstrumentStore;
  let settings: SettingsStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    store = TestBed.inject(InstrumentStore);
    settings = TestBed.inject(SettingsStore);
  });

  it('starts with the editable 4-main + 15-taraf starter configuration', () => {
    expect(store.mainCount()).toBe(4);
    expect(store.sympatheticCount()).toBe(15);
    const main = store.mainStrings();
    expect(main.map((s) => `${s.swaraName}/${s.westernLabel}`)).toEqual([
      'Shuddh Ma/F#3',
      'Sa/C#3',
      'Pa/G#2',
      'Sa/C#2',
    ]);
    expect(main[0].name).toContain('Melody');
  });

  it('changing Sa re-derives every Western note and frequency', () => {
    settings.setTonic(2); // D
    expect(store.mainStrings()[1].westernLabel).toBe('D3');
    expect(store.mainStrings()[0].westernLabel).toBe('G3');
    expect(store.mainStrings()[1].targetFrequency).toBeCloseTo(146.832, 2);
  });

  it('changes the number of sympathetic strings dynamically', () => {
    store.setSympatheticCount(11);
    expect(store.sympatheticCount()).toBe(11);
    store.setSympatheticCount(22);
    expect(store.sympatheticCount()).toBe(22);
    expect(store.sympatheticStrings()[21].name).toBe('Taraf 22');
    store.setSympatheticCount(0);
    expect(store.sympatheticCount()).toBe(0);
    store.setSympatheticCount(999);
    expect(store.sympatheticCount()).toBe(30);
  });

  it('changes the number of main strings while keeping existing edits', () => {
    store.updateString('main-1', { swara: 'pa' });
    store.setMainCount(6);
    expect(store.mainCount()).toBe(6);
    expect(store.mainStrings()[0].swara).toBe('pa');
    store.setMainCount(0);
    expect(store.mainCount()).toBe(1);
  });

  it('edits an individual string target', () => {
    store.updateString('taraf-3', { swara: 'komal_ga', saptak: 1, centsOffset: -4 });
    const s = store.stringById('taraf-3')!;
    expect(s.swaraName).toBe('Komal Ga');
    expect(s.saptakName).toBe('Taar');
    expect(s.westernLabel).toBe('E4');
    expect(s.targetFrequency).toBeLessThan(329.63);
  });

  it('applies a thaat preset to sympathetic strings', () => {
    store.applySympatheticPreset('kafi', 0);
    const notes = store
      .sympatheticStrings()
      .slice(0, 8)
      .map((s) => s.swara);
    expect(notes).toEqual(['sa', 're', 'komal_ga', 'ma', 'pa', 'dha', 'komal_ni', 'sa']);
    expect(store.sympatheticStrings()[7].saptak).toBe(1);
  });

  it('persists and restores configuration', () => {
    store.setSympatheticCount(9);
    TestBed.tick();
    const saved = JSON.parse(localStorage.getItem('dilruba-sur-tuner.instrument.v1')!);
    expect(
      sanitizeInstrument(saved).strings.filter((s) => s.category === 'sympathetic').length,
    ).toBe(9);
  });

  it('sanitises corrupt persisted data', () => {
    expect(sanitizeInstrument({ strings: 'nope' }).strings.length).toBe(19);
    expect(sanitizeInstrument(null).strings.length).toBe(19);
    const s = sanitizeSettings({ tonicPitchClass: 99, a4: 'x', tolerances: { perfectCents: 50 } });
    expect(s.tonicPitchClass).toBe(11);
    expect(s.a4).toBe(440);
    expect(s.tolerances.acceptableCents).toBeGreaterThanOrEqual(s.tolerances.perfectCents);
  });
});
