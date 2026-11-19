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
    expect(text(el.querySelector('.t-name'))).toBe('Main 1 · Melody');
    expect(text(el.querySelector('.t-facts'))).toContain('185.00 Hz');

    const tarafChips = el.querySelectorAll<HTMLButtonElement>('.wire.taraf');
    expect(tarafChips.length).toBe(15);
    tarafChips[4].click(); // Taraf 5 = Pa
    await harness.fixture.whenStable();
    expect(text(el.querySelector('.t-name'))).toBe('Taraf 5');
    expect(text(el.querySelector('.t-facts'))).toContain('G# · octave 3');
  });

  it('opens a specific string from the ?string= query parameter', async () => {
    const harness = await RouterTestingHarness.create('/tuner?string=main-3');
    expect(text(harness.routeNativeElement!.querySelector('.t-name'))).toBe('Main 3');
    expect(text(harness.routeNativeElement!.querySelector('.t-facts'))).toContain('103.83 Hz');
  });

  it('changing Sa re-maps every target', async () => {
    const harness = await RouterTestingHarness.create('/tuner');
    TestBed.inject(SettingsStore).setTonic(2); // D
    await harness.fixture.whenStable();
    const facts = text(harness.routeNativeElement!.querySelector('.t-facts'));
    expect(facts).toContain('G · octave 3'); // Ma of D
    expect(facts).toContain('196.00 Hz');
  });

  it('shows live detection with tightening guidance for a flat wire', async () => {
    const harness = await RouterTestingHarness.create('/tuner');
    const engine = TestBed.inject(AudioCaptureService);
    await engine.start();
    FakeAudioWorkletNode.last!.emit(frame(181)); // target 185 Hz → ≈ −38 cents
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement!;
    expect(text(el.querySelector('.big-swara'))).toBe('Shuddh Ma');
    expect(text(el.querySelector('.numbers'))).toContain('181.00 Hz');
    expect(text(el.querySelector('.guidance'))).toContain('Wire is too loose.');
    expect(text(el.querySelector('.status-chip'))).toBe('Very Flat');
    await engine.stop();
  });

  it('gives no tightening advice while the reading is unstable', async () => {
    const harness = await RouterTestingHarness.create('/tuner');
    const engine = TestBed.inject(AudioCaptureService);
    await engine.start();
    FakeAudioWorkletNode.last!.emit(frame(181, { stable: false }));
    await harness.fixture.whenStable();
    const guidance = text(harness.routeNativeElement!.querySelector('.guidance'));
    expect(guidance).not.toContain('Tighten');
    expect(guidance).toContain('Hold the note steady');
    await engine.stop();
  });

  it('shows a permission error on the tuner when the microphone is blocked', async () => {
    installFakeAudio(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    const harness = await RouterTestingHarness.create('/tuner');
    const btn = [...harness.routeNativeElement!.querySelectorAll('button')].find((b) =>
      text(b).includes('Start Listening'),
    )!;
    btn.click();
    await new Promise((r) => setTimeout(r));
    await harness.fixture.whenStable();
    expect(text(harness.routeNativeElement!.querySelector('[role="alert"]'))).toContain(
      'Microphone access is blocked',
    );
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

  it('spectrum page loads and degrades gracefully without canvas support', async () => {
    const harness = await RouterTestingHarness.create('/spectrum');
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement!.querySelector('canvas')).toBeTruthy();
  });
});
