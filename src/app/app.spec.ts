import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';
import { AudioCaptureService } from './core/audio/audio-capture.service';
import { MicrophonePermissionService } from './core/audio/microphone-permission.service';
import { SettingsStore } from './core/state/settings.store';
import { FakeAudioWorkletNode, FakeStream, frame, installFakeAudio } from './testing/fake-audio';

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('Dilruba Sur Tuner app', () => {
  beforeEach(() => {
    localStorage.clear();
    installFakeAudio(async () => new FakeStream());
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter(routes, withComponentInputBinding()),
      ],
    });
    TestBed.inject(MicrophonePermissionService).support.set({
      supported: true,
      secureContext: true,
      getUserMedia: true,
      audioWorklet: true,
      reason: null,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renders the shell with the brand, Sa selector and navigation', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('.brand-name'))).toContain('Dilruba');
    expect(el.querySelector('app-tonic-picker select')).toBeTruthy();
    const navLabels = [...el.querySelectorAll('.bottom-nav a')].map((a) => text(a));
    expect(navLabels).toEqual(['Home', 'Tuner', 'Spectrum', 'Strings', 'Settings']);
  });

  it('home screen shows both modes, the tonic and the instrument summary', async () => {
    const harness = await RouterTestingHarness.create('/');
    const el = harness.routeNativeElement!;
    expect(text(el.querySelector('h1'))).toContain('Tune Every Wire.');
    expect(text(el)).toContain('Wire Tuner');
    expect(text(el)).toContain('Sur Spectrum');
    expect(text(el)).toContain('4 Main Strings · 15 Taraf Strings');
    expect(text(el.querySelector('.mapping-title'))).toBe('Swaras for Sa = C#');
  });

  it('switches between Wire Tuner and Sur Spectrum while sharing one engine', async () => {
    const harness = await RouterTestingHarness.create('/tuner');
    expect(text(harness.routeNativeElement!.querySelector('h2'))).toBe('Wire Tuner');
    const engine = TestBed.inject(AudioCaptureService);
    await engine.start();
    await harness.navigateByUrl('/spectrum');
    expect(text(harness.routeNativeElement!.querySelector('h2'))).toBe('Sur Spectrum');
    expect(engine.status()).toBe('running');
    await engine.stop();
  });

  it('selects a string and shows its target', async () => {
    const harness = await RouterTestingHarness.create('/tuner');
    const el = harness.routeNativeElement!;
    expect(text(el.querySelector('.tl-name'))).toBe('Main 1 · Melody');
    expect(text(el.querySelector('.tl-facts'))).toContain('F#3 · 185.00 Hz');

    const tarafChips = el.querySelectorAll<HTMLButtonElement>('.wire.taraf');
    expect(tarafChips.length).toBe(15);
    tarafChips[4].click(); // Taraf 5 = Pa
    await harness.fixture.whenStable();
    expect(text(el.querySelector('.tl-name'))).toBe('Taraf 5');
    expect(text(el.querySelector('.tl-facts'))).toContain('G#3');
  });

  it('opens a specific string from the ?string= query parameter', async () => {
    const harness = await RouterTestingHarness.create('/tuner?string=main-3');
    expect(text(harness.routeNativeElement!.querySelector('.tl-name'))).toBe('Main 3');
    expect(text(harness.routeNativeElement!.querySelector('.tl-facts'))).toContain('103.83 Hz');
  });

  it('changing Sa re-maps every target', async () => {
    const harness = await RouterTestingHarness.create('/tuner');
    TestBed.inject(SettingsStore).setTonic(2); // D
    await harness.fixture.whenStable();
    const facts = text(harness.routeNativeElement!.querySelector('.tl-facts'));
    expect(facts).toContain('G3'); // Ma of D
    expect(facts).toContain('196.00 Hz');
  });

  it('shows live detection with tightening guidance for a flat wire', async () => {
    const harness = await RouterTestingHarness.create('/tuner');
    const engine = TestBed.inject(AudioCaptureService);
    await engine.start();
    FakeAudioWorkletNode.last!.emit(frame(181)); // target 185 Hz → ≈ −38 cents
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement!;
    expect(text(el.querySelector('.big-swara'))).toBe('Ma');
    expect(text(el.querySelector('.reading .sub'))).toContain('Shuddh Ma');
    expect(text(el.querySelector('.numbers'))).toContain('181.00 Hz');
    expect(text(el.querySelector('.guidance'))).toContain('Wire is too loose.');
    expect(text(el.querySelector('.status-chip'))).toBe('Very Flat');
    await engine.stop();
  });

  it('while the reading settles: direction cue only, no tightening advice text', async () => {
    const harness = await RouterTestingHarness.create('/tuner');
    const engine = TestBed.inject(AudioCaptureService);
    await engine.start();
    FakeAudioWorkletNode.last!.emit(frame(181, { stable: false }));
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement!;
    expect(text(el.querySelector('.headline'))).toBe('Hold the note steady…');
    expect(text(el.querySelector('.guidance'))).not.toContain('Wire is too loose');
    const cue = el.querySelector('.direction')!;
    expect(cue.classList).toContain('settling');
    expect(text(cue)).toContain('Tighten');
    await engine.stop();
  });

  it('no direction cue at all when there is no confident reading', async () => {
    const harness = await RouterTestingHarness.create('/tuner');
    const engine = TestBed.inject(AudioCaptureService);
    await engine.start();
    FakeAudioWorkletNode.last!.emit(frame(0));
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement!.querySelector('.direction')).toBeNull();
    await engine.stop();
  });

  it('a harmonic 2 saptaks above keeps the meter live and tunes by octave', async () => {
    const harness = await RouterTestingHarness.create('/tuner');
    const engine = TestBed.inject(AudioCaptureService);
    await engine.start();
    FakeAudioWorkletNode.last!.emit(frame(185 * 4 * Math.pow(2, -12 / 1200))); // 2 saptaks up, 12¢ flat
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement!;
    expect(text(el.querySelector('.distance'))).toContain('2 saptaks above the target');
    expect(text(el.querySelector('.distance'))).toContain('tuning by octave');
    expect(text(el.querySelector('.numbers'))).toContain('−12.0¢');
    expect(text(el.querySelector('.direction'))).toContain('Tighten');
    expect(el.querySelector('app-tuner-meter')!.getAttribute('data-status')).toBe('flat');
    await engine.stop();
  });

  it('a far-off reading shows which way to go and how far', async () => {
    const harness = await RouterTestingHarness.create('/tuner');
    const engine = TestBed.inject(AudioCaptureService);
    await engine.start();
    FakeAudioWorkletNode.last!.emit(frame(155)); // ≈ 3 semitones below 185 Hz
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement!;
    expect(text(el.querySelector('.distance'))).toContain('3 semitones below the target');
    expect(text(el.querySelector('.direction'))).toContain('▲');
    expect(text(el.querySelector('.direction'))).toContain('Tighten');
    expect(text(el.querySelector('.headline'))).toBe('Wire is far too loose.');
    await new Promise((r) => setTimeout(r, 50)); // engine publishes readings at ≤ 25 Hz
    FakeAudioWorkletNode.last!.emit(frame(277.18)); // a fifth above
    await harness.fixture.whenStable();
    expect(text(el.querySelector('.direction'))).toContain('▼');
    expect(text(el.querySelector('.direction'))).toContain('Loosen');
    await engine.stop();
  });

  it('shows a permission error on the tuner when the microphone is blocked', async () => {
    installFakeAudio(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    const harness = await RouterTestingHarness.create('/tuner');
    const btn = harness.routeNativeElement!.querySelector<HTMLButtonElement>('.start')!;
    expect(text(btn)).toContain('Tap to start tuning');
    btn.click();
    await new Promise((r) => setTimeout(r));
    await harness.fixture.whenStable();
    expect(text(harness.routeNativeElement!.querySelector('[role="alert"]'))).toContain(
      'Microphone access is blocked',
    );
  });

  it('swiping the reading left/right changes wire on touch screens', async () => {
    const harness = await RouterTestingHarness.create('/tuner');
    const el = harness.routeNativeElement!;
    const stage = el.querySelector<HTMLElement>('.stage')!;
    const swipe = (fromX: number, toX: number) => {
      const init = { pointerType: 'touch', clientY: 300, bubbles: true } as PointerEventInit;
      stage.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: fromX }));
      stage.dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: toX }));
    };
    // The idle start button covers the reading; swipe on the stage padding instead.
    swipe(300, 120); // swipe left → next wire
    await harness.fixture.whenStable();
    expect(text(el.querySelector('.tl-name'))).toBe('Main 2');
    swipe(120, 300); // swipe right → previous wire
    await harness.fixture.whenStable();
    expect(text(el.querySelector('.tl-name'))).toBe('Main 1 · Melody');
  });

  it('offers "Tap to resume" after the app was paused in the background', async () => {
    const harness = await RouterTestingHarness.create('/tuner');
    const engine = TestBed.inject(AudioCaptureService);
    await engine.start();
    engine.status.set('paused');
    await harness.fixture.whenStable();
    expect(text(harness.routeNativeElement!.querySelector('.start'))).toContain('Tap to resume');
    await engine.stop();
  });

  it('instrument page changes the number of sympathetic strings', async () => {
    const harness = await RouterTestingHarness.create('/instrument');
    const el = harness.routeNativeElement!;
    const add = el.querySelector<HTMLButtonElement>('[aria-label="Add a sympathetic string"]')!;
    add.click();
    add.click();
    await harness.fixture.whenStable();
    expect(el.querySelectorAll('app-string-row').length).toBe(4 + 17);
  });

  it('spectrum defaults to Focus view and can switch to All sounds', async () => {
    const harness = await RouterTestingHarness.create('/spectrum');
    const el = harness.routeNativeElement!;
    expect(el.querySelector('.segmented [aria-checked="true"]')?.textContent?.trim()).toBe('Focus');
    expect(el.querySelector('.legend')).toBeNull();
    expect(text(el.querySelector('.start'))).toContain('You will see the note you play');
    const all = [...el.querySelectorAll<HTMLButtonElement>('.segmented button')].find((b) =>
      text(b).startsWith('All'),
    )!;
    all.click();
    await harness.fixture.whenStable();
    expect(text(el.querySelector('.legend'))).toContain('Your note');
    expect(TestBed.inject(SettingsStore).settings().spectrumView).toBe('all');
  });

  it('spectrum full screen: enters, covers the app, exits with the button or Esc', async () => {
    const harness = await RouterTestingHarness.create('/spectrum');
    const el = harness.routeNativeElement!;
    const root = el.querySelector<HTMLElement>('.spectrum')!;
    const btn = () => el.querySelector<HTMLButtonElement>('.tool-btn.fullscreen')!;
    expect(btn().getAttribute('aria-label')).toBe('Full screen');
    btn().click();
    await harness.fixture.whenStable();
    expect(root.classList).toContain('immersive');
    expect(btn().getAttribute('aria-label')).toBe('Exit full screen');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await harness.fixture.whenStable();
    expect(root.classList).not.toContain('immersive');
    btn().click();
    await harness.fixture.whenStable();
    btn().click();
    await harness.fixture.whenStable();
    expect(root.classList).not.toContain('immersive');
  });

  it('spectrum is vertical on a phone held upright and switches when rotated', async () => {
    let onChange: ((e: { matches: boolean }) => void) | null = null;
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true, // portrait phone
        addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => (onChange = cb),
        removeEventListener: vi.fn(),
      })),
    );
    const harness = await RouterTestingHarness.create('/spectrum');
    const root = harness.routeNativeElement!.querySelector('.spectrum')!;
    expect(root.classList).toContain('vertical');
    onChange!({ matches: false }); // rotated to landscape
    await harness.fixture.whenStable();
    expect(root.classList).not.toContain('vertical');
  });

  it('spectrum page loads and degrades gracefully without canvas support', async () => {
    const harness = await RouterTestingHarness.create('/spectrum');
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement!.querySelector('canvas')).toBeTruthy();
  });
});
