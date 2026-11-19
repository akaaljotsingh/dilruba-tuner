import { computed, effect, Injectable, signal } from '@angular/core';
import { NoiseFilterLevel } from '../dsp/noise-filter';
import { DEFAULT_A4, MAX_A4, MIN_A4 } from '../music/frequency-converter';
import { SwaraMapper } from '../music/swara-mapper';
import { AccidentalStyle, pitchClassName } from '../music/western-note-mapper';
import { TuningTolerances } from '../models/tuning-result.model';
import { clampNumber, oneOf, readJson, writeJson } from './local-storage';

export type ThemeName = 'charcoal' | 'midnight';
export type AccentName = 'saffron' | 'gold' | 'rose';
export type TextScale = 'normal' | 'large';

export interface AppSettings {
  readonly version: 1;
  /** Pitch class of Sa (0 = C … 11 = B). */
  readonly tonicPitchClass: number;
  readonly a4: number;
  /** Scientific octave of Madhya Sa. */
  readonly madhyaSaOctave: number;
  readonly accidentals: AccidentalStyle;
  /** 0 strict … 1 sensitive. */
  readonly sensitivity: number;
  readonly noiseFilter: NoiseFilterLevel;
  readonly tolerances: TuningTolerances;
  /** Pitch detection range (Hz). */
  readonly minFrequency: number;
  readonly maxFrequency: number;
  /** Sur Spectrum saptak range relative to Madhya. */
  readonly spectrumLowSaptak: number;
  readonly spectrumHighSaptak: number;
  readonly showFrequencyLabels: boolean;
  readonly showHarmonics: boolean;
  readonly theme: ThemeName;
  readonly accent: AccentName;
  readonly textScale: TextScale;
  readonly reduceMotion: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  tonicPitchClass: 1, // C#
  a4: DEFAULT_A4,
  madhyaSaOctave: 3,
  accidentals: 'sharp',
  sensitivity: 0.6,
  noiseFilter: 'medium',
  tolerances: { perfectCents: 3, acceptableCents: 10 },
  minFrequency: 55,
  maxFrequency: 1400,
  spectrumLowSaptak: -1,
  spectrumHighSaptak: 1,
  showFrequencyLabels: true,
  showHarmonics: true,
  theme: 'charcoal',
  accent: 'saffron',
  textScale: 'normal',
  reduceMotion: false,
};

const STORAGE_KEY = 'dilruba-sur-tuner.settings.v1';

/** Validates untrusted (persisted) data, falling back to defaults field by field. */
export function sanitizeSettings(raw: unknown): AppSettings {
  const d = DEFAULT_SETTINGS;
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const tol = (r['tolerances'] ?? {}) as Record<string, unknown>;
  const perfect = clampNumber(tol['perfectCents'], 0.5, 20, d.tolerances.perfectCents);
  const acceptable = clampNumber(
    tol['acceptableCents'],
    perfect,
    50,
    Math.max(perfect, d.tolerances.acceptableCents),
  );
  const minFrequency = clampNumber(r['minFrequency'], 30, 400, d.minFrequency);
  const maxFrequency = clampNumber(
    r['maxFrequency'],
    minFrequency * 2,
    4000,
    Math.max(minFrequency * 2, d.maxFrequency),
  );
  const low = Math.round(clampNumber(r['spectrumLowSaptak'], -3, 0, d.spectrumLowSaptak));
  const high = Math.round(clampNumber(r['spectrumHighSaptak'], 0, 3, d.spectrumHighSaptak));
  return {
    version: 1,
    tonicPitchClass: Math.round(clampNumber(r['tonicPitchClass'], 0, 11, d.tonicPitchClass)),
    a4: clampNumber(r['a4'], MIN_A4, MAX_A4, d.a4),
    madhyaSaOctave: Math.round(clampNumber(r['madhyaSaOctave'], 1, 5, d.madhyaSaOctave)),
    accidentals: oneOf(r['accidentals'], ['sharp', 'flat'] as const, d.accidentals),
    sensitivity: clampNumber(r['sensitivity'], 0, 1, d.sensitivity),
    noiseFilter: oneOf(r['noiseFilter'], ['off', 'low', 'medium', 'high'] as const, d.noiseFilter),
    tolerances: { perfectCents: perfect, acceptableCents: acceptable },
    minFrequency,
    maxFrequency,
    spectrumLowSaptak: low,
    spectrumHighSaptak: Math.max(high, low + 1),
    showFrequencyLabels:
      typeof r['showFrequencyLabels'] === 'boolean'
        ? r['showFrequencyLabels']
        : d.showFrequencyLabels,
    showHarmonics: typeof r['showHarmonics'] === 'boolean' ? r['showHarmonics'] : d.showHarmonics,
    theme: oneOf(r['theme'], ['charcoal', 'midnight'] as const, d.theme),
    accent: oneOf(r['accent'], ['saffron', 'gold', 'rose'] as const, d.accent),
    textScale: oneOf(r['textScale'], ['normal', 'large'] as const, d.textScale),
    reduceMotion: typeof r['reduceMotion'] === 'boolean' ? r['reduceMotion'] : d.reduceMotion,
  };
}

@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly state = signal<AppSettings>(sanitizeSettings(readJson(STORAGE_KEY)));

  readonly settings = this.state.asReadonly();
  readonly tonicPitchClass = computed(() => this.state().tonicPitchClass);
  readonly tonicName = computed(() =>
    pitchClassName(this.state().tonicPitchClass, this.state().accidentals),
  );
  readonly tolerances = computed(() => this.state().tolerances);

  /** The swara mapper for the current tonic / reference. Recomputed only when those change. */
  readonly mapper = computed(
    () => {
      const s = this.state();
      return new SwaraMapper({
        tonicPitchClass: s.tonicPitchClass,
        a4: s.a4,
        madhyaSaOctave: s.madhyaSaOctave,
        accidentals: s.accidentals,
      });
    },
    {
      equal: (a, b) =>
        a.config.tonicPitchClass === b.config.tonicPitchClass &&
        a.config.a4 === b.config.a4 &&
        a.config.madhyaSaOctave === b.config.madhyaSaOctave &&
        a.config.accidentals === b.config.accidentals,
    },
  );

  constructor() {
    effect(() => writeJson(STORAGE_KEY, this.state()));
  }

  update(patch: Partial<Omit<AppSettings, 'version'>>): void {
    this.state.update((s) => sanitizeSettings({ ...s, ...patch }));
  }

  setTonic(pitchClass: number): void {
    this.update({ tonicPitchClass: ((Math.round(pitchClass) % 12) + 12) % 12 });
  }

  reset(): void {
    this.state.set(DEFAULT_SETTINGS);
  }
}
