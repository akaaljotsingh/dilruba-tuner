import { Injectable, signal } from '@angular/core';
import { audioContextConstructor } from './microphone-permission.service';

/** 'interrupted' is Safari-specific (phone calls, Siri, other apps taking audio). */
export type ContextState = AudioContextState | 'interrupted' | 'none';

/**
 * Owns the lifetime of the single AudioContext used for analysis.
 *
 * iOS Safari only lets an AudioContext start inside a user gesture, so
 * {@link create} must be called synchronously from a click / tap handler
 * (before any `await`). We never create a context on page load.
 */
@Injectable({ providedIn: 'root' })
export class AudioContextService {
  readonly state = signal<ContextState>('none');
  private ctx: AudioContext | null = null;
  private readonly onStateChange = () => {
    if (this.ctx) this.state.set(this.ctx.state as ContextState);
  };

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Creates (or reuses) the context and kicks off resume() within the current user gesture. */
  create(): AudioContext {
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.resume().catch(() => undefined);
      return this.ctx;
    }
    const Ctor = audioContextConstructor();
    if (!Ctor) throw new Error('AudioContext unavailable');
    const ctx = new Ctor({ latencyHint: 'interactive' });
    ctx.addEventListener('statechange', this.onStateChange);
    this.ctx = ctx;
    this.state.set(ctx.state as ContextState);
    // Must be called synchronously inside the gesture on iOS.
    void ctx.resume().catch(() => undefined);
    return ctx;
  }

  async resume(): Promise<boolean> {
    if (!this.ctx || this.ctx.state === 'closed') return false;
    try {
      await this.ctx.resume();
    } catch {
      return false;
    }
    this.onStateChange();
    return this.ctx.state === 'running';
  }

  async suspend(): Promise<void> {
    if (this.ctx && this.ctx.state === 'running') {
      try {
        await this.ctx.suspend();
      } catch {
        /* ignore */
      }
      this.onStateChange();
    }
  }

  async close(): Promise<void> {
    const ctx = this.ctx;
    this.ctx = null;
    this.state.set('none');
    if (!ctx) return;
    ctx.removeEventListener('statechange', this.onStateChange);
    if (ctx.state !== 'closed') {
      try {
        await ctx.close();
      } catch {
        /* ignore */
      }
    }
  }
}
