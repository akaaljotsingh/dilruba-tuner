import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AudioCaptureService } from '../../core/audio/audio-capture.service';
import { ReferenceToneService } from '../../core/audio/reference-tone.service';
import { ResolvedString } from '../../core/models/string-configuration.model';
import { TUNING_STATUS_LABELS } from '../../core/models/tuning-result.model';
import { evaluateTuning } from '../../core/music/tuning-evaluator';
import { readJson, writeJson } from '../../core/state/local-storage';
import { InstrumentStore } from '../../core/state/instrument.store';
import { SettingsStore } from '../../core/state/settings.store';
import { AudioStatusComponent } from '../../shared/components/audio-status.component';
import { IconComponent } from '../../shared/components/icon.component';
import { ListenButtonComponent } from '../../shared/components/listen-button.component';
import { SwaraLabelComponent } from '../../shared/components/swara-label.component';
import { TunerMeterComponent } from '../../shared/components/tuner-meter.component';
import { CentsPipe, HzPipe } from '../../shared/pipes/frequency.pipes';

const SELECTED_KEY = 'dilruba-sur-tuner.selected-string';
/** Time a wire must stay perfectly tuned before it is ticked off. */
const TUNED_HOLD_MS = 1200;

function tunedKey(s: ResolvedString | undefined): string {
  return s ? `${s.id}@${s.targetFrequency.toFixed(3)}` : '';
}

@Component({
  selector: 'app-wire-tuner',
  imports: [
    RouterLink,
    IconComponent,
    ListenButtonComponent,
    AudioStatusComponent,
    SwaraLabelComponent,
    TunerMeterComponent,
    HzPipe,
    CentsPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wire-tuner.component.html',
  styleUrl: './wire-tuner.component.scss',
  host: { '(window:keydown)': 'onKey($event)' },
})
export class WireTunerComponent {
  protected readonly engine = inject(AudioCaptureService);
  protected readonly instrument = inject(InstrumentStore);
  protected readonly settings = inject(SettingsStore);
  protected readonly tone = inject(ReferenceToneService);

  /** Optional `?string=main-1` query parameter. */
  readonly string = input<string | undefined>();

  protected readonly selectedId = linkedSignal<string>(() => {
    const requested = this.string();
    const remembered = untracked(() => readJson<string>(SELECTED_KEY));
    const all = untracked(() => this.instrument.resolved());
    const candidate = [requested, remembered].find((id) => id && all.some((s) => s.id === id));
    return candidate ?? all[0]?.id ?? 'main-1';
  });

  protected readonly selected = computed(() => {
    const all = this.instrument.resolved();
    return all.find((s) => s.id === this.selectedId()) ?? all[0];
  });

  protected readonly pitch = this.engine.pitch;
  protected readonly hasReading = computed(() => this.pitch().active && this.pitch().frequency > 0);

  protected readonly detected = computed(() => {
    const p = this.pitch();
    return p.active ? this.settings.mapper().frequencyToSwara(p.frequency) : null;
  });

  protected readonly tuning = computed(() => {
    const p = this.pitch();
    const target = this.selected();
    if (!target) return null;
    return evaluateTuning(
      p.active ? p.frequency : 0,
      target.targetFrequency,
      this.settings.tolerances(),
      {
        confident: p.active && !p.held,
        stable: p.stable,
      },
    );
  });

  protected readonly statusLabel = computed(() => {
    const t = this.tuning();
    return t && this.hasReading() && t.octaveOffset === 0 ? TUNING_STATUS_LABELS[t.status] : '';
  });

  /**
   * Wires ticked off during this session, keyed by id and target frequency so that
   * changing a wire's target (or Sa / A4) automatically clears its tick.
   */
  protected readonly tunedKeys = signal<ReadonlySet<string>>(new Set());
  private perfectSince = 0;

  protected readonly selectedIndex = computed(() =>
    this.instrument.resolved().findIndex((s) => s.id === this.selectedId()),
  );

  constructor() {
    effect(() => writeJson(SELECTED_KEY, this.selectedId()));

    // Tick a wire once it has been held perfectly in tune.
    effect(() => {
      const t = this.tuning();
      const target = this.selected();
      const perfect = !!t && t.action === 'none' && this.pitch().stable;
      const now = performance.now();
      if (!perfect) {
        this.perfectSince = 0;
        return;
      }
      if (!this.perfectSince) this.perfectSince = now;
      if (now - this.perfectSince >= TUNED_HOLD_MS) {
        const key = tunedKey(target);
        untracked(() => {
          if (!this.tunedKeys().has(key)) this.tunedKeys.update((set) => new Set(set).add(key));
        });
      }
    });

    inject(DestroyRef).onDestroy(() => this.tone.stopNow());
  }

  protected select(id: string): void {
    this.perfectSince = 0;
    this.selectedId.set(id);
  }

  protected step(delta: number): void {
    const all = this.instrument.resolved();
    if (!all.length) return;
    const i = Math.max(0, this.selectedIndex());
    this.select(all[(i + delta + all.length) % all.length].id);
  }

  protected playReference(): void {
    const s = this.selected();
    if (!s) return;
    if (this.tone.playingFrequency()) this.tone.stopNow();
    else this.tone.play(s.targetFrequency);
  }

  protected isTuned(s: ResolvedString): boolean {
    return this.tunedKeys().has(tunedKey(s));
  }

  protected readonly tunedCount = computed(
    () => this.instrument.resolved().filter((s) => this.isTuned(s)).length,
  );

  protected resetTicks(): void {
    this.tunedKeys.set(new Set());
  }

  protected onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    if (event.key === 'ArrowRight') {
      this.step(1);
      event.preventDefault();
    } else if (event.key === 'ArrowLeft') {
      this.step(-1);
      event.preventDefault();
    }
  }
}
