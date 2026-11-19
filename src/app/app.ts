import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { SettingsStore } from './core/state/settings.store';
import { MainLayoutComponent } from './layout/main-layout/main-layout.component';

@Component({
  selector: 'app-root',
  imports: [MainLayoutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-main-layout />`,
})
export class App {
  constructor() {
    const settings = inject(SettingsStore);
    // Apply appearance preferences to the document root.
    effect(() => {
      const s = settings.settings();
      const root = document.documentElement;
      root.dataset['theme'] = s.theme;
      root.dataset['accent'] = s.accent;
      root.dataset['textScale'] = s.textScale;
      root.dataset['reduceMotion'] = String(s.reduceMotion);
      const meta = document.querySelector('meta[name="theme-color"]');
      meta?.setAttribute('content', s.theme === 'midnight' ? '#050505' : '#121113');
    });
  }
}
