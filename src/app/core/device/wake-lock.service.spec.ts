import { TestBed } from '@angular/core/testing';
import { FakeStream, installFakeAudio } from '../../testing/fake-audio';
import { AudioCaptureService } from '../audio/audio-capture.service';
import { MicrophonePermissionService } from '../audio/microphone-permission.service';
import { SettingsStore } from '../state/settings.store';
import { WakeLockService } from './wake-lock.service';

class FakeSentinel extends EventTarget {
  released = false;
  release = vi.fn(async () => {
    this.released = true;
    this.dispatchEvent(new Event('release'));
  });
}

describe('WakeLockService', () => {
  let requests: FakeSentinel[];

  beforeEach(() => {
    localStorage.clear();
    requests = [];
    installFakeAudio(async () => new FakeStream());
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: vi.fn(async () => {
          const s = new FakeSentinel();
          requests.push(s);
          return s;
        }),
      },
    });
    TestBed.configureTestingModule({});
    TestBed.inject(MicrophonePermissionService).support.set({
      supported: true,
      secureContext: true,
      getUserMedia: true,
      audioWorklet: true,
      reason: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as unknown as Record<string, unknown>)['wakeLock'];
    TestBed.resetTestingModule();
  });

  const flush = async () => {
    TestBed.tick();
    await new Promise((r) => setTimeout(r));
  };

  it('keeps the screen on only while listening', async () => {
    const wake = TestBed.inject(WakeLockService);
    const engine = TestBed.inject(AudioCaptureService);
    await flush();
    expect(wake.state()).toBe('off');
    await engine.start();
    await flush();
    expect(requests.length).toBe(1);
    expect(wake.state()).toBe('on');
    await engine.stop();
    await flush();
    expect(requests[0].release).toHaveBeenCalled();
    expect(wake.state()).toBe('off');
  });

  it('respects the "Keep screen on" setting', async () => {
    TestBed.inject(SettingsStore).update({ keepScreenOn: false });
    const wake = TestBed.inject(WakeLockService);
    await TestBed.inject(AudioCaptureService).start();
    await flush();
    expect(requests.length).toBe(0);
    expect(wake.state()).toBe('off');
  });

  it('prime() requests the lock synchronously inside the Start tap', async () => {
    const wake = TestBed.inject(WakeLockService);
    await flush();
    wake.prime();
    const api = (navigator as unknown as { wakeLock: { request: ReturnType<typeof vi.fn> } })
      .wakeLock;
    expect(api.request).toHaveBeenCalledTimes(1);
    await TestBed.inject(AudioCaptureService).start();
    await flush();
    expect(wake.state()).toBe('on');
    expect(api.request).toHaveBeenCalledTimes(1); // no duplicate lock
  });

  it('if the browser refuses, it retries on the next tap', async () => {
    const api = (navigator as unknown as { wakeLock: { request: ReturnType<typeof vi.fn> } })
      .wakeLock;
    api.request.mockRejectedValueOnce(new DOMException('needs gesture', 'NotAllowedError'));
    const wake = TestBed.inject(WakeLockService);
    await TestBed.inject(AudioCaptureService).start();
    await flush();
    expect(wake.state()).toBe('denied');
    document.dispatchEvent(new Event('pointerup'));
    await flush();
    expect(wake.state()).toBe('on');
  });

  it('re-acquires after the browser releases the lock (page hidden then shown)', async () => {
    const wake = TestBed.inject(WakeLockService);
    await TestBed.inject(AudioCaptureService).start();
    await flush();
    await requests[0].release(); // browser drops the lock when the page is hidden
    expect(wake.state()).toBe('off');
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(requests.length).toBe(2);
    expect(wake.state()).toBe('on');
  });
});
