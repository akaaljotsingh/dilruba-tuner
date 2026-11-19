import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SwaraDefinition, SwaraId, swaraById } from '../../core/models/swara.model';

/**
 * Renders a swara with Bhatkhande-style marks:
 * komal → line below, tivra → stroke above, mandra → dot(s) below, taar → dot(s) above.
 * `mode="full"` shows the full name (e.g. "Komal Re"), `mode="short"` the compact syllable.
 */
@Component({
  selector: 'app-swara-label',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.aria-label]': 'ariaLabel()',
    role: 'text',
  },
  template: `
    <span
      class="sw"
      [class.komal]="def().variant === 'komal'"
      [class.tivra]="def().variant === 'tivra'"
      aria-hidden="true"
    >
      @if (above() > 0) {
        <span class="dots above">
          @for (d of dotsAbove(); track $index) {
            <i></i>
          }
        </span>
      }
      <span class="txt">{{ mode() === 'full' ? def().name : def().short }}</span>
      @if (below() > 0) {
        <span class="dots below">
          @for (d of dotsBelow(); track $index) {
            <i></i>
          }
        </span>
      }
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .sw {
      position: relative;
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      line-height: 1;
    }
    .txt {
      position: relative;
      white-space: nowrap;
    }
    .komal .txt {
      text-decoration: underline;
      text-decoration-thickness: max(1px, 0.06em);
      text-underline-offset: 0.16em;
    }
    .tivra .txt::before {
      content: '';
      position: absolute;
      left: 50%;
      top: -0.32em;
      width: max(1px, 0.06em);
      height: 0.26em;
      background: currentColor;
      transform: translateX(-50%);
    }
    .dots {
      display: flex;
      gap: 0.12em;
      height: 0;
      position: relative;
    }
    .dots i {
      width: 0.16em;
      height: 0.16em;
      min-width: 3px;
      min-height: 3px;
      border-radius: 50%;
      background: currentColor;
      display: block;
    }
    .dots.above i {
      transform: translateY(-0.2em);
    }
    .tivra .dots.above i {
      transform: translateY(-0.44em);
    }
    .dots.below i {
      transform: translateY(0.12em);
    }
    .komal .dots.below i {
      transform: translateY(0.26em);
    }
  `,
})
export class SwaraLabelComponent {
  readonly swara = input.required<SwaraDefinition | SwaraId>();
  /** Saptak offset relative to Madhya; null hides octave marks. */
  readonly saptak = input<number | null>(null);
  readonly mode = input<'full' | 'short'>('full');

  protected readonly def = computed(() => {
    const s = this.swara();
    return typeof s === 'string' ? swaraById(s) : s;
  });
  protected readonly above = computed(() => Math.max(0, this.saptak() ?? 0));
  protected readonly below = computed(() => Math.max(0, -(this.saptak() ?? 0)));
  protected readonly dotsAbove = computed(() => Array.from({ length: Math.min(3, this.above()) }));
  protected readonly dotsBelow = computed(() => Array.from({ length: Math.min(3, this.below()) }));
  protected readonly ariaLabel = computed(() => {
    const s = this.saptak();
    const register =
      s === null
        ? ''
        : s === 0
          ? ', Madhya'
          : s < 0
            ? s === -1
              ? ', Mandra'
              : ', Ati-mandra'
            : s === 1
              ? ', Taar'
              : ', Ati-taar';
    return `${this.def().name}${register}`;
  });
}
