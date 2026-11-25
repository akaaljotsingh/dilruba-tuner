import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { AnalysisFrameMessage } from '../../core/audio/analysis-protocol';
import { AudioCaptureService } from '../../core/audio/audio-capture.service';
import { WakeLockService } from '../../core/device/wake-lock.service';
import { approach } from '../../core/dsp/audio-smoother';
import { PitchLineTracker } from '../../core/dsp/pitch-line-tracker';
import { SettingsStore, SpectrumView } from '../../core/state/settings.store';
import { AudioStatusComponent } from '../../shared/components/audio-status.component';
import { IconComponent } from '../../shared/components/icon.component';
import { ListenButtonComponent } from '../../shared/components/listen-button.component';
import { SwaraLabelComponent } from '../../shared/components/swara-label.component';
import { CentsPipe, HzPipe } from '../../shared/pipes/frequency.pipes';
import { PrimaryNote, SpectrumRenderer, SpectrumScale, swaraColor } from './spectrum-renderer';

const MIN_PX = 14;
const MAX_PX = 72;

@Component({
  selector: 'app-sur-spectrum',
  imports: [
    ListenButtonComponent,
    AudioStatusComponent,
    SwaraLabelComponent,
    IconComponent,
    HzPipe,
    CentsPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sur-spectrum.component.html',
  styleUrl: './sur-spectrum.component.scss',
})
export class SurSpectrumComponent {
  protected readonly engine = inject(AudioCaptureService);
  protected readonly settings = inject(SettingsStore);
  private readonly wakeLock = inject(WakeLockService);

  private readonly scroller = viewChild.required<ElementRef<HTMLDivElement>>('scroller');
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  /** px per semitone requested by the zoom controls (0 = fit to width). */
  protected readonly zoom = signal(0);
  protected readonly follow = signal(true);
  protected readonly canvasUnsupported = signal(false);
  protected readonly view = computed(() => this.settings.settings().spectrumView);
  private readonly viewportWidth = signal(0);

  protected readonly pitch = this.engine.pitch;
  protected readonly reading = computed(() => {
    const p = this.pitch();
    return p.active && p.frequency > 0
      ? this.settings.mapper().frequencyToSwara(p.frequency)
      : null;
  });
  protected readonly readingColor = computed(() => {
    const r = this.reading();
    return r ? swaraColor(r.swara.semitone, 66) : 'var(--text-faint)';
  });
  protected readonly levelPct = computed(() => {
    const db = this.pitch().levelDb;
    return Math.max(0, Math.min(100, ((db + 80) / 70) * 100));
  });
  protected readonly saptakRange = computed(() => {
    const s = this.settings.settings();
    return { low: s.spectrumLowSaptak, high: s.spectrumHighSaptak };
  });

  private readonly effectivePx = computed(() => {
    const range = this.saptakRange();
    const semis = (range.high - range.low + 1) * 12 + 1;
    const fit = this.viewportWidth() / semis;
    const z = this.zoom();
    // Narrow screens: keep labels readable and scroll horizontally.
    return z > 0 ? z : Math.max(fit, this.viewportWidth() < 700 ? 26 : 18);
  });

  private readonly tracker = new PitchLineTracker();
  private renderer: SpectrumRenderer | null = null;
  private frame = 0;
  private lastTime = 0;
  private lastUserScroll = 0;
  private programmaticScroll = false;
  /** "Your note": follows the monophonic pitch reading, matched to its spectral line. */
  private readonly primary: { frequency: number; intensity: number; lineId: number } = {
    frequency: 0,
    intensity: 0,
    lineId: 0,
  };

  constructor() {
    const destroyRef = inject(DestroyRef);
    const releaseSpectrum = this.engine.useSpectrum();
    const unsubscribe = this.engine.onFrame((f) => this.onFrame(f));

    afterNextRender(() => {
      try {
        this.renderer = new SpectrumRenderer(this.canvasRef().nativeElement);
      } catch {
        this.canvasUnsupported.set(true);
        return;
      }
      const scroller = this.scroller().nativeElement;
      const ro = new ResizeObserver(() => this.layout());
      ro.observe(scroller);
      scroller.addEventListener('scroll', this.onScroll, { passive: true });
      void document.fonts?.ready.then(() => {
        this.renderer?.invalidate();
        this.kick();
      });
      this.viewportWidth.set(scroller.clientWidth);
      // The renderer did not exist when the scale effect first ran – apply it now.
      untracked(() => this.applyScale());
      this.centreOnMadhya();
      destroyRef.onDestroy(() => {
        ro.disconnect();
        scroller.removeEventListener('scroll', this.onScroll);
      });
    });

    // Scale changes (Sa, A4, range, zoom, labels) rebuild the static layer.
    effect(() => this.applyScale());

    // Keep animating while listening; idle otherwise.
    effect(() => {
      if (this.engine.listening()) this.kick();
    });

    destroyRef.onDestroy(() => {
      cancelAnimationFrame(this.frame);
      unsubscribe();
      releaseSpectrum();
    });
  }

  protected zoomBy(factor: number): void {
    const current = this.effectivePx();
    const next = Math.max(MIN_PX, Math.min(MAX_PX, current * factor));
    const scroller = this.scroller().nativeElement;
    const centreRatio =
      (scroller.scrollLeft + scroller.clientWidth / 2) / Math.max(1, scroller.scrollWidth);
    this.zoom.set(next);
    requestAnimationFrame(() => {
      this.programmaticScroll = true;
      scroller.scrollLeft = centreRatio * scroller.scrollWidth - scroller.clientWidth / 2;
    });
  }

  protected setRange(which: 'low' | 'high', delta: number): void {
    const r = this.saptakRange();
    if (which === 'low') {
      this.settings.update({ spectrumLowSaptak: Math.min(0, Math.max(-3, r.low + delta)) });
    } else {
      this.settings.update({ spectrumHighSaptak: Math.max(0, Math.min(3, r.high + delta)) });
    }
  }

  protected readonly needsTap = computed(() =>
    ['idle', 'error', 'paused', 'suspended'].includes(this.engine.status()),
  );
  protected readonly startLabel = computed(() =>
    this.engine.status() === 'paused' || this.engine.status() === 'suspended'
      ? 'Tap to resume'
      : 'Tap to start listening',
  );

  /** Big "Tap to start" – starts audio inside the tap (required on iOS). */
  protected start(): void {
    this.wakeLock.prime();
    void this.engine.start();
  }

  protected stop(): void {
    void this.engine.stop();
  }

  protected setView(view: SpectrumView): void {
    this.settings.update({ spectrumView: view });
    this.kick();
  }

  protected toggle(key: 'showHarmonics' | 'showFrequencyLabels'): void {
    this.settings.update({ [key]: !this.settings.settings()[key] });
  }

  // ---------------------------------------------------------------------------

  private onFrame(frame: AnalysisFrameMessage): void {
    if (!frame.spectrum) return;
    this.tracker.ingest(frame.spectrum.peaks, frame.spectrum.count);
    if (this.follow()) this.maybeFollow(frame);
    this.kick();
  }

  private readonly onScroll = () => {
    if (this.programmaticScroll) {
      this.programmaticScroll = false;
      return;
    }
    this.lastUserScroll = performance.now();
  };

  /** Keeps the played note in view unless the user has just scrolled by hand. */
  private maybeFollow(frame: AnalysisFrameMessage): void {
    if (!this.renderer || !frame.active || frame.held || !frame.stable) return;
    if (performance.now() - this.lastUserScroll < 4000) return;
    const x = this.renderer.xForFrequency(frame.frequency);
    if (!Number.isFinite(x)) return;
    const scroller = this.scroller().nativeElement;
    const margin = scroller.clientWidth * 0.2;
    if (
      x < scroller.scrollLeft + margin ||
      x > scroller.scrollLeft + scroller.clientWidth - margin
    ) {
      this.programmaticScroll = true;
      scroller.scrollTo({
        left: x - scroller.clientWidth / 2,
        behavior: this.settings.settings().reduceMotion ? 'auto' : 'smooth',
      });
    }
  }

  /** Updates the played-note state once per animation frame. */
  private updatePrimary(dt: number): PrimaryNote | null {
    const p = this.primary;
    const frame = this.engine.latestFrame;
    let target = 0;
    if (frame && frame.active && frame.frequency > 0) {
      p.frequency = frame.frequency;
      // Match the spectral line within ±50¢ so its intensity drives the visual.
      const ratio = Math.pow(2, 50 / 1200);
      let best: { id: number; intensity: number } | null = null;
      for (const line of this.tracker.lines) {
        const r = line.frequency / frame.frequency;
        if (r < ratio && r > 1 / ratio && (!best || line.intensity > best.intensity)) {
          best = { id: line.id, intensity: line.intensity };
        }
      }
      p.lineId = best?.id ?? 0;
      // Without a spectral match (e.g. weak fundamental) fall back to the input level.
      const levelNorm = Math.max(0, Math.min(1, (frame.levelDb + 70) / 50));
      // Never let the played note look like faint background.
      target = Math.max(0.35, best ? best.intensity : levelNorm);
    }
    p.intensity = approach(p.intensity, target, dt, 0.04, 0.5);
    if (target === 0 && p.intensity < 0.01) {
      p.intensity = 0;
      p.lineId = 0;
      return null;
    }
    return p;
  }

  private currentScale(): SpectrumScale {
    const s = this.settings.settings();
    return {
      mapper: this.settings.mapper(),
      lowSaptak: s.spectrumLowSaptak,
      highSaptak: s.spectrumHighSaptak,
      pxPerSemitone: this.effectivePx(),
      showFrequencyLabels: s.showFrequencyLabels,
      showHarmonics: s.showHarmonics,
    };
  }

  private applyScale(): void {
    const scale = this.currentScale();
    this.renderer?.setScale(scale);
    this.layout();
  }

  private layout(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const scroller = this.scroller().nativeElement;
    const vw = scroller.clientWidth;
    if (vw !== this.viewportWidth()) this.viewportWidth.set(vw);
    const width = renderer.contentWidth(
      vw,
      untracked(() => this.currentScale()),
    );
    renderer.resize(width, scroller.clientHeight, window.devicePixelRatio || 1);
    this.kick();
  }

  private centreOnMadhya(): void {
    const scroller = this.scroller().nativeElement;
    requestAnimationFrame(() => {
      const x =
        this.renderer?.xForFrequency(this.settings.mapper().targetFrequency('pa', 0)) ?? NaN;
      if (Number.isFinite(x) && scroller.scrollWidth > scroller.clientWidth) {
        this.programmaticScroll = true;
        scroller.scrollLeft = x - scroller.clientWidth / 2;
      }
    });
  }

  private kick(): void {
    if (this.frame || !this.renderer) return;
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.render);
  }

  private readonly render = (now: number) => {
    this.frame = 0;
    const dt = Math.min(0.1, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.tracker.step(dt);
    const primary = this.updatePrimary(dt);
    this.renderer?.draw(this.tracker.lines, this.view(), primary);
    if (this.engine.listening() || !this.tracker.idle || primary) {
      this.frame = requestAnimationFrame(this.render);
    }
  };
}
