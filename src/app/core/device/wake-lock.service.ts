import { DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { AudioCaptureService } from '../audio/audio-capture.service';
import { SettingsStore } from '../state/settings.store';

export type WakeLockState = 'unsupported' | 'off' | 'on' | 'denied';

interface WakeLockSentinelLike extends EventTarget {
  readonly released: boolean;
  release(): Promise<void>;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

function wakeLockApi(): WakeLockLike | null {
  const nav = globalThis.navigator as Navigator & { wakeLock?: WakeLockLike };
  return nav?.wakeLock ?? null;
}

/**
 * Keeps the phone screen on while the tuner is listening, so a player with both
 * hands on the instrument never has to touch the screen to wake it.
 *
 * Uses the Screen Wake Lock API (Chrome / Edge / Samsung Internet on Android,
 * Safari 16.4+ on iOS – including Home-Screen apps on iOS 18.4+). Browsers
 * release the lock whenever the page is hidden, so it is re-acquired when the
 * page becomes visible again. Nothing happens when the API is unavailable.
 */
@Injectable({ providedIn: 'root' })
export class WakeLockService {
  private readonly engine = inject(AudioCaptureService);
  private readonly settings = inject(SettingsStore);

  readonly state = signal<WakeLockState>(wakeLockApi() ? 'off' : 'unsupported');
  private sentinel: WakeLockSentinelLike | null = null;
  private wanted = false;
  private pending: Promise<void> | null = null;

  constructor() {
    effect(() => {
      const status = this.engine.status();
      this.wanted =
        (status === 'running' || status === 'starting') && this.settings.settings().keepScreenOn;
      void (this.wanted ? this.acquire() : this.release());
    });

    const onVisible = () => {
      if (document.visibilityState === 'visible' && this.wanted) void this.acquire();
    };
    // Some browsers only grant the lock during a user gesture: retry on the next tap.
    const onTap = () => {
      if (this.wanted && this.state() !== 'on') void this.acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('pointerup', onTap, { passive: true, capture: true });
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('pointerup', onTap, { capture: true });
      void this.release();
    });
  }

  /**
   * Call synchronously from the Start tap: browsers that only grant the lock during
   * a user gesture then grant it straight away.
   */
  prime(): void {
    if (!this.settings.settings().keepScreenOn) return;
    this.wanted = true;
    void this.acquire();
  }

  private async acquire(): Promise<void> {
    const api = wakeLockApi();
    if (!api || (this.sentinel && !this.sentinel.released)) return;
    if (document.visibilityState !== 'visible') return;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const sentinel = await api.request('screen');
        if (!this.wanted) {
          await sentinel.release();
          return;
        }
        this.sentinel = sentinel;
        this.state.set('on');
        sentinel.addEventListener('release', () => {
          if (this.sentinel === sentinel) {
            this.sentinel = null;
            this.state.set('off');
          }
        });
      } catch {
        // e.g. battery saver, or a permissions policy blocking it.
        this.state.set('denied');
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }

  private async release(): Promise<void> {
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (this.state() === 'on') this.state.set('off');
    if (sentinel && !sentinel.released) {
      try {
        await sentinel.release();
      } catch {
        /* already released */
      }
    }
  }
}

/** Short haptic pulse where supported (Android). iOS Safari ignores it. */
export function vibrate(pattern: number | number[]): void {
  try {
    (globalThis.navigator as Navigator | undefined)?.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}
