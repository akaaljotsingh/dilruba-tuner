# Dilruba Sur Tuner

**Tune Every Wire. Find Every Sur.**

A precise, installable, offline-capable tuner for the Dilruba and Hindustani music. It has two modes:

- **Wire Tuner**: tune each main and taraf (sympathetic) wire against its target swara, with a cents meter and tighten/loosen guidance.
- **Sur Spectrum**: a live, multi-saptak view of every pitch the microphone hears. It shows the swara, Western note and octave of each one, with line brightness proportional to its strength. Overtones and sympathetic resonance are told apart from played notes.

Everything runs in the browser. There is no backend, no account and no analytics. Microphone audio is analysed in memory on the device; it is **never recorded, stored or uploaded**.

---

## Quick start

Requires **Node ≥ 22.22** (Angular CLI 22).

```bash
npm install
npm start            # http://localhost:4200 (dev, no service worker)
npm test             # 166 unit tests (Vitest via Angular builder)
npm run lint
npm run build        # production build → dist/dilruba-tuner/browser
npm run serve:prod   # serve the production build at http://localhost:8080 (PWA/offline testing)
```

`npm start`, `npm run build` and `npm test` first run `npm run build:worklet`, which type-checks and bundles the AudioWorklet (see below).

---

## Architecture

```
src/app/
  core/
    audio/                     ← Web Audio plumbing (Angular services, no DSP)
      audio-capture.service.ts   shared engine: getUserMedia → AudioWorkletNode → frames
      audio-context.service.ts   AudioContext lifetime (gesture-safe create / resume / close)
      microphone-permission.service.ts  support + permission state
      reference-tone.service.ts  "Hear target" tone
      analysis-protocol.ts       typed messages between main thread and worklet
      audio-errors.ts            user-facing error mapping
      audio-worklet/sur-analysis.worklet.ts  AudioWorklet entry (bundled separately)
    dsp/                       ← pure TypeScript, no Angular, fully unit-tested
      analysis-pipeline.ts       ring buffer → YIN → gate → smoother; FFT → peaks → harmonics
      yin-pitch-detector.ts      FFT-accelerated YIN with octave-error guard
      fft-analyzer.ts            radix-2 FFT, Hann-windowed dBFS spectrum
      frequency-analyzer.ts      noise floor, peak picking, intensity normalisation
      harmonic-analyzer.ts       fundamental / harmonic / resonance classification
      noise-filter.ts            high-pass biquad, adaptive noise gate
      audio-smoother.ts          median + adaptive EMA pitch smoothing, stability
      pitch-line-tracker.ts      visual line tracking, attack/release, hysteresis
    music/                     ← swara engine, pure functions
      swara-mapper.ts, western-note-mapper.ts, frequency-converter.ts,
      octave-mapper.ts, cents-calculator.ts, tuning-evaluator.ts, instrument-presets.ts
    models/                    ← swara, pitch, spectrum, tuning, string, instrument types
    state/                     ← SettingsStore, InstrumentStore (signals + localStorage)
    pwa/pwa.service.ts         ← online state, install prompt, update notice
  features/  home · wire-tuner · sur-spectrum (+ canvas renderer) · instrument-settings · app-settings
  shared/    icon, logo, swara-label, tuner-meter, listen-button, audio-status, tonic-picker, pipes
  layout/    main-layout (header, Sa picker, nav)
src/styles/  _variables · _typography · _animations · _utilities
scripts/     build-worklet.mjs · generate-icons.mjs · serve-dist.mjs
```

### Data flow and threading

```
Microphone ─► MediaStreamSource ─► AudioWorkletNode (audio thread)
                                     │  all DSP: high-pass, YIN, gate, smoothing,
                                     │  FFT, peaks, harmonic classes
                                     ▼  ~50 small frames/s (peaks as transferable Float32Array)
                              AudioCaptureService (main thread)
                    ┌────────────────┴─────────────────┐
     signals, throttled to ≤25 Hz            onFrame() listeners (no change detection)
     → Wire Tuner text, status                → Sur Spectrum canvas (rAF)
                                              → tuner needle (rAF spring, direct style write)
```

- One engine serves both modes. Switching between Tuner and Spectrum keeps listening; the Spectrum asks for FFT analysis only while it's on screen (`useSpectrum()`).
- No FFT or pitch detection runs in components. Angular is zoneless; only signal consumers re-render. The canvas and needle animate via `requestAnimationFrame` without touching change detection.
- The worklet output is routed through a zero-gain node (some browsers only pull nodes connected to the destination). Nothing is played back.
- Lifecycle: the AudioContext is created **inside the Start tap** (required by iOS Safari). It is suspended while the tab is hidden and resumed when visible. iOS `interrupted` state, track `ended` (unplugged mic) and processor errors are all handled. Stop releases the mic tracks and closes the AudioContext.

### Why the worklet is bundled separately

`audioWorklet.addModule()` loads a module **by URL**, outside the Angular bundle. `scripts/build-worklet.mjs` type-checks the worklet (`tsconfig.worklet.json`) and uses esbuild to bundle it, together with the DSP classes it imports, into `public/worklets/sur-analysis.worklet.js` (~19 kB). The service worker caches it. Unit tests, the worklet and the app all share the same DSP source.

---

## DSP

**Analysis windows** (chosen from the actual `AudioContext.sampleRate`):

| | 44.1 / 48 kHz | 96 kHz | Rationale |
|---|---|---|---|
| Pitch window | 4096 (≈85 ms) | 8192 | ≥ 2 periods of 50 Hz with an N/2 lag range |
| FFT size | 8192 (≈170 ms, 5.9 Hz bins) | 16384 | separates adjacent semitones down to ~110 Hz |
| Hop | 1024 / 896 samples | 1920 | ≈ 50 analyses per second |

**Pitch (Wire Tuner, and the "Playing now" readout).**

1. 2nd-order Butterworth high-pass (≈0.6 × lowest pitch) removes DC, rumble and most hum.
2. **YIN** (de Cheveigné & Kawahara). The difference function is computed in O(N log N) by FFT cross-correlation plus prefix sums of energy, not the naive O(N·W) loop. Then come the cumulative mean normalised difference, an absolute threshold and parabolic interpolation.
3. **Octave-error guard.** YIN's "first dip" rule can pick half the true period when the 2nd harmonic is strong, which is common on bowed strings. A dip is accepted only if it is within 0.06 of the best dip in range.
4. **Noise gate.** An adaptive floor follows unvoiced background level, rate-limited in both directions. Periodic frames never raise it, so a sustained note can't close the gate on itself. (A regression test covers a lock-out bug found during browser testing.)
5. **Smoother.** Median-of-5 → jump detection (a new note is accepted after 3 agreeing frames) → adaptive EMA in the cents domain → a *stable* flag (≤ 8¢ spread over 6 frames). Readings are held for 350 ms through dropouts.
6. Tighten/loosen advice is given **only** when the reading is confident *and* stable. Readings about an octave from the target produce a "check the wire / harmonic" message instead of a huge adjustment.

**Spectrum (Sur Spectrum).**

1. Hann-windowed FFT → magnitude in **dBFS**, a relative digital level (a full-scale sine is about 0 dB). It is not dB SPL.
2. **Noise floor**: the median of in-range bins, smoothed (falls fast, rises slowly). **Spectral flatness** flags noise-like frames.
3. **Peak picking**: local maxima above floor + margin with two-sided prominence. A distance-aware window-sidelobe guard keeps peaks next to a loud neighbour while rejecting Hann sidelobes. Parabolic interpolation gives frequency and level.
4. **Intensity**: (level − threshold) / dynamic range, where the range's top is a peak-hold of the loudest peak (decays 6 dB/s, at least 30 dB). The result is a 0–1 *relative* intensity.
5. **Harmonic classification**: each peak in range is scored as a candidate f₀ by summing the amplitudes of peaks at n·f₀. Agreement with the YIN pitch gets a bonus.
   - The winner is a **Fundamental** if its own series supports it, it agrees with YIN, or it is a very strong single tone. Members of its series become **Harmonics**, and the search repeats for up to 4 simultaneous notes.
   - Candidates must be actual peaks, so no sub-octave "ghost" fundamentals are invented. A weak low tone whose "series" is only even harmonics of a louder note is rejected.
   - A quieter secondary tone with no overtones of its own, near a tempered pitch, is classified as **Resonance** (typically a taraf ringing). Anything else is **Uncertain** or **Noise**.
6. **Visual tracking** (main thread): peaks are matched to lines within 40¢. Intensity uses attack (35 ms) and release (450 ms) envelopes, frequency is smoothed in log space, and class changes need 3 consecutive frames, which prevents flicker. Labels appear only on fundamentals and resonance that persist for at least 2 frames.

**Rendering.** Line brightness, thickness and height all scale with intensity, and strong fundamentals glow. Harmonics are thin and gold, resonance is dashed teal, and uncertain peaks are faint grey without labels. The static grid (saptak bands, swara and Western labels with komal/tivra/saptak marks) is drawn once to an offscreen canvas.

---

## Swara mapping

- `midi = 69 + 12·log₂(f / A4)` (A4 defaults to 440 Hz and is configurable from 400–480 Hz).
- With Sa at pitch class `t` and **Madhya Sa** in scientific octave `o`: `madhyaSaMidi = 12·(o+1) + t`. Swara *s* (semitone 0–11) in saptak *k* (−1 Mandra, 0 Madhya, +1 Taar, …) is `midi = madhyaSaMidi + 12k + s`.
- The **Western octave** (changes at C) and the **saptak** (changes at Sa) are calculated independently. With Sa = C#, Madhya Shuddh Ni is **C4** but still **Madhya**.
- Deviation: `cents = 1200·log₂(f / f_target)`. Positive is sharp (loosen); negative is flat (tighten).
- All 12 tonics × 12 swaras × 5 saptaks × ±30¢ detuning are unit-tested. The mapping table on Home is generated, not hard-coded.

Swaras are shown in Bhatkhande style: komal is underlined, tivra has a stroke above, and mandra/taar have dots below/above. Full names (e.g. "Komal Re") are used wherever there is room.

## Instrument configuration

- **Main strings** (1–8). The editable starter preset is: Main 1 (melody) **Ma**, Main 2 **Sa**, Main 3 **Mandra Pa**, Main 4 **Mandra Sa**. It's an example, not a standard; change any wire's swara, saptak, name or fine offset (±50¢).
- **Taraf strings** (0–30, default 15). Each is individually editable, or can be filled from any of the **10 thaats** or a chromatic sequence, starting from a chosen saptak. Adding strings continues the chosen pattern.
- **Madhya Sa octave** (default 3, e.g. C#3 ≈ 138.6 Hz) sets where saptaks are counted from.
- Each wire resolves to its swara, Western note and octave, and target frequency, and updates live when Sa or A4 changes.
- Stored in `localStorage` (validated on load). The tuner works without it.

---

## PWA

- `@angular/service-worker` with `ngsw-config.json`. The **app shell**, all JS/CSS chunks, the **AudioWorklet** and the **self-hosted fonts** are prefetched on install; icons are cached lazily. Microphone audio is never cached.
- `manifest.webmanifest`: standalone display, theme/background colour, 8 standard icons, 2 maskable icons, an SVG icon and shortcuts to Tuner and Spectrum. Icons are generated from the logo geometry by `npm run icons` (pure Node).
- Static splash markup in `index.html` shows until Angular boots.
- An install button appears where `beforeinstallprompt` is supported; iOS gets Add-to-Home-Screen instructions. Update banners use `SwUpdate`.
- Offline fallback: the service worker serves the cached shell for every navigation, so deep links like `/tuner` open offline. An "Offline" badge appears in the header.

**Verified in a Chromium browser:** after the first load I stopped the server and reloaded `/spectrum`. The app loaded entirely from cache, and Start Listening loaded the cached worklet and began listening.

## Deployment & HTTPS

**Live:** https://akaaljotsingh.github.io/dilruba-tuner/

Every push to `main` runs `.github/workflows/deploy-pages.yml`, which lints, tests, builds with `--base-href /dilruba-tuner/`, copies `index.html` to `404.html` (so deep links work) and publishes to GitHub Pages. To mimic that locally:

```bash
npm run build -- --base-href /dilruba-tuner/
BASE=/dilruba-tuner/ npm run serve:prod   # http://localhost:8080/dilruba-tuner/
```

Browsers only expose the microphone and service workers in **secure contexts**: `https://` or `http://localhost`. To host elsewhere, deploy `dist/dilruba-tuner/browser` to any static HTTPS host (Netlify, Vercel, Cloudflare Pages, S3+CloudFront, nginx):

1. `npm run build`
2. Upload `dist/dilruba-tuner/browser/`.
3. Configure an **SPA fallback**: unknown paths serve `index.html` (e.g. Netlify `/* /index.html 200`; nginx `try_files $uri /index.html;`).
4. Serve `ngsw-worker.js`, `ngsw.json` and `index.html` with `Cache-Control: no-cache`. Hashed `*.js` / `*.css` can be cached long-term.
5. If hosting under a sub-path, build with `ng build --base-href /sub/path/`.

## Installing the app

- **Chrome / Edge (desktop):** install icon in the address bar, or menu → *Install Dilruba Sur Tuner*.
- **Chrome (Android):** menu → *Install app* / *Add to Home screen*, or the in-app Install button.
- **Safari (iOS / iPadOS):** Share → *Add to Home Screen*.

---

## Testing

`npm test` runs 166 tests:

- **Music engine**: all 12 Sa × 12 swaras, Western names and octaves, MIDI, cents, saptak boundaries, target frequencies, A4 and flats, transposition, and the documented C# table.
- **Pitch detection** (synthetic signals): sines from 65 Hz to 1.1 kHz within 1¢, 2¢ resolution, strong 2nd and 3rd harmonics, missing fundamental, −50 dBFS input, 20 dB SNR noise, pure noise, silence, glide, out-of-range, and a played wire with quieter taraf resonance.
- **Spectrum**: FFT identity and bin mapping, interpolation accuracy, noise floor, flatness, intensity ordering, sidelobe rejection, adjacent-semitone resolution, harmonic classification, polyphony, resonance, sub-octave guard, and visual decay and hysteresis.
- **Pipeline end-to-end**: 128-sample streaming, stability, noise rejection, and sudden pitch jumps (gate lock-out regression).
- **Angular**: microphone lifecycle with Web Audio fakes (constraints, start/stop/restart, cleanup, permission denied, no device, busy device, insecure origin, worklet failure, unplugged stream, spectrum on demand), routing and mode switching, string selection, `?string=` deep links, Sa change, live guidance, no advice while unstable, error banner, sympathetic count, and persistence and sanitisation.

**Browser verification (Chromium).** The real AudioWorklet pipeline was driven by a synthetic bowed-string tone injected in place of the microphone (debug only, not shipped). Both modes, desktop and 375 px mobile layouts, pitch jumps and offline loading were all checked.

### Not yet verified (needs real hardware)

Synthetic signals cannot prove real-world accuracy. Still to do:

- **Physical Dilruba testing** with real microphones: bow noise, sympathetic ringing, room acoustics, and phone mics with their own filtering.
- **Safari iOS, Chrome Android and Edge** on real devices; only Chromium on macOS was exercised.
- Installed-PWA microphone behaviour on each platform.

## Known browser limitations

- Requested constraints (`echoCancellation`, `noiseSuppression`, `autoGainControl: false`) are hints. Some devices, notably some phones and Bluetooth headsets, keep voice processing on. Settings → *Microphone & audio engine* shows the settings the browser actually applied.
- **iOS Safari**: audio starts only from a tap; calls or Siri can interrupt it (you'll see "Audio interrupted"; tap Resume). Background tabs are suspended. Permission prompts may repeat in some installed-PWA versions.
- The engine pauses while the app is in the background, to save battery, and resumes when it's visible again.
- Requires AudioWorklet (Chrome/Edge 66+, Safari 14.5+, Firefox 76+). Older browsers get a clear "not supported" message.
- When two unrelated notes of **similar loudness** play together, the monophonic Wire Tuner may report a shared pseudo-period. Play one wire at a time; the Sur Spectrum resolves simultaneous notes.
- Intensity in the Sur Spectrum is relative microphone signal strength, not calibrated loudness.
