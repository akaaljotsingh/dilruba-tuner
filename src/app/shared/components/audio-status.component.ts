import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AudioCaptureService } from '../../core/audio/audio-capture.service';
import { MicrophonePermissionService } from '../../core/audio/microphone-permission.service';
import { WakeLockService } from '../../core/device/wake-lock.service';
import { IconComponent } from './icon.component';

/** Microphone readiness line plus an error / interruption banner when needed. */
@Component({
  selector: 'app-audio-status',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="status"
      [class.compact]="compact()"
      [attr.data-tone]="tone()"
      role="status"
      aria-live="polite"
    >
      <span class="dot"></span>
      <span>{{ text() }}</span>
    </div>
    @if (engine.error(); as err) {
      <div class="banner" role="alert">
        <app-icon name="info" />
        <div>
          <strong>{{ err.title }}</strong>
          <p>{{ err.message }}</p>
        </div>
        <button type="button" class="icon-btn" aria-label="Dismiss" (click)="engine.dismissError()">
          <app-icon name="close" />
        </button>
      </div>
    } @else if (engine.status() === 'suspended') {
      <div class="banner soft" role="alert">
        <app-icon name="info" />
        <div>
          <strong>Audio paused by the device</strong>
          <p>Another app or a call interrupted audio. Tap Resume Listening to continue.</p>
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: 12px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .status.compact {
      font-size: 0.78rem;
      white-space: nowrap;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-faint);
      flex: none;
    }
    [data-tone='live'] .dot {
      background: var(--in-tune);
      box-shadow: 0 0 0 4px var(--in-tune-soft);
      animation: breathe 2s infinite;
    }
    [data-tone='warn'] .dot {
      background: var(--near);
    }
    [data-tone='error'] .dot {
      background: var(--danger);
    }
    .banner {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 12px;
      align-items: start;
      padding: 14px 14px 14px 16px;
      border-radius: var(--radius);
      border: 1px solid rgba(226, 103, 90, 0.35);
      background: rgba(226, 103, 90, 0.08);
      color: var(--text);
      app-icon {
        color: var(--danger);
        margin-top: 2px;
      }
      strong {
        display: block;
        font-weight: 600;
      }
      p {
        margin: 2px 0 0;
        color: var(--text-muted);
        font-size: 0.88rem;
      }
      .icon-btn {
        width: 36px;
        height: 36px;
        margin: -6px -6px 0 0;
      }
    }
    .banner.soft {
      border-color: rgba(216, 194, 106, 0.3);
      background: rgba(216, 194, 106, 0.07);
      grid-template-columns: auto 1fr;
      app-icon {
        color: var(--near);
      }
    }
  `,
})
export class AudioStatusComponent {
  protected readonly engine = inject(AudioCaptureService);
  private readonly permissions = inject(MicrophonePermissionService);
  private readonly wakeLock = inject(WakeLockService);
  /** Short labels for tight phone top bars. */
  readonly compact = input(false);

  protected readonly tone = computed(() => {
    const s = this.engine.status();
    if (s === 'running') return 'live';
    if (s === 'error') return 'error';
    if (s === 'paused' || s === 'suspended' || !this.permissions.support().supported) return 'warn';
    return 'idle';
  });

  protected readonly text = computed(() => {
    const support = this.permissions.support();
    if (!support.supported) {
      return support.reason === 'insecure-context'
        ? 'Microphone needs HTTPS'
        : 'Microphone not supported in this browser';
    }
    switch (this.engine.status()) {
      case 'running': {
        const screen = this.wakeLock.state() === 'on' ? ' · screen stays on' : '';
        return this.compact()
          ? `Listening${screen}`
          : `Listening${screen} · audio stays on this device`;
      }
      case 'starting':
        return 'Starting microphone…';
      case 'paused':
        return this.compact() ? 'Paused' : 'Paused while in background';
      case 'suspended':
        return 'Audio interrupted';
      case 'error':
        return 'Microphone unavailable';
      default:
        switch (this.permissions.permission()) {
          case 'granted':
            return 'Microphone ready';
          case 'denied':
            return this.compact() ? 'Mic blocked' : 'Microphone blocked in browser settings';
          default:
            return this.compact() ? 'Mic off' : 'Microphone permission will be requested';
        }
    }
  });
}
