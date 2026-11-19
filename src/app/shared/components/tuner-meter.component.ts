import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { TuningStatus, TuningTolerances } from '../../core/models/tuning-result.model';

const RANGE_CENTS = 50;

/**
 * Horizontal cents meter. The needle is animated with a critically-damped
 * spring in requestAnimationFrame, writing a CSS transform directly so that
 * smooth 60 fps motion costs no Angular change detection.
 */
@Component({
  selector: 'app-tuner-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-status]': 'active() ? status() : "idle"',
    role: 'meter',
    '[attr.aria-valuemin]': '-50',
    '[attr.aria-valuemax]': '50',
    '[attr.aria-valuenow]': 'ariaValue()',
    '[attr.aria-valuetext]': 'ariaText()',
    'aria-label': 'Tuning deviation in cents',
  },
  template: `
    <div class="labels" aria-hidden="true">
      <span>♭ Flat</span>
      <span class="center-label">In tune</span>
      <span>Sharp ♯</span>
    </div>
    <div class="track" aria-hidden="true">
      <div class="band ok" [style.left.%]="50 - okPct()" [style.width.%]="okPct() * 2"></div>
      <div
        class="band perfect"
        [style.left.%]="50 - perfectPct()"
        [style.width.%]="perfectPct() * 2"
      ></div>
      @for (t of ticks; track t.v) {
        <span class="tick" [class.major]="t.major" [style.left.%]="t.pos"></span>
      }
      <div class="rail" #rail>
        <div class="needle"><span class="head"></span></div>
      </div>
      <span class="peg left" [class.show]="pegged() < 0">‹</span>
      <span class="peg right" [class.show]="pegged() > 0">›</span>
    </div>
    <div class="scale" aria-hidden="true">
      @for (t of labels; track t.v) {
        <span [style.left.%]="t.pos">{{ t.label }}</span>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      --needle: var(--text-faint);
      user-select: none;
    }
    :host([data-status='in-tune']) {
      --needle: var(--in-tune);
    }
    :host([data-status='slightly-flat']),
    :host([data-status='slightly-sharp']) {
      --needle: var(--near);
    }
    :host([data-status='flat']),
    :host([data-status='sharp']),
    :host([data-status='very-flat']),
    :host([data-status='very-sharp']) {
      --needle: var(--off);
    }
    .labels {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-faint);
      margin-bottom: 10px;
    }
    .center-label {
      color: var(--in-tune);
      opacity: 0.8;
    }
    .track {
      position: relative;
      height: 92px;
      border-radius: var(--radius);
      overflow: hidden;
      background: linear-gradient(180deg, var(--surface-2), var(--surface));
      border: 1px solid var(--line);
    }
    .band {
      position: absolute;
      top: 0;
      bottom: 0;
    }
    .band.ok {
      background: rgba(216, 194, 106, 0.08);
    }
    .band.perfect {
      background: var(--in-tune-soft);
      box-shadow:
        inset 1px 0 0 rgba(143, 200, 154, 0.35),
        inset -1px 0 0 rgba(143, 200, 154, 0.35);
    }
    .tick {
      position: absolute;
      bottom: 0;
      width: 1px;
      height: 14px;
      background: var(--line-strong);
      transform: translateX(-0.5px);
    }
    .tick.major {
      height: 26px;
      background: var(--text-faint);
    }
    .rail {
      position: absolute;
      inset: 0;
      will-change: transform;
    }
    .needle {
      position: absolute;
      left: 0;
      top: 8px;
      bottom: 8px;
      width: 4px;
      margin-left: -2px;
      border-radius: 2px;
      background: var(--needle);
      box-shadow: 0 0 18px var(--needle);
      transition:
        background var(--dur) var(--ease),
        opacity var(--dur);
    }
    :host([data-status='idle']) .needle {
      opacity: 0.35;
      box-shadow: none;
    }
    .head {
      position: absolute;
      top: -6px;
      left: 50%;
      width: 12px;
      height: 12px;
      margin-left: -6px;
      border-radius: 50%;
      background: var(--needle);
    }
    .peg {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      font-size: 2rem;
      color: var(--off);
      opacity: 0;
      transition: opacity var(--dur);
      padding: 0 8px;
    }
    .peg.left {
      left: 0;
    }
    .peg.right {
      right: 0;
    }
    .peg.show {
      opacity: 1;
      animation: breathe 1s infinite;
    }
    .scale {
      position: relative;
      height: 22px;
      margin-top: 6px;
      font-size: 0.72rem;
      color: var(--text-faint);
      font-variant-numeric: tabular-nums;
    }
    .scale span {
      position: absolute;
      transform: translateX(-50%);
    }
    .scale span:first-child {
      transform: none;
    }
    .scale span:last-child {
      transform: translateX(-100%);
    }
  `,
})
export class TunerMeterComponent {
  /** Deviation in cents, or null when no reading. */
  readonly cents = input<number | null>(null);
  readonly active = input(false);
  readonly status = input<TuningStatus>('in-tune');
  readonly tolerances = input<TuningTolerances>({ perfectCents: 3, acceptableCents: 10 });
  readonly reduceMotion = input(false);

  private readonly rail = viewChild.required<ElementRef<HTMLElement>>('rail');

  protected readonly ticks = Array.from({ length: 21 }, (_, i) => {
    const v = -RANGE_CENTS + i * 5;
    return { v, major: v % 25 === 0, pos: ((v + RANGE_CENTS) / (2 * RANGE_CENTS)) * 100 };
  });
  protected readonly labels = [-50, -25, 0, 25, 50].map((v) => ({
    v,
    label: v > 0 ? `+${v}` : `${v}`,
    pos: ((v + RANGE_CENTS) / (2 * RANGE_CENTS)) * 100,
  }));
  protected readonly perfectPct = computed(
    () => (Math.min(this.tolerances().perfectCents, RANGE_CENTS) / (2 * RANGE_CENTS)) * 100,
  );
  protected readonly okPct = computed(
    () => (Math.min(this.tolerances().acceptableCents, RANGE_CENTS) / (2 * RANGE_CENTS)) * 100,
  );
  protected readonly pegged = computed(() => {
    const c = this.cents();
    if (!this.active() || c === null) return 0;
    return c > RANGE_CENTS ? 1 : c < -RANGE_CENTS ? -1 : 0;
  });
  protected readonly ariaValue = computed(() => {
    const c = this.cents();
    return c === null || !this.active() ? null : Math.round(Math.max(-50, Math.min(50, c)));
  });
  protected readonly ariaText = computed(() => {
    const c = this.cents();
    if (c === null || !this.active()) return 'No reading';
    const r = Math.round(c);
    return r === 0 ? 'In tune' : `${Math.abs(r)} cents ${r < 0 ? 'flat' : 'sharp'}`;
  });

  // Spring state (not signals – updated every animation frame).
  private target = 0;
  private position = 0;
  private velocity = 0;
  private frame = 0;
  private lastTime = 0;
  private rendered = false;

  constructor() {
    effect(() => {
      const c = this.cents();
      const active = this.active();
      this.target =
        active && c !== null && Number.isFinite(c)
          ? Math.max(-RANGE_CENTS, Math.min(RANGE_CENTS, c))
          : 0;
      this.kick();
    });
    afterNextRender(() => {
      this.rendered = true;
      this.apply();
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.frame));
  }

  private kick(): void {
    if (!this.rendered || this.frame) return;
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    this.frame = 0;
    // Elapsed real time; if frames were throttled (slow device, background) we still catch up.
    let remaining = Math.min(1, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    if (this.reduceMotion() || remaining >= 1) {
      this.position = this.target;
      this.velocity = 0;
    } else {
      // Critically damped spring, ω ≈ 18 rad/s → ~0.2 s settle without overshoot.
      // Fixed sub-steps keep the integration stable regardless of frame rate.
      const omega = 18;
      while (remaining > 0) {
        const dt = Math.min(remaining, 1 / 240);
        remaining -= dt;
        const accel = omega * omega * (this.target - this.position) - 2 * omega * this.velocity;
        this.velocity += accel * dt;
        this.position += this.velocity * dt;
      }
    }
    this.apply();
    if (Math.abs(this.target - this.position) > 0.02 || Math.abs(this.velocity) > 0.05) {
      this.frame = requestAnimationFrame(this.tick);
    }
  };

  private apply(): void {
    const pct = ((this.position + RANGE_CENTS) / (2 * RANGE_CENTS)) * 100;
    this.rail().nativeElement.style.transform = `translateX(${pct.toFixed(3)}%)`;
  }
}
