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
  /** Requested horizontal density; the renderer stretches to fill wider containers. */
  readonly pxPerSemitone: number;
  readonly showFrequencyLabels: boolean;
  readonly showHarmonics: boolean;
}

const HEADER_H = 30;
const FOOTER_H = 66;
const LABEL_W = 78;
const LABEL_H = 50;

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

  /** Total CSS width the spectrum needs for a given viewport width. */
  contentWidth(viewportWidth: number, scale: SpectrumScale): number {
    const semis = this.semitoneSpan(scale);
    return Math.max(viewportWidth, Math.round(semis * scale.pxPerSemitone));
  }

  setScale(scale: SpectrumScale): void {
    this.scale = scale;
    this.staticDirty = true;
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

  /** x position (CSS px) of a frequency, or NaN if out of range. */
  xForFrequency(frequency: number): number {
    if (!this.scale || !(frequency > 0)) return Number.NaN;
    const midi = this.scale.mapper.frequencyToMidi(frequency);
    if (midi < this.lowMidi || midi > this.highMidi) return Number.NaN;
    return (midi - this.lowMidi) * this.px;
  }

  draw(lines: readonly PitchLine[]): void {
    if (!this.scale || this.width < 2) return;
    if (this.staticDirty) this.drawStatic();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.staticLayer, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const scale = this.scale;
    const mapper = scale.mapper;
    const plotTop = HEADER_H;
    const plotBottom = this.height - FOOTER_H;
    const plotH = plotBottom - plotTop;

    // Lines: draw weakest first so strong ones sit on top.
    const order = lines.slice().sort((a, b) => a.intensity - b.intensity);
    const labels: { x: number; line: PitchLine }[] = [];
    for (const line of order) {
      if (line.intensity < 0.01) continue;
      if (line.cls === PeakClass.Noise) continue;
      if (line.cls === PeakClass.Harmonic && !scale.showHarmonics) continue;
      const midi = mapper.frequencyToMidi(line.frequency);
      if (midi < this.lowMidi || midi > this.highMidi) continue;
      const x = (midi - this.lowMidi) * this.px;
      const semitone = mod12(Math.round(midi) - mapper.madhyaSaMidi);
      const k = Math.pow(line.intensity, 0.85);

      let color: string;
      let width: number;
      let alpha: number;
      switch (line.cls) {
        case PeakClass.Fundamental:
          color = swaraColor(semitone, 52 + 14 * k);
          width = 2 + 5 * k;
          alpha = 0.18 + 0.82 * k;
          break;
        case PeakClass.Resonance:
          color = 'hsl(172, 34%, 62%)';
          width = 1.5 + 2.5 * k;
          alpha = 0.12 + 0.6 * k;
          break;
        case PeakClass.Harmonic:
          color = this.colors.gold;
          width = 1 + 2 * k;
          alpha = 0.08 + 0.42 * k;
          break;
        default:
          color = this.colors.muted;
          width = 1 + 1.5 * k;
          alpha = 0.05 + 0.3 * k;
      }

      const h = plotH * (0.18 + 0.82 * k);
      const top = plotBottom - h;
      ctx.globalAlpha = alpha;
      const grad = ctx.createLinearGradient(0, top, 0, plotBottom);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.25, color);
      grad.addColorStop(1, color);
      ctx.strokeStyle = grad;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      if (line.cls === PeakClass.Fundamental && k > 0.35) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 18 * k;
      }
      if (line.cls === PeakClass.Resonance) ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(x, plotBottom);
      ctx.lineTo(x, top);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;

      // Glow on the bottom swara label of a sounding fundamental.
      if (line.cls === PeakClass.Fundamental) {
        ctx.globalAlpha = 0.25 * k;
        ctx.fillStyle = color;
        const cx = (Math.round(midi) - this.lowMidi) * this.px;
        ctx.fillRect(cx - this.px / 2, plotBottom, this.px, FOOTER_H);
      }
      ctx.globalAlpha = 1;

      if (
        (line.cls === PeakClass.Fundamental || line.cls === PeakClass.Resonance) &&
        line.age >= 2 &&
        k > 0.12
      ) {
        labels.push({ x, line });
      }
    }

    this.drawLabels(labels, plotTop);
  }

  // ---------------------------------------------------------------------------

  private semitoneSpan(scale: SpectrumScale): number {
    return (scale.highSaptak - scale.lowSaptak + 1) * 12 + 1;
  }

  private drawLabels(labels: { x: number; line: PitchLine }[], plotTop: number): void {
    if (!this.scale || labels.length === 0) return;
    const ctx = this.ctx;
    const mapper = this.scale.mapper;
    labels.sort((a, b) => b.line.intensity - a.line.intensity);
    const placed: { x0: number; x1: number; row: number }[] = [];
    for (const { x, line } of labels.slice(0, 6)) {
      const reading = mapper.frequencyToSwara(line.frequency);
      if (!reading) continue;
      const resonance = line.cls === PeakClass.Resonance;
      const w = LABEL_W;
      const x0 = Math.min(this.width - w - 4, Math.max(4, x - w / 2));
      let row = 0;
      while (placed.some((p) => p.row === row && !(x0 + w < p.x0 || x0 > p.x1)) && row < 3) row++;
      placed.push({ x0, x1: x0 + w, row });
      const y = plotTop + 8 + row * (LABEL_H + 6);
      const k = Math.pow(line.intensity, 0.85);
      const color = resonance ? 'hsl(172, 34%, 62%)' : swaraColor(reading.swara.semitone, 66);

      ctx.globalAlpha = 0.55 + 0.45 * k;
      ctx.fillStyle = 'rgba(18, 17, 19, 0.86)';
      roundRect(ctx, x0, y, w, LABEL_H, 9);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Swara with komal / tivra / saptak marks.
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `600 20px ${this.displayFont}`;
      const text = reading.swara.short;
      const tx = x0 + 10;
      const ty = y + 22;
      ctx.fillText(text, tx, ty);
      const tw = ctx.measureText(text).width;
      this.drawMarks(ctx, tx, ty, tw, 20, reading.swara.variant, reading.saptak.offset, color);

      ctx.font = `600 11px ${this.uiFont}`;
      ctx.fillStyle = this.colors.text;
      ctx.textAlign = 'right';
      ctx.fillText(reading.western.label, x0 + w - 8, y + 18);

      ctx.textAlign = 'left';
      ctx.fillStyle = this.colors.muted;
      ctx.font = `500 10px ${this.uiFont}`;
      const cents = Math.round(reading.cents);
      const centsText = `${cents > 0 ? '+' : cents < 0 ? '−' : '±'}${Math.abs(cents)}¢`;
      const detail = this.scale.showFrequencyLabels
        ? `${line.frequency.toFixed(1)} Hz ${centsText}`
        : resonance
          ? 'resonance'
          : centsText;
      ctx.fillText(detail, x0 + 10, y + 40);
      ctx.globalAlpha = 1;

      // Connector
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.4 * k;
      ctx.beginPath();
      ctx.moveTo(x, y + LABEL_H);
      ctx.lineTo(x, y + LABEL_H + 8);
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
    const semis = this.semitoneSpan(scale);
    this.lowMidi = mapper.madhyaSaMidi + 12 * scale.lowSaptak - 0.5;
    this.highMidi = this.lowMidi + semis;
    this.px = this.width / semis;

    const ctx = this.staticCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.staticLayer.width, this.staticLayer.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const plotTop = HEADER_H;
    const plotBottom = this.height - FOOTER_H;

    // Saptak bands
    for (let s = scale.lowSaptak; s <= scale.highSaptak; s++) {
      const start = (mapper.madhyaSaMidi + 12 * s - this.lowMidi) * this.px;
      const end = start + 12 * this.px;
      ctx.fillStyle =
        s === 0
          ? 'rgba(201, 164, 92, 0.045)'
          : (s - scale.lowSaptak) % 2 === 0
            ? 'rgba(255,255,255,0.018)'
            : 'rgba(0,0,0,0)';
      ctx.fillRect(start, 0, end - start, this.height);
      ctx.fillStyle = s === 0 ? this.colors.gold : this.colors.faint;
      ctx.font = `600 11px ${this.uiFont}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const name = saptakByOffset(s).name.toUpperCase();
      ctx.save();
      ctx.letterSpacing = '2px';
      ctx.fillText(`${name} SAPTAK`, (start + end) / 2, HEADER_H / 2);
      ctx.restore();
    }

    // Header and footer separators
    ctx.fillStyle = this.colors.line;
    ctx.fillRect(0, plotTop - 0.5, this.width, 1);
    ctx.fillRect(0, plotBottom - 0.5, this.width, 1);

    // Semitone grid and labels
    const firstMidi = Math.ceil(this.lowMidi);
    for (let m = firstMidi; m <= this.highMidi; m++) {
      const x = (m - this.lowMidi) * this.px;
      const semitone = mod12(m - mapper.madhyaSaMidi);
      const swara = swaraBySemitone(semitone);
      const isSa = semitone === 0;
      const isPa = semitone === 7;
      ctx.fillStyle = isSa
        ? 'rgba(201, 164, 92, 0.38)'
        : isPa
          ? 'rgba(236,224,202,0.12)'
          : 'rgba(236,224,202,0.05)';
      ctx.fillRect(Math.round(x) - 0.5, plotTop, 1, plotBottom - plotTop);

      const saptak = Math.floor((m - mapper.madhyaSaMidi) / 12);
      const color = isSa
        ? this.colors.gold
        : swara.variant === 'shuddh' || swara.variant === 'achal'
          ? this.colors.text
          : this.colors.muted;
      const fontSize = this.px < 20 ? 13 : 16;
      ctx.font = `${isSa || isPa ? 700 : 600} ${fontSize}px ${this.displayFont}`;
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
      ctx.fillText(this.px < 16 && !isSa ? west.name : west.label, x, plotBottom + 52);
    }
  }
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
