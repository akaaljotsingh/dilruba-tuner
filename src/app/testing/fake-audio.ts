/**
 * Minimal Web Audio / MediaStream fakes for jsdom-based tests of the audio
 * engine lifecycle. They model only what AudioCaptureService touches.
 */
import { vi } from 'vitest';

export class FakeTrack extends EventTarget {
  readyState: 'live' | 'ended' = 'live';
  label = 'Fake microphone';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  getSettings() {
    return {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: 48000,
      channelCount: 1,
    };
  }
  /** Simulates the device being unplugged. */
  end(): void {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

export class FakeStream {
  readonly track = new FakeTrack();
  getTracks() {
    return [this.track];
  }
  getAudioTracks() {
    return [this.track];
  }
}

class FakeNode {
  connect = vi.fn((n: unknown) => n);
  disconnect = vi.fn();
}

export class FakeAudioContext extends EventTarget {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = 'suspended';
  sampleRate = 48000;
  destination = {};
  audioWorklet = { addModule: vi.fn(async () => undefined) };
  closed = false;
  constructor() {
    super();
    FakeAudioContext.instances.push(this);
  }
  resume = vi.fn(async () => {
    this.state = 'running';
    this.dispatchEvent(new Event('statechange'));
  });
  suspend = vi.fn(async () => {
    this.state = 'suspended';
    this.dispatchEvent(new Event('statechange'));
  });
  close = vi.fn(async () => {
    this.state = 'closed';
    this.closed = true;
  });
  createMediaStreamSource = vi.fn(() => new FakeNode());
  createGain = vi.fn(() => Object.assign(new FakeNode(), { gain: { value: 1 } }));
}

export class FakeAudioWorkletNode extends FakeNode {
  static last: FakeAudioWorkletNode | null = null;
  onprocessorerror: (() => void) | null = null;
  port = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    postMessage: vi.fn(),
    close: vi.fn(),
  };
  constructor() {
    super();
    FakeAudioWorkletNode.last = this;
  }
  /** Delivers a message from the (fake) audio thread. */
  emit(data: unknown): void {
    this.port.onmessage?.({ data } as MessageEvent);
  }
}

export function installFakeAudio(getUserMedia: () => Promise<unknown>) {
  FakeAudioContext.instances = [];
  FakeAudioWorkletNode.last = null;
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(getUserMedia) },
  });
}

export function frame(frequency: number, extra: Record<string, unknown> = {}) {
  return {
    type: 'frame',
    time: 0,
    levelDb: -20,
    noiseFloorDb: -70,
    gateOpen: true,
    frequency,
    confidence: 0.98,
    active: frequency > 0,
    stable: true,
    held: false,
    rawFrequency: frequency,
    rawConfidence: 0.98,
    spectrum: null,
    ...extra,
  };
}
