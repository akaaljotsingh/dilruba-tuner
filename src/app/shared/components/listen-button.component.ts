import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AudioCaptureService } from '../../core/audio/audio-capture.service';
import { IconComponent } from './icon.component';

/** Start / stop the shared microphone engine. Must be a real button: audio starts in its click handler. */
@Component({
  selector: 'app-listen-button',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="btn listen"
      [class.btn-primary]="!on()"
      [class.on]="on()"
      [class.compact]="compact()"
      [disabled]="engine.busy()"
      (click)="toggle()"
      [attr.aria-pressed]="on()"
    >
      <app-icon [name]="on() ? 'stop' : 'mic'" />
      <span>{{ label() }}</span>
    </button>
  `,
  styles: `
    .listen {
      min-width: 168px;
      min-height: 48px;
      font-size: 1rem;
    }
    .listen.compact {
      min-width: 0;
      min-height: 40px;
      padding: 0 14px;
      font-size: 0.88rem;
    }
    .listen.on {
      border-color: var(--accent);
      color: var(--text);
      background: var(--accent-soft);
      animation: pulse-ring 2.4s infinite;
    }
  `,
})
export class ListenButtonComponent {
  protected readonly engine = inject(AudioCaptureService);
  readonly compact = input(false);
  protected readonly on = computed(() => this.engine.status() === 'running');
  protected readonly label = computed(() => {
    switch (this.engine.status()) {
      case 'starting':
        return 'Starting…';
      case 'running':
        return 'Stop Listening';
      case 'paused':
      case 'suspended':
        return 'Resume Listening';
      default:
        return 'Start Listening';
    }
  });

  protected toggle(): void {
    void this.engine.toggle();
  }
}
