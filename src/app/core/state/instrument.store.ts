import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { offsetByCents } from '../music/cents-calculator';
import {
  createDefaultInstrument,
  createMainString,
  createSympatheticString,
  InstrumentState,
  scaleNote,
  scalePresetById,
} from '../music/instrument-presets';
import { SwaraMapper } from '../music/swara-mapper';
import {
  MAX_MAIN_STRINGS,
  MAX_SYMPATHETIC_STRINGS,
  MIN_MAIN_STRINGS,
  MIN_SYMPATHETIC_STRINGS,
} from '../models/instrument-configuration.model';
import { ResolvedString, StringConfiguration } from '../models/string-configuration.model';
import { isSwaraId, MAX_SAPTAK, MIN_SAPTAK, swaraById } from '../models/swara.model';
import { clampNumber, readJson, writeJson } from './local-storage';
import { SettingsStore } from './settings.store';

const STORAGE_KEY = 'dilruba-sur-tuner.instrument.v1';

export function resolveString(s: StringConfiguration, mapper: SwaraMapper): ResolvedString {
  const note = mapper.noteFor(s.swara, s.saptak);
  return {
    ...s,
    swaraName: swaraById(s.swara).name,
    westernNote: note.western.name,
    westernOctave: note.western.octave,
    westernLabel: note.western.label,
    saptakName: note.saptak.name,
    midi: note.midi,
    targetFrequency: offsetByCents(note.frequency, s.centsOffset),
  };
}

export function sanitizeInstrument(raw: unknown): InstrumentState {
  const fallback = createDefaultInstrument();
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r['strings'])) return fallback;
  const preset = scalePresetById(String(r['sympatheticPreset'] ?? fallback.sympatheticPreset)).id;
  const startSaptak = Math.round(clampNumber(r['sympatheticStartSaptak'], -2, 2, 0));

  const main: StringConfiguration[] = [];
  const symp: StringConfiguration[] = [];
  for (const item of r['strings'] as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const category =
      s['category'] === 'sympathetic' ? 'sympathetic' : s['category'] === 'main' ? 'main' : null;
    if (!category || !isSwaraId(s['swara'])) continue;
    const list = category === 'main' ? main : symp;
    const order = list.length + 1;
    const base =
      category === 'main'
        ? createMainString(order)
        : createSympatheticString(order, preset, startSaptak);
    list.push({
      ...base,
      name:
        typeof s['name'] === 'string' && s['name'].trim()
          ? s['name'].trim().slice(0, 40)
          : base.name,
      swara: s['swara'],
      saptak: Math.round(clampNumber(s['saptak'], MIN_SAPTAK, MAX_SAPTAK, base.saptak)),
      centsOffset: clampNumber(s['centsOffset'], -50, 50, 0),
    });
  }
  if (main.length < MIN_MAIN_STRINGS) return fallback;
  return {
    version: 1,
    name: typeof r['name'] === 'string' ? r['name'].slice(0, 60) : fallback.name,
    strings: [...main.slice(0, MAX_MAIN_STRINGS), ...symp.slice(0, MAX_SYMPATHETIC_STRINGS)],
    sympatheticPreset: preset,
    sympatheticStartSaptak: startSaptak,
  };
}

@Injectable({ providedIn: 'root' })
export class InstrumentStore {
  private readonly settings = inject(SettingsStore);
  private readonly state = signal<InstrumentState>(sanitizeInstrument(readJson(STORAGE_KEY)));

  readonly instrument = this.state.asReadonly();
  readonly strings = computed(() => this.state().strings);

  /** Every wire with its Western note and target frequency under the current Sa / A4. */
  readonly resolved = computed<ResolvedString[]>(() => {
    const mapper = this.settings.mapper();
    return this.state().strings.map((s) => resolveString(s, mapper));
  });
  readonly mainStrings = computed(() => this.resolved().filter((s) => s.category === 'main'));
  readonly sympatheticStrings = computed(() =>
    this.resolved().filter((s) => s.category === 'sympathetic'),
  );
  readonly mainCount = computed(() => this.mainStrings().length);
  readonly sympatheticCount = computed(() => this.sympatheticStrings().length);

  constructor() {
    effect(() => writeJson(STORAGE_KEY, this.state()));
  }

  stringById(id: string): ResolvedString | undefined {
    return this.resolved().find((s) => s.id === id);
  }

  rename(name: string): void {
    const trimmed = name.trim().slice(0, 60);
    if (trimmed) this.state.update((st) => ({ ...st, name: trimmed }));
  }

  setMainCount(count: number): void {
    const n = Math.round(clampNumber(count, MIN_MAIN_STRINGS, MAX_MAIN_STRINGS, 4));
    this.state.update((st) => {
      const main = st.strings.filter((s) => s.category === 'main').slice(0, n);
      for (let i = main.length + 1; i <= n; i++) main.push(createMainString(i));
      return {
        ...st,
        strings: [...main, ...st.strings.filter((s) => s.category === 'sympathetic')],
      };
    });
  }

  setSympatheticCount(count: number): void {
    const n = Math.round(clampNumber(count, MIN_SYMPATHETIC_STRINGS, MAX_SYMPATHETIC_STRINGS, 0));
    this.state.update((st) => {
      const symp = st.strings.filter((s) => s.category === 'sympathetic').slice(0, n);
      for (let i = symp.length + 1; i <= n; i++) {
        symp.push(createSympatheticString(i, st.sympatheticPreset, st.sympatheticStartSaptak));
      }
      return { ...st, strings: [...st.strings.filter((s) => s.category === 'main'), ...symp] };
    });
  }

  updateString(
    id: string,
    patch: Partial<Pick<StringConfiguration, 'name' | 'swara' | 'saptak' | 'centsOffset'>>,
  ): void {
    this.state.update((st) => ({
      ...st,
      strings: st.strings.map((s) => {
        if (s.id !== id) return s;
        return {
          ...s,
          name: patch.name !== undefined ? patch.name.slice(0, 40) || s.name : s.name,
          swara: patch.swara !== undefined && isSwaraId(patch.swara) ? patch.swara : s.swara,
          saptak:
            patch.saptak !== undefined
              ? Math.round(clampNumber(patch.saptak, MIN_SAPTAK, MAX_SAPTAK, s.saptak))
              : s.saptak,
          centsOffset:
            patch.centsOffset !== undefined
              ? clampNumber(patch.centsOffset, -50, 50, 0)
              : s.centsOffset,
        };
      }),
    }));
  }

  /** Re-tunes every sympathetic string to ascend through a thaat / scale. */
  applySympatheticPreset(presetId: string, startSaptak: number): void {
    const preset = scalePresetById(presetId);
    const start = Math.round(clampNumber(startSaptak, -2, 2, 0));
    this.state.update((st) => ({
      ...st,
      sympatheticPreset: preset.id,
      sympatheticStartSaptak: start,
      strings: st.strings.map((s) => {
        if (s.category !== 'sympathetic') return s;
        const note = scaleNote(preset, s.order - 1, start);
        return { ...s, swara: note.swara, saptak: note.saptak, centsOffset: 0 };
      }),
    }));
  }

  resetMainStrings(): void {
    this.state.update((st) => {
      const count = st.strings.filter((s) => s.category === 'main').length;
      const main: StringConfiguration[] = [];
      for (let i = 1; i <= count; i++) main.push(createMainString(i));
      return {
        ...st,
        strings: [...main, ...st.strings.filter((s) => s.category === 'sympathetic')],
      };
    });
  }

  reset(): void {
    this.state.set(createDefaultInstrument());
  }
}
