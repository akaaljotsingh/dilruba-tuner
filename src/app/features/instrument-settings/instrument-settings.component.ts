import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  MAX_MAIN_STRINGS,
  MAX_SYMPATHETIC_STRINGS,
  MIN_MAIN_STRINGS,
  MIN_SYMPATHETIC_STRINGS,
} from '../../core/models/instrument-configuration.model';
import { SAPTAKS } from '../../core/models/swara.model';
import { SCALE_PRESETS } from '../../core/music/instrument-presets';
import { InstrumentStore } from '../../core/state/instrument.store';
import { SettingsStore } from '../../core/state/settings.store';
import { IconComponent } from '../../shared/components/icon.component';
import { HzPipe } from '../../shared/pipes/frequency.pipes';
import { StringRowComponent } from './string-row.component';

@Component({
  selector: 'app-instrument-settings',
  imports: [StringRowComponent, IconComponent, HzPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './instrument-settings.component.html',
  styleUrl: './instrument-settings.component.scss',
})
export class InstrumentSettingsComponent {
  protected readonly store = inject(InstrumentStore);
  protected readonly settings = inject(SettingsStore);

  protected readonly presets = SCALE_PRESETS;
  protected readonly startSaptaks = SAPTAKS.filter((s) => s.offset >= -2 && s.offset <= 2);
  protected readonly limits = {
    MIN_MAIN_STRINGS,
    MAX_MAIN_STRINGS,
    MIN_SYMPATHETIC_STRINGS,
    MAX_SYMPATHETIC_STRINGS,
  };
  protected readonly octaves = [1, 2, 3, 4, 5];

  protected readonly presetId = signal(this.store.instrument().sympatheticPreset);
  protected readonly presetStart = signal(this.store.instrument().sympatheticStartSaptak);
  protected readonly confirmReset = signal(false);

  protected readonly madhyaSa = computed(() => this.settings.mapper().noteFor('sa', 0));

  protected rename(e: Event): void {
    const name = (e.target as HTMLInputElement).value.trim();
    if (name) this.store.rename(name);
  }

  protected setMadhyaOctave(e: Event): void {
    this.settings.update({ madhyaSaOctave: Number((e.target as HTMLSelectElement).value) });
  }

  protected applyPreset(): void {
    this.store.applySympatheticPreset(this.presetId(), this.presetStart());
  }

  protected reset(): void {
    if (!this.confirmReset()) {
      this.confirmReset.set(true);
      setTimeout(() => this.confirmReset.set(false), 4000);
      return;
    }
    this.store.reset();
    this.presetId.set(this.store.instrument().sympatheticPreset);
    this.presetStart.set(this.store.instrument().sympatheticStartSaptak);
    this.confirmReset.set(false);
  }
}
