import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallPlatform = 'prompt' | 'ios' | 'installed' | 'manual';

/** Online/offline state, install prompt and service-worker update notifications. */
@Injectable({ providedIn: 'root' })
export class PwaService {
  private readonly swUpdate = inject(SwUpdate, { optional: true });
  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly installPlatform = signal<InstallPlatform>(this.detectPlatform());
  readonly updateReady = signal(false);
  readonly offlineReady = signal(false);
  readonly serviceWorkerEnabled = !!this.swUpdate?.isEnabled;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const onOnline = () => this.online.set(true);
    const onOffline = () => this.online.set(false);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.installPlatform.set('prompt');
    };
    const onInstalled = () => {
      this.deferredPrompt = null;
      this.installPlatform.set('installed');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    destroyRef.onDestroy(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    });

    if (this.swUpdate?.isEnabled) {
      const sub = this.swUpdate.versionUpdates.subscribe((evt) => {
        if (evt.type === 'VERSION_READY') this.updateReady.set(true);
        if (evt.type === 'NO_NEW_VERSION_DETECTED' || evt.type === 'VERSION_READY')
          this.offlineReady.set(true);
      });
      destroyRef.onDestroy(() => sub.unsubscribe());
      void navigator.serviceWorker?.ready.then(() => this.offlineReady.set(true));
    }
  }

  get canPrompt(): boolean {
    return this.deferredPrompt !== null;
  }

  async promptInstall(): Promise<boolean> {
    const evt = this.deferredPrompt;
    if (!evt) return false;
    await evt.prompt();
    const choice = await evt.userChoice;
    this.deferredPrompt = null;
    if (choice.outcome === 'accepted') this.installPlatform.set('installed');
    else this.installPlatform.set(this.detectPlatform());
    return choice.outcome === 'accepted';
  }

  async applyUpdate(): Promise<void> {
    try {
      await this.swUpdate?.activateUpdate();
    } finally {
      document.location.reload();
    }
  }

  private detectPlatform(): InstallPlatform {
    if (typeof window === 'undefined') return 'manual';
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return 'installed';
    const ua = navigator.userAgent;
    const iOS =
      /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
    return iOS ? 'ios' : 'manual';
  }
}
