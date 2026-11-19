import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { AudioErrorCode } from './audio-errors';

export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface AudioSupport {
  readonly supported: boolean;
  readonly secureContext: boolean;
  readonly getUserMedia: boolean;
  readonly audioWorklet: boolean;
  readonly reason: AudioErrorCode | null;
}

type AudioContextCtor = typeof AudioContext;

export function audioContextConstructor(): AudioContextCtor | null {
  const w = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function detectAudioSupport(): AudioSupport {
  const secureContext = globalThis.isSecureContext !== false;
  const getUserMedia = !!globalThis.navigator?.mediaDevices?.getUserMedia;
  const ctor = audioContextConstructor();
  const audioWorklet =
    !!ctor && 'audioWorklet' in ctor.prototype && typeof AudioWorkletNode !== 'undefined';
  let reason: AudioErrorCode | null = null;
  if (!secureContext) reason = 'insecure-context';
  else if (!getUserMedia || !audioWorklet) reason = 'unsupported';
  return { supported: reason === null, secureContext, getUserMedia, audioWorklet, reason };
}

/** Reports microphone support and permission state without prompting the user. */
@Injectable({ providedIn: 'root' })
export class MicrophonePermissionService {
  readonly support = signal<AudioSupport>(detectAudioSupport());
  readonly permission = signal<PermissionStatus>('unknown');

  constructor() {
    const destroyRef = inject(DestroyRef);
    void this.watch(destroyRef);
  }

  /** Call after a successful or failed getUserMedia to refresh the state. */
  async refresh(): Promise<void> {
    try {
      const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
      if (status) this.permission.set(status.state as PermissionStatus);
    } catch {
      // Firefox / older Safari do not support querying 'microphone'.
    }
  }

  markGranted(): void {
    this.permission.set('granted');
  }

  markDenied(): void {
    this.permission.set('denied');
  }

  private async watch(destroyRef: DestroyRef): Promise<void> {
    try {
      const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
      if (!status) return;
      this.permission.set(status.state as PermissionStatus);
      const onChange = () => this.permission.set(status.state as PermissionStatus);
      status.addEventListener('change', onChange);
      destroyRef.onDestroy(() => status.removeEventListener('change', onChange));
    } catch {
      this.permission.set('unknown');
    }
  }
}
