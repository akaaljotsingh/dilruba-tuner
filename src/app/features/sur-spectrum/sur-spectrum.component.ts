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
import { scrollElementTo } from '../../shared/utils/scroll';
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
  host: { '(document:keydown)': 'onKeydown($event)' },
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
  /** Phones in portrait get a vertical pitch axis; wider screens stay horizontal. */
  protected readonly vertical = signal(false);
  /** Full-screen mode (Fullscreen API where available, CSS overlay otherwise, e.g. iPhone). */
  protected readonly immersive = signal(false);
  /** Viewport length along the pitch axis (width when horizontal, height when vertical). */
  private readonly viewportLength = signal(0);

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
    const len = this.viewportLength();
    const fit = len / semis;
    const z = this.zoom();
    if (z > 0) return z;
    // Keep swara rows / columns readable; scroll along the pitch axis if needed.
    if (this.vertical()) return Math.max(fit, 30);
    return Math.max(fit, len < 700 ? 26 : 18);
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

    // Orientation follows the screen: vertical on phones held upright.
    const portraitPhone = globalThis.matchMedia?.('(max-width: 819px) and (orientation: portrait)');
    if (portraitPhone) {
      this.vertical.set(portraitPhone.matches);
      const onChange = (e: MediaQueryListEvent) => this.vertical.set(e.matches);
      portraitPhone.addEventListener('change', onChange);
      destroyRef.onDestroy(() => portraitPhone.removeEventListener('change', onChange));
    }

    // Leaving browser fullscreen (Esc, back gesture) also leaves our full-screen layout.
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && this.usedFullscreenApi) {
        this.usedFullscreenApi = false;
        this.immersive.set(false);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    destroyRef.onDestroy(() => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      void this.exitFullscreen();
    });
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
      this.viewportLength.set(this.vertical() ? scroller.clientHeight : scroller.clientWidth);
      // The renderer did not exist when the scale effect first ran – apply it now.
      untracked(() => this.applyScale());
      this.centreOnMadhya();
      destroyRef.onDestroy(() => {
        ro.disconnect();
        scroller.removeEventListener('scroll', this.onScroll);
      });
    });

    // Scale changes (Sa, A4, range, zoom, labels, orientation) rebuild the static layer.
    effect(() => this.applyScale());

    // Rotating the phone or entering full screen changes the layout: re-centre on the music.
    effect(() => {
      this.vertical();
      this.immersive();
      untracked(() => {
        if (!this.renderer) return;
        this.zoom.set(0);
        requestAnimationFrame(() => {
          this.layout();
          this.centreOnMadhya();
        });
      });
    });

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
    const a = this.axis(scroller);
    const centreRatio = (a.pos + a.client / 2) / Math.max(1, a.total);
    this.zoom.set(next);
    requestAnimationFrame(() => {
      const b = this.axis(scroller);
      this.programmaticScroll = true;
      this.setScroll(scroller, centreRatio * b.total - b.client / 2, false);
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

  protected toggleFullscreen(): void {
    if (this.immersive()) void this.exitFullscreen();
    else void this.enterFullscreen();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.immersive()) void this.exitFullscreen();
  }

  private usedFullscreenApi = false;

  private async enterFullscreen(): Promise<void> {
    this.immersive.set(true);
    const root = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    try {
      if (root.requestFullscreen) {
        await root.requestFullscreen({ navigationUI: 'hide' });
        this.usedFullscreenApi = true;
      } else if (root.webkitRequestFullscreen) {
        await root.webkitRequestFullscreen();
        this.usedFullscreenApi = true;
      }
    } catch {
      // iPhone Safari and some WebViews refuse: the CSS full-screen layout still applies.
    }
  }

  private async exitFullscreen(): Promise<void> {
    this.immersive.set(false);
    if (this.usedFullscreenApi && document.fullscreenElement) {
      this.usedFullscreenApi = false;
      try {
        await document.exitFullscreen();
      } catch {
        /* already left */
      }
    }
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
    const p = this.renderer.posForFrequency(frame.frequency);
    if (!Number.isFinite(p)) return;
    const scroller = this.scroller().nativeElement;
    const a = this.axis(scroller);
    const margin = a.client * 0.2;
    if (p < a.pos + margin || p > a.pos + a.client - margin) {
      this.programmaticScroll = true;
      this.setScroll(scroller, p - a.client / 2, !this.settings.settings().reduceMotion);
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
    this.renderer?.setOrientation(this.vertical() ? 'vertical' : 'horizontal');
    this.renderer?.setScale(scale);
    this.layout();
  }

  /** Scroll metrics along the pitch axis. */
  private axis(el: HTMLElement): { pos: number; client: number; total: number } {
    return this.vertical()
      ? { pos: el.scrollTop, client: el.clientHeight, total: el.scrollHeight }
      : { pos: el.scrollLeft, client: el.clientWidth, total: el.scrollWidth };
  }

  private setScroll(el: HTMLElement, value: number, smooth: boolean): void {
    scrollElementTo(el, this.vertical() ? { top: value } : { left: value }, smooth);
  }

  private layout(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const scroller = this.scroller().nativeElement;
    const vertical = untracked(() => this.vertical());
    const len = vertical ? scroller.clientHeight : scroller.clientWidth;
    if (len !== untracked(() => this.viewportLength())) this.viewportLength.set(len);
    const content = renderer.contentLength(
      len,
      untracked(() => this.currentScale()),
    );
    const dpr = window.devicePixelRatio || 1;
    if (vertical) renderer.resize(scroller.clientWidth, content, dpr);
    else renderer.resize(content, scroller.clientHeight, dpr);
    this.kick();
  }

  private centreOnMadhya(): void {
    const scroller = this.scroller().nativeElement;
    requestAnimationFrame(() => {
      const p =
        this.renderer?.posForFrequency(this.settings.mapper().targetFrequency('pa', 0)) ?? NaN;
      const a = this.axis(scroller);
      if (Number.isFinite(p) && a.total > a.client) {
        this.programmaticScroll = true;
        this.setScroll(scroller, p - a.client / 2, false);
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
