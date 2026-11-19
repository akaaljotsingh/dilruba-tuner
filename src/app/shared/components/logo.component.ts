import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Mark: a ring of twelve swara points (the chromatic saptak) with Sa
 * highlighted, crossed by a single resonating wire.
 */
@Component({
  selector: 'app-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 64 64" [attr.width]="size()" [attr.height]="size()" aria-hidden="true">
      <circle
        cx="32"
        cy="32"
        r="29"
        fill="none"
        stroke="var(--gold)"
        stroke-width="1.6"
        opacity="0.9"
      />
      @for (p of points; track $index) {
        <circle
          [attr.cx]="p.x"
          [attr.cy]="p.y"
          [attr.r]="$index === 0 ? 3.2 : 1.6"
          [attr.fill]="$index === 0 ? 'var(--accent)' : 'var(--gold)'"
          [attr.opacity]="$index === 0 ? 1 : 0.75"
        />
      }
      <path
        d="M32 9 C 29.5 22, 34.5 42, 32 55"
        fill="none"
        stroke="var(--text)"
        stroke-width="1.4"
        stroke-linecap="round"
      />
      <circle cx="32" cy="32" r="5.5" fill="none" stroke="var(--accent)" stroke-width="1.4" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
  `,
})
export class LogoComponent {
  readonly size = input(36);
  protected readonly points = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    return { x: +(32 + 21 * Math.cos(a)).toFixed(2), y: +(32 + 21 * Math.sin(a)).toFixed(2) };
  });
}
