import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { SettingsStore } from '../state/settings.store';
import {
  ANALYSIS_PROCESSOR_NAME,
  ANALYSIS_WORKLET_URL,
  AnalysisConfig,
  AnalysisFrameMessage,
  MainToWorkletMessage,
  WorkletToMainMessage,
} from './analysis-protocol';
import { AudioContextService } from './audio-context.service';
import { AudioError, audioError, classifyMediaError } from './audio-errors';
import { MicrophonePermissionService } from './microphone-permission.service';

export type EngineStatus = 'idle' | 'starting' | 'running' | 'paused' | 'suspended' | 'error';

export interface LivePitch {
  readonly frequency: number;
  readonly confidence: number;
  readonly active: boolean;
  readonly stable: boolean;
  readonly held: boolean;
  readonly levelDb: number;
  readonly gateOpen: boolean;
}

export interface EngineInfo {
  readonly sampleRate: number;
  readonly pitchWindow: number;
  readonly fftSize: number;
  readonly hopSize: number;
  readonly deviceLabel: string;
  /** Actual track settings reported by the browser – requested constraints are not guaranteed. */
  readonly trackSettings: {
    readonly echoCancellation?: boolean | string;
    readonly noiseSuppression?: boolean;
    readonly autoGainControl?: boolean;
    readonly sampleRate?: number;
    readonly channelCount?: number;
  };
}

const SILENT_PITCH: LivePitch = {
  frequency: 0,
  confidence: 0,
  active: false,
  stable: false,
  held: false,
  levelDb: -120,
  gateOpen: false,
};

/** Text readouts don't need more than ~25 updates per second. */
const PUBLISH_INTERVAL_MS = 40;

export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
  video: false,
};

/**
 * The shared audio engine used by both the Wire Tuner and the Sur Spectrum.
 *
 * mic → MediaStreamSource → AudioWorkletNode (all DSP) → muted gain → destination
 *
 * Audio never leaves the device: nothing is recorded, stored or sent anywhere.
 * The main thread receives ~50 compact analysis frames per second; Angular
 * signals are updated at a throttled rate, and canvas renderers subscribe
 * directly via {@link onFrame} without touching change detection.
 */
@Injectable({ providedIn: 'root' })
export class AudioCaptureService {
  private readonly contextService = inject(AudioContextService);
  private readonly permissions = inject(MicrophonePermissionService);
  private readonly settings = inject(SettingsStore);

  readonly status = signal<EngineStatus>('idle');
  readonly error = signal<AudioError | null>(null);
  readonly info = signal<EngineInfo | null>(null);
  readonly pitch = signal<LivePitch>(SILENT_PITCH);
  readonly listening = computed(() => this.status() === 'running');
  readonly busy = computed(() => this.status() === 'starting');

  /** Latest frame, readable at any time without subscribing (e.g. inside rAF). */
  latestFrame: AnalysisFrameMessage | null = null;

  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private workletContext: BaseAudioContext | null = null;
  private readonly frameListeners = new Set<(frame: AnalysisFrameMessage) => void>();
  private readonly spectrumUsers = signal(0);
  private startGeneration = 0;
  private lastPublish = 0;
  private lastActive = false;
  private lastStable = false;
  private pausedByVisibility = false;

  private readonly analysisConfig = computed<AnalysisConfig>(() => {
    const s = this.settings.settings();
    return {
      minFrequency: s.minFrequency,
      maxFrequency: s.maxFrequency,
      sensitivity: s.sensitivity,
      noiseFilter: s.noiseFilter,
      spectrumEnabled: this.spectrumUsers() > 0,
      spectrumMaxFrequency: Math.max(2500, Math.min(6000, s.maxFrequency * 4)),
      a4: s.a4,
    };
  });

  constructor() {
    effect(() => this.post({ type: 'configure', config: this.analysisConfig() }));

    // Follow external context state changes (iOS interruptions, OS audio focus).
    effect(() => {
      const state = this.contextService.state();
      const status = this.status();
      if (
        status === 'running' &&
        (state === 'suspended' || state === 'interrupted') &&
        !this.pausedByVisibility
      ) {
        this.status.set('suspended');
      } else if (status === 'suspended' && state === 'running') {
        this.status.set('running');
      }
    });

    const onVisibility = () => void this.handleVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    const onPageHide = () => void this.stop();
    window.addEventListener('pagehide', onPageHide);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      void this.stop();
    });
  }

  /** Subscribe to every analysis frame (for canvas rendering). Returns an unsubscribe function. */
  onFrame(listener: (frame: AnalysisFrameMessage) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  /** Declares that a view needs spectral peaks. Returns a release function. */
  useSpectrum(): () => void {
    this.spectrumUsers.update((n) => n + 1);
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.spectrumUsers.update((n) => Math.max(0, n - 1));
      }
    };
  }

  toggle(): Promise<void> {
    return this.status() === 'running' || this.status() === 'starting' ? this.stop() : this.start();
  }

  /**
   * Starts listening. MUST be invoked from a user gesture (click/tap) – the
   * AudioContext is created synchronously before the first await for iOS.
   */
  async start(): Promise<void> {
    const status = this.status();
    if (status === 'running' || status === 'starting') return;
    if (status === 'paused' || status === 'suspended') {
      if (await this.contextService.resume()) {
        this.pausedByVisibility = false;
        this.status.set('running');
        return;
      }
    }

    const support = this.permissions.support();
    if (!support.supported) {
      this.fail(audioError(support.reason ?? 'unsupported'));
      return;
    }

    const generation = ++this.startGeneration;
    this.error.set(null);
    this.status.set('starting');

    let ctx: AudioContext;
    try {
      ctx = this.contextService.create();
    } catch {
      this.fail(audioError('audio-context'));
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch (e) {
      if (generation !== this.startGeneration) return;
      const err = classifyMediaError(e);
      if (err.code === 'permission-denied') this.permissions.markDenied();
      await this.teardown(true);
      this.fail(err);
      return;
    }
    if (generation !== this.startGeneration) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.permissions.markGranted();
    this.stream = stream;

    try {
      if (this.workletContext !== ctx) {
        await ctx.audioWorklet.addModule(ANALYSIS_WORKLET_URL);
        this.workletContext = ctx;
      }
    } catch {
      if (generation !== this.startGeneration) return;
      await this.teardown(true);
      this.fail(audioError('worklet-load'));
      return;
    }
    if (generation !== this.startGeneration) return;

    try {
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('no audio track');
      track.addEventListener('ended', this.onTrackEnded);

      this.source = ctx.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(ctx, ANALYSIS_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      this.node.port.onmessage = this.onMessage;
      this.node.onprocessorerror = () => {
        void this.teardown(true).then(() => this.fail(audioError('audio-context')));
      };
      // Some browsers only pull a node that reaches the destination; route it through silence.
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;
      this.source.connect(this.node);
      this.node.connect(this.sink);
      this.sink.connect(ctx.destination);
      this.post({ type: 'configure', config: this.analysisConfig() });

      const s = track.getSettings?.() ?? {};
      this.info.set({
        sampleRate: ctx.sampleRate,
        pitchWindow: 0,
        fftSize: 0,
        hopSize: 0,
        deviceLabel: track.label || 'Microphone',
        trackSettings: {
          echoCancellation: s.echoCancellation,
          noiseSuppression: s.noiseSuppression,
          autoGainControl: s.autoGainControl,
          sampleRate: s.sampleRate,
          channelCount: s.channelCount,
        },
      });

      const running = ctx.state === 'running' || (await this.contextService.resume());
      if (generation !== this.startGeneration) return;
      this.status.set(running ? 'running' : 'suspended');
    } catch {
      await this.teardown(true);
      this.fail(audioError('audio-context'));
    }
  }

  /** Stops listening and releases the microphone and AudioContext. */
  async stop(): Promise<void> {
    this.startGeneration++;
    this.pausedByVisibility = false;
    await this.teardown(true);
    if (this.status() !== 'error') this.status.set('idle');
  }

  dismissError(): void {
    this.error.set(null);
    if (this.status() === 'error') this.status.set('idle');
  }

  private readonly onTrackEnded = () => {
    void this.teardown(true).then(() => this.fail(audioError('stream-ended')));
  };

  private readonly onMessage = (event: MessageEvent<WorkletToMainMessage>) => {
    const msg = event.data;
    if (msg.type === 'ready') {
      const info = this.info();
      this.info.set({
        ...(info ?? { deviceLabel: 'Microphone', trackSettings: {} }),
        sampleRate: msg.sampleRate,
        pitchWindow: msg.pitchWindow,
        fftSize: msg.fftSize,
        hopSize: msg.hopSize,
      });
      return;
    }
    this.latestFrame = msg;
    for (const listener of this.frameListeners) listener(msg);

    const now = performance.now();
    const flagsChanged = msg.active !== this.lastActive || msg.stable !== this.lastStable;
    if (flagsChanged || now - this.lastPublish >= PUBLISH_INTERVAL_MS) {
      this.lastPublish = now;
      this.lastActive = msg.active;
      this.lastStable = msg.stable;
      this.pitch.set({
        frequency: msg.frequency,
        confidence: msg.confidence,
        active: msg.active,
        stable: msg.stable,
        held: msg.held,
        levelDb: msg.levelDb,
        gateOpen: msg.gateOpen,
      });
    }
  };

  private post(message: MainToWorkletMessage): void {
    this.node?.port.postMessage(message);
  }

  private fail(error: AudioError): void {
    this.error.set(error);
    this.status.set('error');
  }

  private async handleVisibility(): Promise<void> {
    if (document.visibilityState === 'hidden') {
      if (this.status() === 'running') {
        // Save battery while the app is in the background.
        this.pausedByVisibility = true;
        this.status.set('paused');
        await this.contextService.suspend();
      }
    } else if (this.status() === 'paused' && this.pausedByVisibility) {
      const resumed = await this.contextService.resume();
      this.pausedByVisibility = false;
      // If the stream died while hidden, reconnect requires a tap.
      const live = this.stream?.getAudioTracks().some((t) => t.readyState === 'live');
      this.status.set(resumed && live ? 'running' : 'suspended');
    }
  }

  private async teardown(closeContext: boolean): Promise<void> {
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.onprocessorerror = null;
      try {
        this.node.port.postMessage({ type: 'dispose' });
        this.node.disconnect();
      } catch {
        /* ignore */
      }
      this.node.port.close();
      this.node = null;
    }
    try {
      this.source?.disconnect();
      this.sink?.disconnect();
    } catch {
      /* ignore */
    }
    this.source = null;
    this.sink = null;
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        t.removeEventListener('ended', this.onTrackEnded);
        t.stop();
      }
      this.stream = null;
    }
    this.latestFrame = null;
    this.pitch.set(SILENT_PITCH);
    this.lastActive = this.lastStable = false;
    if (closeContext) {
      this.workletContext = null;
      await this.contextService.close();
    }
  }
}
