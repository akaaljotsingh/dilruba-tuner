import { PitchLine } from '../../core/dsp/pitch-line-tracker';
import { PeakClass } from '../../core/models/spectrum-result.model';
import { saptakByOffset, swaraBySemitone } from '../../core/models/swara.model';
import { SwaraMapper } from '../../core/music/swara-mapper';
import { mod12 } from '../../core/music/western-note-mapper';

export interface SpectrumScale {
  readonly mapper: SwaraMapper;
  /** Saptak offsets (relative to Madhya) shown. */
  readonly lowSaptak: number;
  readonly highSaptak: number;
  /** Requested density along the pitch axis; the renderer stretches to fill larger viewports. */
  readonly pxPerSemitone: number;
  readonly showFrequencyLabels: boolean;
  readonly showHarmonics: boolean;
}

/** The note the musician is playing (from the monophonic pitch reading), drawn prominently. */
export interface PrimaryNote {
  readonly frequency: number;
  /** Displayed intensity 0–1. */
  readonly intensity: number;
  /** Id of the matching spectral line (0 if none) so it isn't drawn twice. */
  readonly lineId: number;
}

export type SpectrumViewMode = 'focus' | 'all';

/**
 * `horizontal`: pitch runs left → right, lines grow upwards (laptops, tablets, phones held sideways).
 * `vertical`: pitch runs bottom → top, lines grow to the right (phones in portrait).
 */
export type SpectrumOrientation = 'horizontal' | 'vertical';

// Horizontal layout
const HEADER_H = 30;
const FOOTER_H = 66;
// Vertical layout
const GUTTER_W = 66;
const RIGHT_PAD = 8;

const LABEL_W = 78;
const LABEL_H = 50;
const BIG_LABEL_W = 132;
const BIG_LABEL_H = 64;
const RESONANCE_COLOR = 'hsl(172, 34%, 62%)';

interface LabelItem {
  /** Position of the line along the pitch axis. */
  readonly pos: number;
  /** Where the line ends on the cross axis (vertical layout places the label after it). */
  readonly lineEnd: number;
  readonly frequency: number;
  readonly intensity: number;
  readonly resonance: boolean;
  readonly primary: boolean;
}

/** Hue for each swara (semitone above Sa). Sa is gold; the wheel moves through warm to cool tones. */
export function swaraColor(semitone: number, lightness = 64, alpha = 1): string {
  const hue = (42 + mod12(semitone) * 29) % 360;
  return `hsla(${hue}, 72%, ${lightness}%, ${alpha})`;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Canvas renderer for the Sur Spectrum. Static elements (saptak bands, swara
 * grid, labels) are drawn once to an offscreen layer; each animation frame only
 * composites that layer and draws the live pitch lines.
 */
export class SpectrumRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly staticLayer: HTMLCanvasElement;
  private readonly staticCtx: CanvasRenderingContext2D;
  private scale: SpectrumScale | null = null;
  private orientation: SpectrumOrientation = 'horizontal';
  private width = 0;
  private height = 0;
  private dpr = 1;
  private lowMidi = 0;
  private highMidi = 0;
  private px = 24;
  private staticDirty = true;
  private colors = {
    text: '#efe6d4',
    muted: '#b2a794',
    faint: '#7d7466',
    gold: '#c9a45c',
    line: 'rgba(236,224,202,0.08)',
    bg: '#1e1b1f',
  };
  private displayFont = 'Cormorant Garamond, Georgia, serif';
  private uiFont = 'Inter Variable, Inter, system-ui, sans-serif';

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
    this.staticLayer = document.createElement('canvas');
    const sctx = this.staticLayer.getContext('2d');
    if (!sctx) throw new Error('Canvas 2D unavailable');
    this.staticCtx = sctx;
  }

  get vertical(): boolean {
    return this.orientation === 'vertical';
  }

  /** Total CSS length the spectrum needs along its pitch axis for a given viewport length. */
  contentLength(viewportLength: number, scale: SpectrumScale): number {
    const semis = semitoneSpan(scale);
    return Math.max(viewportLength, Math.round(semis * scale.pxPerSemitone));
  }

  setScale(scale: SpectrumScale): void {
    this.scale = scale;
    this.staticDirty = true;
  }

  setOrientation(orientation: SpectrumOrientation): void {
    if (orientation !== this.orientation) {
      this.orientation = orientation;
      this.staticDirty = true;
    }
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.width = Math.max(1, Math.round(cssWidth));
    this.height = Math.max(1, Math.round(cssHeight));
    this.dpr = Math.min(3, Math.max(1, dpr));
    for (const c of [this.canvas, this.staticLayer]) {
      c.width = Math.round(this.width * this.dpr);
      c.height = Math.round(this.height * this.dpr);
    }
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.staticDirty = true;
  }

  invalidate(): void {
    this.staticDirty = true;
  }

  /** Position (CSS px) of a frequency along the pitch axis, or NaN if out of range. */
  posForFrequency(frequency: number): number {
    if (!this.scale || !(frequency > 0)) return Number.NaN;
    const midi = this.scale.mapper.frequencyToMidi(frequency);
    if (midi < this.lowMidi || midi > this.highMidi) return Number.NaN;
    return this.pos(midi);
  }

  /**
   * @param view `focus` draws only the primary (played) note; `all` draws every
   *   component with the primary note highlighted and the rest dimmed.
   */
  draw(lines: readonly PitchLine[], view: SpectrumViewMode, primary: PrimaryNote | null): void {
    if (!this.scale || this.width < 2) return;
    if (this.staticDirty) this.drawStatic();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.staticLayer, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const scale = this.scale;
    const mapper = scale.mapper;
    const extent = this.crossExtent();
    const hasPrimary = !!primary && primary.intensity > 0.01 && primary.frequency > 0;
    const labels: LabelItem[] = [];

    if (view === 'all') {
      // Other sounds are context: dimmed when a played note is present, weakest first.
      const dim = hasPrimary ? 0.5 : 1;
      const order = lines.slice().sort((a, b) => a.intensity - b.intensity);
      for (const line of order) {
        if (line.intensity < 0.01) continue;
        if (hasPrimary && line.id === primary!.lineId) continue;
        if (line.cls === PeakClass.Noise) continue;
        if (line.cls === PeakClass.Harmonic && !scale.showHarmonics) continue;
        const midi = mapper.frequencyToMidi(line.frequency);
        if (midi < this.lowMidi || midi > this.highMidi) continue;
        const pos = this.pos(midi);
        const semitone = mod12(Math.round(midi) - mapper.madhyaSaMidi);
        const k = Math.pow(line.intensity, 0.85);

        let color: string;
        let width: number;
        let alpha: number;
        switch (line.cls) {
          case PeakClass.Fundamental:
            color = swaraColor(semitone, 52 + 14 * k);
            width = 2 + 4 * k;
            alpha = 0.18 + 0.72 * k;
            break;
          case PeakClass.Resonance:
            color = RESONANCE_COLOR;
            width = 1.5 + 2 * k;
            alpha = 0.12 + 0.55 * k;
            break;
          case PeakClass.Harmonic:
            color = this.colors.gold;
            width = 1 + 1.5 * k;
            alpha = 0.06 + 0.36 * k;
            break;
          default:
            color = this.colors.muted;
            width = 1 + 1.2 * k;
            alpha = 0.04 + 0.25 * k;
        }
        const len = extent * (0.18 + 0.82 * k);
        this.strokeLine(pos, len, color, width, alpha * dim, {
          glow: !hasPrimary && line.cls === PeakClass.Fundamental && k > 0.35 ? 18 * k : 0,
          dashed: line.cls === PeakClass.Resonance,
        });

        if (
          (line.cls === PeakClass.Fundamental || line.cls === PeakClass.Resonance) &&
          line.age >= 2 &&
          k > 0.15
        ) {
          labels.push({
            pos,
            lineEnd: this.crossBase() + len,
            frequency: line.frequency,
            intensity: line.intensity * dim,
            resonance: line.cls === PeakClass.Resonance,
            primary: false,
          });
        }
      }
    }

    if (hasPrimary) {
      const p = primary!;
      const midi = mapper.frequencyToMidi(p.frequency);
      if (midi >= this.lowMidi && midi <= this.highMidi) {
        const pos = this.pos(midi);
        const semitone = mod12(Math.round(midi) - mapper.madhyaSaMidi);
        const k = Math.pow(p.intensity, 0.85);
        const color = swaraColor(semitone, 60 + 8 * k);
        // Highlight the swara's own label cell (bottom row / left gutter).
        ctx.globalAlpha = 0.18 + 0.3 * k;
        ctx.fillStyle = color;
        const cell = this.pos(Math.round(midi));
        if (this.vertical) {
          ctx.fillRect(0, cell - this.px / 2, GUTTER_W, this.px);
        } else {
          ctx.fillRect(cell - this.px / 2, this.height - FOOTER_H, this.px, FOOTER_H);
        }
        ctx.globalAlpha = 1;
        // The played note: bold, long, glowing. Length and brightness still follow intensity.
        const len = extent * (0.45 + 0.55 * k);
        this.strokeLine(pos, len, color, 4 + 5 * k, 0.45 + 0.55 * k, {
          glow: 10 + 16 * k,
          dashed: false,
        });
        labels.unshift({
          pos,
          lineEnd: this.crossBase() + len,
          frequency: p.frequency,
          intensity: p.intensity,
          resonance: false,
          primary: true,
        });
      }
    }

    this.drawLabels(labels, view);
  }

  // ---- geometry ------------------------------------------------------------------

  /** Pitch-axis position of a (fractional) MIDI note. */
  private pos(midi: number): number {
    return this.vertical ? (this.highMidi - midi) * this.px : (midi - this.lowMidi) * this.px;
  }

  /** Where lines start on the cross axis (bottom edge, or the gutter edge). */
  private crossBase(): number {
    return this.vertical ? GUTTER_W : this.height - FOOTER_H;
  }

  /** Room available for line length on the cross axis. */
  private crossExtent(): number {
    return this.vertical ? this.width - GUTTER_W - RIGHT_PAD : this.height - FOOTER_H - HEADER_H;
  }

  private strokeLine(
    pos: number,
    len: number,
    color: string,
    width: number,
    alpha: number,
    opts: { glow: number; dashed: boolean },
  ): void {
    const ctx = this.ctx;
    const base = this.crossBase();
    // Horizontal layout grows up (towards smaller y); vertical grows right.
    const [x0, y0, x1, y1] = this.vertical
      ? [base, pos, base + len, pos]
      : [pos, base, pos, base - len];
    ctx.globalAlpha = alpha;
    const grad = ctx.createLinearGradient(x1, y1, x0, y0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.2, color);
    grad.addColorStop(1, color);
    ctx.strokeStyle = grad;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    if (opts.glow > 0) {
      ctx.shadowColor = color;
      ctx.shadowBlur = opts.glow;
    }
    if (opts.dashed) ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // ---- labels ------------------------------------------------------------------

  private drawLabels(labels: LabelItem[], view: SpectrumViewMode): void {
    if (!this.scale || labels.length === 0) return;
    const ctx = this.ctx;
    const mapper = this.scale.mapper;
    // Primary first, then by strength; keep the canvas readable.
    const ordered = [
      ...labels.filter((l) => l.primary),
      ...labels
        .filter((l) => !l.primary)
        .sort((a, b) => b.intensity - a.intensity)
        .slice(0, 3),
    ];
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const overlaps = (x0: number, y0: number, w: number, h: number) =>
      placed.some((p) => !(x0 + w < p.x0 || x0 > p.x1) && !(y0 + h < p.y0 || y0 > p.y1));

    for (const item of ordered) {
      const reading = mapper.frequencyToSwara(item.frequency);
      if (!reading) continue;
      const big = item.primary;
      const w = big ? BIG_LABEL_W : LABEL_W;
      const h = big ? BIG_LABEL_H : LABEL_H;
      const showYou = big && view === 'all';

      let x0: number;
      let y0: number;
      if (this.vertical) {
        // Beside the end of the line, vertically centred on it; nudge to avoid overlaps.
        x0 = Math.min(this.width - w - 6, Math.max(GUTTER_W + 6, item.lineEnd + 10));
        y0 = item.pos - h / 2;
        const clampY = (y: number) =>
          Math.min(this.height - h - 4, Math.max(4 + (showYou ? 14 : 0), y));
        y0 = clampY(y0);
        for (let step = 1; step < 6 && overlaps(x0, y0, w, h); step++) {
          const delta = Math.ceil(step / 2) * (LABEL_H + 6) * (step % 2 ? 1 : -1);
          y0 = clampY(item.pos - h / 2 + delta);
        }
      } else {
        x0 = Math.min(this.width - w - 4, Math.max(4, item.pos - w / 2));
        y0 = HEADER_H + (showYou ? 22 : 8);
        while (overlaps(x0, y0, w, h) && y0 < HEADER_H + 200) y0 += LABEL_H + 6;
      }
      placed.push({ x0, x1: x0 + w, y0, y1: y0 + h });

      const k = Math.pow(Math.min(1, item.intensity), 0.85);
      const color = item.resonance ? RESONANCE_COLOR : swaraColor(reading.swara.semitone, 66);

      ctx.globalAlpha = big ? 1 : 0.5 + 0.4 * k;
      if (showYou) {
        ctx.fillStyle = color;
        ctx.font = `700 10px ${this.uiFont}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(this.vertical ? 'YOUR NOTE' : '▼ YOUR NOTE', x0 + w / 2, y0 - 6);
      }
      ctx.fillStyle = 'rgba(18, 17, 19, 0.9)';
      roundRect(ctx, x0, y0, w, h, big ? 12 : 9);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = big ? 1.5 : 1;
      ctx.stroke();

      // Swara with komal / tivra / saptak marks.
      const size = big ? 28 : 20;
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `600 ${size}px ${this.displayFont}`;
      const text = reading.swara.short;
      const tx = x0 + (big ? 14 : 10);
      const ty = y0 + (big ? 32 : 22);
      ctx.fillText(text, tx, ty);
      const tw = ctx.measureText(text).width;
      this.drawMarks(ctx, tx, ty, tw, size, reading.swara.variant, reading.saptak.offset, color);

      ctx.font = `600 ${big ? 13 : 11}px ${this.uiFont}`;
      ctx.fillStyle = this.colors.text;
      ctx.textAlign = 'right';
      ctx.fillText(reading.western.label, x0 + w - 10, y0 + (big ? 22 : 18));
      if (big) {
        ctx.font = `500 10px ${this.uiFont}`;
        ctx.fillStyle = this.colors.muted;
        ctx.fillText(reading.saptak.name, x0 + w - 10, y0 + 36);
      }

      ctx.textAlign = 'left';
      ctx.fillStyle = this.colors.muted;
      ctx.font = `500 ${big ? 11 : 10}px ${this.uiFont}`;
      const cents = Math.round(reading.cents);
      const centsText = `${cents > 0 ? '+' : cents < 0 ? '−' : '±'}${Math.abs(cents)}¢`;
      const detail = this.scale.showFrequencyLabels
        ? `${item.frequency.toFixed(1)} Hz  ${centsText}`
        : item.resonance
          ? 'resonance'
          : centsText;
      ctx.fillText(detail, x0 + (big ? 14 : 10), y0 + (big ? 54 : 40));
      ctx.globalAlpha = 1;

      // Connector from the label to its line.
      ctx.strokeStyle = color;
      ctx.globalAlpha = big ? 0.7 : 0.35 * k;
      ctx.beginPath();
      if (this.vertical) {
        const cy = Math.min(y0 + h - 6, Math.max(y0 + 6, item.pos));
        ctx.moveTo(Math.min(item.lineEnd, x0), item.pos);
        ctx.lineTo(x0, cy);
      } else {
        ctx.moveTo(item.pos, y0 + h);
        ctx.lineTo(item.pos, y0 + h + 10);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawMarks(
    ctx: CanvasRenderingContext2D,
    x: number,
    baseline: number,
    textWidth: number,
    size: number,
    variant: string,
    saptak: number,
    color: string,
  ): void {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    const cx = x + textWidth / 2;
    if (variant === 'komal') {
      ctx.fillRect(x, baseline + 3, textWidth, 1.3);
    }
    if (variant === 'tivra') {
      ctx.fillRect(cx - 0.65, baseline - size * 0.95, 1.3, size * 0.28);
    }
    const dots = Math.min(3, Math.abs(saptak));
    for (let i = 0; i < dots; i++) {
      const dx = cx + (i - (dots - 1) / 2) * 5;
      const dy =
        saptak > 0
          ? baseline - size * (variant === 'tivra' ? 1.12 : 0.92)
          : baseline + (variant === 'komal' ? 9 : 6);
      ctx.beginPath();
      ctx.arc(dx, dy, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- static layer --------------------------------------------------------------

  private drawStatic(): void {
    const scale = this.scale;
    if (!scale) return;
    this.staticDirty = false;
    this.colors = {
      text: cssVar('--text', this.colors.text),
      muted: cssVar('--text-muted', this.colors.muted),
      faint: cssVar('--text-faint', this.colors.faint),
      gold: cssVar('--gold', this.colors.gold),
      line: cssVar('--line-strong', this.colors.line),
      bg: cssVar('--surface', this.colors.bg),
    };
    const mapper = scale.mapper;
    const semis = semitoneSpan(scale);
    this.lowMidi = mapper.madhyaSaMidi + 12 * scale.lowSaptak - 0.5;
    this.highMidi = this.lowMidi + semis;
    this.px = (this.vertical ? this.height : this.width) / semis;

    const ctx = this.staticCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.staticLayer.width, this.staticLayer.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.vertical) this.drawStaticVertical(ctx, scale);
    else this.drawStaticHorizontal(ctx, scale);
  }

  private bandFill(s: number, scale: SpectrumScale): string {
    return s === 0
      ? 'rgba(201, 164, 92, 0.045)'
      : (s - scale.lowSaptak) % 2 === 0
        ? 'rgba(255,255,255,0.018)'
        : 'rgba(0,0,0,0)';
  }

  private gridFill(semitone: number): string {
    return semitone === 0
      ? 'rgba(201, 164, 92, 0.38)'
      : semitone === 7
        ? 'rgba(236,224,202,0.12)'
        : 'rgba(236,224,202,0.05)';
  }

  private labelColor(semitone: number): string {
    const swara = swaraBySemitone(semitone);
    return semitone === 0
      ? this.colors.gold
      : swara.variant === 'shuddh' || swara.variant === 'achal'
        ? this.colors.text
        : this.colors.muted;
  }

  private drawStaticHorizontal(ctx: CanvasRenderingContext2D, scale: SpectrumScale): void {
    const mapper = scale.mapper;
    const plotTop = HEADER_H;
    const plotBottom = this.height - FOOTER_H;

    for (let s = scale.lowSaptak; s <= scale.highSaptak; s++) {
      const start = this.pos(mapper.madhyaSaMidi + 12 * s);
      const end = start + 12 * this.px;
      ctx.fillStyle = this.bandFill(s, scale);
      ctx.fillRect(start, 0, end - start, this.height);
      ctx.fillStyle = s === 0 ? this.colors.gold : this.colors.faint;
      ctx.font = `600 11px ${this.uiFont}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.save();
      ctx.letterSpacing = '2px';
      ctx.fillText(
        `${saptakByOffset(s).name.toUpperCase()} SAPTAK`,
        (start + end) / 2,
        HEADER_H / 2,
      );
      ctx.restore();
    }

    ctx.fillStyle = this.colors.line;
    ctx.fillRect(0, plotTop - 0.5, this.width, 1);
    ctx.fillRect(0, plotBottom - 0.5, this.width, 1);

    for (let m = Math.ceil(this.lowMidi); m <= this.highMidi; m++) {
      const x = this.pos(m);
      const semitone = mod12(m - mapper.madhyaSaMidi);
      const swara = swaraBySemitone(semitone);
      ctx.fillStyle = this.gridFill(semitone);
      ctx.fillRect(Math.round(x) - 0.5, plotTop, 1, plotBottom - plotTop);

      const saptak = Math.floor((m - mapper.madhyaSaMidi) / 12);
      const color = this.labelColor(semitone);
      const fontSize = this.px < 20 ? 13 : 16;
      ctx.font = `${semitone === 0 || semitone === 7 ? 700 : 600} ${fontSize}px ${this.displayFont}`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const ty = plotBottom + 26;
      ctx.fillText(swara.short, x, ty);
      const tw = ctx.measureText(swara.short).width;
      this.drawMarks(ctx, x - tw / 2, ty, tw, fontSize, swara.variant, saptak, color);

      const west = mapper.midiToWestern(m);
      ctx.font = `500 ${this.px < 20 ? 8 : 10}px ${this.uiFont}`;
      ctx.fillStyle = this.colors.faint;
      ctx.fillText(this.px < 16 && semitone !== 0 ? west.name : west.label, x, plotBottom + 52);
    }
  }

  private drawStaticVertical(ctx: CanvasRenderingContext2D, scale: SpectrumScale): void {
    const mapper = scale.mapper;

    // Saptak bands as horizontal rows (higher saptak above), name at the top-right of each.
    for (let s = scale.lowSaptak; s <= scale.highSaptak; s++) {
      const bottom = this.pos(mapper.madhyaSaMidi + 12 * s);
      const top = bottom - 12 * this.px;
      ctx.fillStyle = this.bandFill(s, scale);
      ctx.fillRect(0, top, this.width, bottom - top);
      ctx.fillStyle = s === 0 ? this.colors.gold : this.colors.faint;
      ctx.font = `600 10px ${this.uiFont}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.save();
      ctx.letterSpacing = '2px';
      ctx.globalAlpha = 0.85;
      ctx.fillText(
        `${saptakByOffset(s).name.toUpperCase()} SAPTAK`,
        this.width - RIGHT_PAD - 2,
        top + this.px * 0.75,
      );
      ctx.restore();
    }

    // Gutter separator.
    ctx.fillStyle = this.colors.line;
    ctx.fillRect(GUTTER_W - 0.5, 0, 1, this.height);

    for (let m = Math.ceil(this.lowMidi); m <= this.highMidi; m++) {
      const y = this.pos(m);
      const semitone = mod12(m - mapper.madhyaSaMidi);
      const swara = swaraBySemitone(semitone);
      ctx.fillStyle = this.gridFill(semitone);
      ctx.fillRect(GUTTER_W, Math.round(y) - 0.5, this.width - GUTTER_W, 1);

      const saptak = Math.floor((m - mapper.madhyaSaMidi) / 12);
      const color = this.labelColor(semitone);
      const fontSize = this.px < 24 ? 14 : 17;
      ctx.font = `${semitone === 0 || semitone === 7 ? 700 : 600} ${fontSize}px ${this.displayFont}`;
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const ty = y + fontSize * 0.32;
      const tx = 10;
      ctx.fillText(swara.short, tx, ty);
      const tw = ctx.measureText(swara.short).width;
      this.drawMarks(ctx, tx, ty, tw, fontSize, swara.variant, saptak, color);

      const west = mapper.midiToWestern(m);
      ctx.font = `500 ${this.px < 24 ? 9 : 10}px ${this.uiFont}`;
      ctx.fillStyle = this.colors.faint;
      ctx.textAlign = 'right';
      ctx.fillText(west.label, GUTTER_W - 6, y + 3.5);
    }
  }
}

function semitoneSpan(scale: SpectrumScale): number {
  return (scale.highSaptak - scale.lowSaptak + 1) * 12 + 1;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
