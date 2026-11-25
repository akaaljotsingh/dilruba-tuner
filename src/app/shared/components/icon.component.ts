import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type IconName =
  | 'home'
  | 'tuner'
  | 'spectrum'
  | 'strings'
  | 'settings'
  | 'mic'
  | 'mic-off'
  | 'stop'
  | 'offline'
  | 'download'
  | 'check'
  | 'info'
  | 'plus'
  | 'minus'
  | 'volume'
  | 'chevron-right'
  | 'refresh'
  | 'close'
  | 'zoom-in'
  | 'zoom-out'
  | 'share'
  | 'follow'
  | 'expand'
  | 'collapse';

const PATHS: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  tuner: 'M4 16a8 8 0 1 1 16 0M12 16l4-6M2 16h2m16 0h2M12 6V4',
  spectrum: 'M4 20V10m4 10V4m4 16v-7m4 7V7m4 13v-4',
  strings: 'M6 3v18M10 3v18M14 3v18M18 3v18M4 7h16',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  'mic-off':
    'M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 4.6 2.5M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.4 2.3M12 18v3M3 3l18 18',
  stop: 'M7 7h10v10H7z',
  offline:
    'M2 8.5a15 15 0 0 1 5-3M22 8.5A15 15 0 0 0 10 4.3M5.5 12a10 10 0 0 1 4-2.4M18.5 12a10 10 0 0 0-2.1-1.6M9 15.5a5 5 0 0 1 6 0M12 19h.01M3 3l18 18',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  check: 'M5 12.5 10 17l9-10',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  volume: 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  'chevron-right': 'M9 5l7 7-7 7',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  close: 'M6 6l12 12M18 6 6 18',
  'zoom-in': 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M11 8v6M8 11h6',
  'zoom-out': 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M8 11h6',
  share: 'M12 15V3m0 0L8 7m4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  collapse: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  follow:
    'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3',
};

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path [attr.d]="path()" />
  </svg>`,
  styles: `
    :host {
      display: inline-flex;
      line-height: 0;
    }
    svg {
      width: var(--icon-size, 22px);
      height: var(--icon-size, 22px);
    }
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  protected readonly path = computed(() => PATHS[this.name()]);
}
