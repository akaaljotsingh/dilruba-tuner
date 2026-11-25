import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AudioCaptureService } from '../../core/audio/audio-capture.service';
import { MicrophonePermissionService } from '../../core/audio/microphone-permission.service';
import { WakeLockService } from '../../core/device/wake-lock.service';
import { NoiseFilterLevel } from '../../core/dsp/noise-filter';
import { saptakByOffset } from '../../core/models/swara.model';
import { MAX_A4, MIN_A4 } from '../../core/music/frequency-converter';
import { pitchClassName } from '../../core/music/western-note-mapper';
import { PwaService } from '../../core/pwa/pwa.service';
import { InstrumentStore } from '../../core/state/instrument.store';
import {
  AccentName,
  AppSettings,
  SettingsStore,
  TextScale,
  ThemeName,
} from '../../core/state/settings.store';
import { IconComponent } from '../../shared/components/icon.component';
import { HzPipe } from '../../shared/pipes/frequency.pipes';

@Component({
  selector: 'app-app-settings',
  imports: [RouterLink, IconComponent, HzPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app-settings.component.html',
  styleUrl: './app-settings.component.scss',
})
export class AppSettingsComponent {
  protected readonly store = inject(SettingsStore);
  protected readonly instrument = inject(InstrumentStore);
  protected readonly pwa = inject(PwaService);
  protected readonly engine = inject(AudioCaptureService);
  protected readonly permissions = inject(MicrophonePermissionService);
  protected readonly wakeLock = inject(WakeLockService);

  protected readonly s = this.store.settings;
  protected readonly limits = { MIN_A4, MAX_A4 };
  protected readonly tonics = computed(() =>
    Array.from({ length: 12 }, (_, pc) => ({ pc, name: pitchClassName(pc, this.s().accidentals) })),
  );
  protected readonly noiseLevels: { id: NoiseFilterLevel; label: string }[] = [
    { id: 'off', label: 'Off' },
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
  ];
  protected readonly themes: { id: ThemeName; label: string }[] = [
    { id: 'charcoal', label: 'Charcoal' },
    { id: 'midnight', label: 'Midnight black' },
  ];
  protected readonly accents: { id: AccentName; label: string; color: string }[] = [
    { id: 'saffron', label: 'Saffron', color: '#e8913a' },
    { id: 'gold', label: 'Gold', color: '#c9a45c' },
    { id: 'rose', label: 'Rose', color: '#d9776f' },
  ];
  protected readonly textScales: { id: TextScale; label: string }[] = [
    { id: 'normal', label: 'Normal' },
    { id: 'large', label: 'Large' },
  ];
  protected readonly lowSaptaks = [-3, -2, -1, 0].map(saptakByOffset);
  protected readonly highSaptaks = [0, 1, 2, 3].map(saptakByOffset);

  protected readonly sensitivityLabel = computed(() => {
    const v = this.s().sensitivity;
    return v < 0.34
      ? 'Strict – fewer, surer readings'
      : v < 0.67
        ? 'Balanced'
        : 'Sensitive – responds to quieter playing';
  });
  protected readonly confirmReset = signal(false);

  protected set<K extends keyof Omit<AppSettings, 'version'>>(key: K, value: AppSettings[K]): void {
    this.store.update({ [key]: value } as Partial<AppSettings>);
  }

  protected num(e: Event): number {
    return Number((e.target as HTMLInputElement).value);
  }

  protected setTolerance(which: 'perfectCents' | 'acceptableCents', value: number): void {
    const t = this.s().tolerances;
    const next = { ...t, [which]: value };
    if (which === 'perfectCents' && next.acceptableCents < value) next.acceptableCents = value;
    if (which === 'acceptableCents' && next.perfectCents > value) next.perfectCents = value;
    this.store.update({ tolerances: next });
  }

  protected install(): void {
    void this.pwa.promptInstall();
  }

  protected resetAll(): void {
    if (!this.confirmReset()) {
      this.confirmReset.set(true);
      setTimeout(() => this.confirmReset.set(false), 4000);
      return;
    }
    this.store.reset();
    this.instrument.reset();
    this.confirmReset.set(false);
  }
}
