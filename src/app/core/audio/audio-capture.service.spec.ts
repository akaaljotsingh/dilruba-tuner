import { TestBed } from '@angular/core/testing';
import {
  FakeAudioContext,
  FakeAudioWorkletNode,
  FakeStream,
  frame,
  installFakeAudio,
} from '../../testing/fake-audio';
import { ANALYSIS_WORKLET_URL } from './analysis-protocol';
import { AudioCaptureService } from './audio-capture.service';
import { MicrophonePermissionService } from './microphone-permission.service';

describe('AudioCaptureService (microphone lifecycle)', () => {
  let stream: FakeStream;

  function setup(getUserMedia: () => Promise<unknown> = async () => stream) {
    stream = new FakeStream();
    installFakeAudio(getUserMedia);
    TestBed.configureTestingModule({});
    const permissions = TestBed.inject(MicrophonePermissionService);
    permissions.support.set({
      supported: true,
      secureContext: true,
      getUserMedia: true,
      audioWorklet: true,
      reason: null,
    });
    return { engine: TestBed.inject(AudioCaptureService), permissions };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('requests the microphone with processing disabled and starts the worklet', async () => {
    const { engine, permissions } = setup();
    await engine.start();
    expect(engine.status()).toBe('running');
    const gum = navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>;
    expect(gum).toHaveBeenCalledWith({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });
    expect(FakeAudioContext.instances[0].audioWorklet.addModule).toHaveBeenCalledWith(
      ANALYSIS_WORKLET_URL,
    );
    expect(permissions.permission()).toBe('granted');
    expect(engine.info()?.trackSettings.echoCancellation).toBe(false);
  });

  it('publishes pitch frames from the audio thread to signals and frame listeners', async () => {
    const { engine } = setup();
    await engine.start();
    const seen: number[] = [];
    engine.onFrame((f) => seen.push(f.frequency));
    FakeAudioWorkletNode.last!.emit(frame(185));
    expect(seen).toEqual([185]);
    expect(engine.pitch().frequency).toBe(185);
    expect(engine.pitch().active).toBe(true);
  });

  it('stopping releases the microphone and disposes the AudioContext', async () => {
    const { engine } = setup();
    await engine.start();
    const ctx = FakeAudioContext.instances[0];
    await engine.stop();
    expect(engine.status()).toBe('idle');
    expect(stream.track.stop).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
    expect(engine.pitch().active).toBe(false);
  });

  it('can be restarted after stopping', async () => {
    const { engine } = setup();
    await engine.start();
    await engine.stop();
    await engine.start();
    expect(engine.status()).toBe('running');
    expect(FakeAudioContext.instances.length).toBe(2);
  });

  it('reports permission denial with a helpful message', async () => {
    const { engine, permissions } = setup(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    await engine.start();
    expect(engine.status()).toBe('error');
    expect(engine.error()?.code).toBe('permission-denied');
    expect(engine.error()?.message).toContain('Allow microphone access');
    expect(permissions.permission()).toBe('denied');
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalled();
  });

  it('reports a missing microphone', async () => {
    const { engine } = setup(async () => {
      throw new DOMException('none', 'NotFoundError');
    });
    await engine.start();
    expect(engine.error()?.code).toBe('no-device');
  });

  it('reports a busy microphone', async () => {
    const { engine } = setup(async () => {
      throw new DOMException('busy', 'NotReadableError');
    });
    await engine.start();
    expect(engine.error()?.code).toBe('device-busy');
  });

  it('refuses to start on insecure origins', async () => {
    const { engine, permissions } = setup();
    permissions.support.set({
      supported: false,
      secureContext: false,
      getUserMedia: false,
      audioWorklet: true,
      reason: 'insecure-context',
    });
    await engine.start();
    expect(engine.error()?.code).toBe('insecure-context');
    expect(FakeAudioContext.instances.length).toBe(0);
  });

  it('reports a worklet load failure', async () => {
    const { engine } = setup();
    const start = engine.start();
    FakeAudioContext.instances[0].audioWorklet.addModule.mockRejectedValueOnce(new Error('404'));
    await start;
    expect(engine.error()?.code).toBe('worklet-load');
    expect(stream.track.stop).toHaveBeenCalled();
  });

  it('handles the microphone stream ending (unplugged)', async () => {
    const { engine } = setup();
    await engine.start();
    stream.track.end();
    await new Promise((r) => setTimeout(r));
    expect(engine.status()).toBe('error');
    expect(engine.error()?.code).toBe('stream-ended');
  });

  it('clears the reading when paused in the background (no stale advice)', async () => {
    const { engine } = setup();
    await engine.start();
    FakeAudioWorkletNode.last!.emit(frame(185));
    expect(engine.pitch().active).toBe(true);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r));
    expect(engine.status()).toBe('paused');
    expect(engine.pitch().active).toBe(false);
    expect(engine.latestFrame).toBeNull();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  it('enables spectrum analysis only while a view needs it', async () => {
    const { engine } = setup();
    await engine.start();
    const node = FakeAudioWorkletNode.last!;
    const lastConfig = () =>
      node.port.postMessage.mock.calls.filter((c) => c[0].type === 'configure').at(-1)?.[0].config;
    TestBed.tick();
    expect(lastConfig().spectrumEnabled).toBe(false);
    const release = engine.useSpectrum();
    TestBed.tick();
    expect(lastConfig().spectrumEnabled).toBe(true);
    release();
    TestBed.tick();
    expect(lastConfig().spectrumEnabled).toBe(false);
  });
});
