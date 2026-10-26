# Milestone 3 — Building the browser mixer (React + Web Audio)

This guide walks through everything the `frontend/` code uses, in the order you need it. Like
notebook 01, each section has a short **Try it** experiment. Most run in the browser's DevTools
console, so you learn the idea in isolation before seeing it in the app.

**Goals**
1. Know the tools: Node/npm, Vite, TypeScript.
2. Understand the React features the app uses (state, effects, refs, custom hooks).
3. Talk to the backend: uploads, polling, aborting requests.
4. Understand the **Web Audio API**: how the browser plays, aligns and mixes audio.
5. Understand the **remix maths** that keeps the mix sounding like the original.
6. Draw waveforms efficiently with `<canvas>`.

**Before you start:** have Milestone 2 running (Redis, `python worker.py`, uvicorn), then:
```bash
cd frontend && npm install && npm run dev
```
Open http://localhost:5173 and separate a song so you have something to play with.

**Suggested reading order of the code**

| # | File | What to look for |
|---|---|---|
| 1 | [api.ts](../frontend/src/api.ts) | The shape of a job, and `fetch` calls |
| 2 | [useJob.ts](../frontend/src/useJob.ts) | Polling with a custom hook |
| 3 | [App.tsx](../frontend/src/App.tsx) | Which screen to show, URL state |
| 4 | [UploadForm.tsx](../frontend/src/components/UploadForm.tsx) | Forms, drag and drop |
| 5 | [audio/mixing.ts](../frontend/src/audio/mixing.ts) | The remix maths (pure function, no audio) |
| 6 | [audio/MixEngine.ts](../frontend/src/audio/MixEngine.ts) | The Web Audio graph |
| 7 | [components/Mixer.tsx](../frontend/src/components/Mixer.tsx) | Connecting React state to the engine |
| 8 | [audio/peaks.ts](../frontend/src/audio/peaks.ts), [components/Waveform.tsx](../frontend/src/components/Waveform.tsx) | Waveform drawing |

---

## 1. The big picture

```
┌─────────────────────────── browser (React app) ───────────────────────────┐
│ UploadForm ──POST /api/jobs──┐                                            │
│ JobView  ◀──GET /api/jobs/{id} every 1.5 s (useJob)                       │
│ Mixer    ──GET stems/*.flac──▶ decode ──▶ MixEngine (Web Audio) ──▶ 🔊    │
└──────────────────────────────┼────────────────────────────────────────────┘
                               ▼
               Vite dev server :5173 ── proxies /api ──▶ FastAPI :8000
```

Three screens, chosen in `App.tsx`:
1. **No job in the URL** → `UploadForm`.
2. **Job not finished** → `JobView` shows the progress.
3. **Job finished** → `Mixer` downloads every track, decodes it to raw samples and plays them
   through the audio engine.

---

## 2. The tooling

### Node and npm
**Node** runs JavaScript outside the browser. Here it only runs the *tools*; the app itself runs
in the browser. **npm** installs packages listed in [package.json](../frontend/package.json):
- `dependencies` are shipped to the browser: just `react` and `react-dom`.
- `devDependencies` are only used while developing: `vite`, `typescript`, type definitions.
- `scripts` are shortcuts. `npm run dev` runs `vite`.

`npm install` writes the packages to `node_modules/` (git-ignored) and records exact versions
in `package-lock.json` (commit that file).

### Vite
Vite is the **dev server and bundler**:
- **Dev server:** serves `src/` to the browser, converting TypeScript/JSX on the fly.
- **Hot Module Replacement (HMR):** save a file and the page updates without a full reload.
- **Proxy** ([vite.config.ts](../frontend/vite.config.ts)): requests to `/api/...` are forwarded to
  `localhost:8000`. The browser thinks everything comes from `localhost:5173`, so there are
  no CORS problems in development.
- **`npm run build`** bundles everything into static files in `dist/` for deployment.

### TypeScript
TypeScript is JavaScript plus **types**, checked before the code runs (`npm run typecheck`).
The browser never sees types; Vite strips them.

Features used in this codebase:

```ts
// Union of string literals: status can only be one of these.
type JobStatus = "queued" | "started" | "finished" | "failed" /* ... */;

// Optional fields (?) exist only sometimes, e.g. stems only once finished.
interface Job { id: string; stems?: Record<string, string>; }

// `as const` turns an array into a fixed tuple of literals, and a type is derived from it.
export const MODELS = ["htdemucs_6s", "htdemucs", "htdemucs_ft"] as const;
export type ModelName = (typeof MODELS)[number]; // "htdemucs_6s" | "htdemucs" | "htdemucs_ft"

// Non-null assertion (!): "I know this isn't undefined". Use sparingly.
document.getElementById("root")!;
```

> **Try it:** in `UploadForm.tsx`, change `useState<ModelName>("htdemucs_6s")` to
> `useState<ModelName>("htdemucs_7s")` and run `npm run typecheck`. TypeScript catches the
> typo before the code ever runs. Change it back afterwards.

---

## 3. React: the parts this app uses

React builds the UI from **components**: functions that take **props** and return what to show
(JSX). When **state** changes, React calls the function again and updates the page to match.

### 3.1 State: `useState`
```tsx
const [playing, setPlaying] = useState(false);
```
Calling `setPlaying(true)` stores the new value **and re-renders** the component. Never
change state directly, for example `settings.vocals.muted = true`. Always create a new object:

```tsx
// Mixer.tsx — updateTrack
setSettings((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
```
The `prev => ...` form reads the latest state, which is safer when several updates happen
quickly.

### 3.2 Effects: `useEffect`, the bridge to the outside world
Rendering must be pure: no network, no timers, no audio. Anything that *talks to the outside
world* goes in an effect, which runs **after** rendering:

```tsx
useEffect(() => {
  const engine = new MixEngine(job.samplerate);   // set up
  // ...load tracks...
  return () => engine.dispose();                    // clean up
}, [job]);                                          // re-run only when `job` changes
```
- The **dependency array** (`[job]`) says when to re-run.
- The **cleanup function** runs before the next run and when the component disappears. Without
  it you'd leak audio contexts, timers and network requests.

**StrictMode** (in [main.tsx](../frontend/src/main.tsx)) runs every effect **twice** in
development: set up, clean up, set up. It does this on purpose, to expose missing cleanups.
That's why `Mixer` aborts its downloads and closes the `AudioContext` in cleanup.

Effects used in the app:

| Where | Outside-world thing | Cleanup |
|---|---|---|
| `useJob` | polling timer + fetch | abort fetch, clear timer |
| `Mixer` | AudioContext, track downloads | abort, `engine.dispose()` |
| `Mixer` | `requestAnimationFrame` loop for the playhead | `cancelAnimationFrame` |
| `Mixer` | `keydown` listener (space bar) | `removeEventListener` |
| `Waveform` | `ResizeObserver` | `observer.disconnect()` |

### 3.3 Refs: `useRef`, values that are *not* state
```tsx
const engineRef = useRef<MixEngine | null>(null);
```
A ref is a box that **survives re-renders but doesn't cause them**. Use it for:
- **Long-lived objects** like the audio engine. You don't want a new one on every render.
- **DOM elements**: `<canvas ref={canvasRef} />` gives you the real canvas to draw on.

Rule of thumb: *if the screen should change when it changes, use state; otherwise use a ref.*

### 3.4 `useCallback`
`useCallback(fn, deps)` keeps the same function object between renders. `togglePlay` uses it
so the keyboard effect, which depends on it, doesn't re-subscribe on every render.

### 3.5 Custom hooks
A function starting with `use` that calls other hooks. [useJob.ts](../frontend/src/useJob.ts) hides
all the polling logic, and the component just writes:
```tsx
const { job, error } = useJob(id);
```

### 3.6 Other patterns to spot
- **Conditional rendering:** `{load.kind === "ready" && <Transport />}`.
- **Lists need `key`:** `sources.map((name) => <TrackRow key={name} ... />)` lets React match
  rows between renders.
- **Controlled inputs:** the slider's `value` comes from state, and `onChange` writes state.
  React state is the single source of truth.
- **`key` to reset a component:** `<JobView key={jobId} />` in `App.tsx`. A new job ID gives a fresh
  component with fresh state.
- **Discriminated unions for UI state:** `LoadState` is `loading | ready | error`, each with
  its own fields. Impossible states, like "ready with an error", can't be represented.

> **Try it:** remove the `return () => { ... }` cleanup from the first effect in `Mixer.tsx`,
> open a job and watch the DevTools console and memory. StrictMode will create two engines.
> Put it back afterwards.

---

## 4. Talking to the backend

### 4.1 Uploading a file: `FormData`
```ts
const form = new FormData();
form.append("file", file);       // a File from <input type="file"> or drag-and-drop
form.append("model", model);
await fetch("/api/jobs", { method: "POST", body: form });
```
The browser sends this as `multipart/form-data`, the same format as `curl -F`. FastAPI reads
it with `UploadFile = File(...)` and `Form(...)`.

### 4.2 Async/await and errors
`fetch` returns a *Promise*. `await` pauses the function until the response arrives.
`fetch` **does not throw on 404 or 500**; you must check `res.ok`. `errorMessage()` in `api.ts`
pulls FastAPI's `{"detail": "..."}` out of error responses so users see "file is larger than
50 MB" rather than "413".

### 4.3 Polling
`useJob` asks "is it done yet?" every 1.5 s until the job is `finished` or `failed`. It uses
`setTimeout` *after* each response rather than `setInterval`, so slow responses never pile up.

Alternatives you could learn later:
- **Server-Sent Events (SSE):** the server pushes updates over one open HTTP connection.
- **WebSockets:** two-way channel. Overkill for one-way progress updates.

### 4.4 Cancelling: `AbortController`
```ts
const controller = new AbortController();
fetch(url, { signal: controller.signal });
controller.abort();  // the fetch rejects immediately
```
Used in cleanups, so leaving the page cancels in-flight requests instead of updating a
component that no longer exists.

### 4.5 State in the URL
`App.tsx` stores the job ID as `?job=<id>` with `history.pushState`, and listens to
`popstate` for the back button. So refresh, back/forward and sharing a link all work.

---

## 5. The Web Audio API

This is the heart of the milestone. The browser gives you an **audio graph**: nodes connected
together, ending at the speakers.

```
source node ──▶ processing nodes (gain, filter, analyser…) ──▶ ctx.destination (speakers)
```

> **Running the experiments:** open any page (e.g. the app), open DevTools → Console,
> **click once on the page** (browsers only allow audio after a user gesture), then paste the
> snippets one block at a time. If nothing plays, run `await ctx.resume()`.

### 5.1 `AudioContext`: the audio world and its clock
```js
const ctx = new AudioContext();
ctx.sampleRate;    // e.g. 48000 or 44100 — samples per second, as in notebook 01
ctx.currentTime;   // seconds since the context started; a very precise audio clock
```
`ctx.currentTime` is the clock everything is scheduled against. It's far more precise than
`setTimeout`, which can be late by many milliseconds.

The app creates its context with `new AudioContext({ sampleRate: job.samplerate })` (44100), so
the browser doesn't have to resample the stems.

> **Try it: a beep.**
> ```js
> const osc = ctx.createOscillator();      // generates a sine wave
> osc.frequency.value = 440;               // A4
> const gain = ctx.createGain();
> gain.gain.value = 0.2;                   // 20% volume
> osc.connect(gain).connect(ctx.destination);
> osc.start();
> osc.stop(ctx.currentTime + 1);           // scheduled 1 s from now
> ```

### 5.2 `AudioBuffer`: raw samples in memory
An `AudioBuffer` is exactly the `(channels, samples)` float array from notebook 01, living in
the browser. `decodeAudioData` turns a FLAC/MP3 file into one:

```js
const res = await fetch(url);
const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
buffer.numberOfChannels;      // 2
buffer.getChannelData(0);     // Float32Array of the left channel, values in [-1, 1]
```

> **Try it: make a sound from raw samples**, the same maths as the notebook.
> ```js
> const sr = ctx.sampleRate;
> const buf = ctx.createBuffer(1, sr * 2, sr);        // 1 channel, 2 seconds
> const data = buf.getChannelData(0);
> for (let i = 0; i < data.length; i++) {
>   data[i] = 0.2 * Math.sin(2 * Math.PI * 220 * i / sr);   // 220 Hz sine
> }
> const src = ctx.createBufferSource();
> src.buffer = buf;
> src.connect(ctx.destination);
> src.start();
> ```

### 5.3 `AudioBufferSourceNode`: play a buffer once
Important quirk: **a source node can only be started once.** To pause and resume, or to seek,
you throw the old nodes away and create new ones starting at the new position:

```js
source.start(when, offset);
//          │      └─ where in the buffer to start (seconds into the song)
//          └─ when to start, on the ctx.currentTime clock
```
That's why `MixEngine.play()` builds a fresh set of sources every time, and why the engine
tracks the song position itself:

```
position = offset + (ctx.currentTime − startedAt)
```

### 5.4 `GainNode`: volume, including negative volume
A gain node multiplies every sample by `gain.value`:
- `1` = unchanged, `0.5` ≈ −6 dB, `0` = silence
- **`−1` = flipped upside down** (phase-inverted). This is what makes "subtract a stem" possible.

### 5.5 Why alignment matters: sample-accurate starts
If you play a signal and its upside-down copy at **exactly** the same time, they cancel to
silence. Start them **slightly** apart and you get a hollow, "phasey" sound instead. That's
the comb filtering you'd hear from misaligned stems.

> **Try it: cancellation, then misalignment.**
> ```js
> // 2 s of white noise (a stand-in for a dense music mix)
> const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
> const nd = noise.getChannelData(0);
> for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * 0.2;
>
> function play(buffer, gainValue, when) {
>   const s = ctx.createBufferSource();
>   s.buffer = buffer;
>   const g = ctx.createGain();
>   g.gain.value = gainValue;
>   s.connect(g).connect(ctx.destination);
>   s.start(when);
> }
>
> let t = ctx.currentTime + 0.1;
> play(noise, 1, t); play(noise, -1, t);            // aligned → silence
> ```
> ```js
> t = ctx.currentTime + 0.1;
> play(noise, 1, t); play(noise, -1, t + 0.001);    // 1 ms apart → hollow, "jet-plane" sound
> ```

This is why:
- the engine starts **every** track at the same scheduled time (`START_DELAY_S` ahead, so they
  all make it), and
- the backend saves **FLAC**, which has no encoder delay. MP3 adds padding at the start, so
  stems would be offset by a few milliseconds, exactly the second experiment.

### 5.6 Clicks, and `setTargetAtTime`
A sudden jump in volume is a sudden jump in the waveform. From the notebook's Fourier
section: a sharp edge contains **every frequency**, so you hear a click. The fix is to glide
to the new value over a few milliseconds:

```ts
gain.gain.setTargetAtTime(target, ctx.currentTime, 0.015);  // ~15 ms glide
```

> **Try it: click vs. no click.**
> ```js
> const o = ctx.createOscillator();
> const g = ctx.createGain();
> g.gain.value = 0.3;
> o.connect(g).connect(ctx.destination);
> o.start();
> setTimeout(() => { g.gain.value = 0; }, 1000);                               // abrupt → click
> setTimeout(() => { g.gain.setTargetAtTime(0.3, ctx.currentTime, 0.015); }, 2000); // smooth
> setTimeout(() => { g.gain.setTargetAtTime(0, ctx.currentTime, 0.015); o.stop(ctx.currentTime + 0.2); }, 3000);
> ```

### 5.7 The app's graph
```
source(mixture) ─▶ gain ─┐
source(vocals)  ─▶ gain ─┤
source(drums)   ─▶ gain ─┼─▶ master gain ─▶ speakers
source(bass)    ─▶ gain ─┤
...                      ┘
```
Read `MixEngine.ts` now: `load()` builds the gain nodes, `play()` creates and schedules the
sources, `setWeights()` glides each gain to its new value.

---

## 6. The remix maths

From the Milestone 1 discussion: **adding all the stems back together sounds worse than the
original**, because every stem's small errors add up. So the mixer never rebuilds the song from
stems. It plays the **original** and adds **corrections**.

Let `g_i` be the volume you choose for stem *i* (1 = untouched, 0 = muted):

$$\text{output} = \text{mixture} + \sum_i (g_i - 1)\cdot \text{stem}_i$$

| Your action | Mixture gain | Stem gain sent to the graph | Result |
|---|---|---|---|
| nothing | 1 | every stem 0 | the original, bit-for-bit |
| mute vocals | 1 | vocals **−1** | original − vocals |
| drums at 150 % | 1 | drums **+0.5** | original + half more drums |
| vocals at 50 % | 1 | vocals **−0.5** | original with quieter vocals |

**Solo is different.** "Solo vocals" should sound like the vocal stem *alone*. The remix formula
would leave in the residual (`mixture − Σ stems`): the reverb and artifacts no stem captured.
So when anything is soloed, the app switches to plain stems:

$$\text{output} = \sum_i g_i \cdot \text{stem}_i \quad (\text{mixture gain} = 0)$$

All of this is the pure function `trackWeights()` in [mixing.ts](../frontend/src/audio/mixing.ts).
It's pure (no audio, no React), so it's easy to test.

> **Try it** (Node 22+ can run TypeScript directly):
> ```bash
> cd frontend
> node --input-type=module -e '
> import { trackWeights, DEFAULT_TRACK } from "./src/audio/mixing.ts";
> const s = { vocals: { ...DEFAULT_TRACK, muted: true }, drums: { ...DEFAULT_TRACK } };
> console.log(trackWeights(s));'
> ```
> Predict the output before you run it. Then try soloing drums.

---

## 7. Drawing waveforms

### 7.1 Too many samples to draw: peaks
A 5-minute song has 13 million samples per channel, but the screen is about 1,000 pixels wide.
[peaks.ts](../frontend/src/audio/peaks.ts) splits the song into 2,000 buckets and keeps each
bucket's **min and max**. When drawing, each pixel column draws a vertical line from min to max.
That's how every audio editor draws waveforms.

### 7.2 Canvas and sharp lines on high-resolution screens
A Retina screen has 2 physical pixels per CSS pixel (`window.devicePixelRatio`). If the canvas
is 800 pixels wide but displayed at 800 CSS pixels, it gets stretched and looks blurry. So
`Waveform.tsx` sets:
```ts
canvas.width = cssWidth * devicePixelRatio;   // real pixels
canvas.style.width = `${cssWidth}px`;          // displayed size
```
A `ResizeObserver` redraws when the layout width changes.

### 7.3 Smooth 60 fps playhead without redrawing
- `requestAnimationFrame` calls a function before each screen refresh, about 60 times a
  second. `Mixer` uses it to read `engine.position()` into state while playing.
- Redrawing 7 canvases 60 times a second would be wasteful. So the **canvas is drawn once**,
  and the moving parts (playhead line and "played" shading) are plain `<div>`s whose CSS
  `left`/`width` change. That's cheap for the browser.

General lesson: **separate what changes often from what's expensive to draw.**

---

## 8. Performance and memory

Decoded audio is big. Using the notebook's maths:

```
5 min × 60 s × 44,100 samples/s × 2 channels × 4 bytes (float32) ≈ 106 MB per track
× 7 tracks (6 stems + mixture) ≈ 740 MB
```

That's acceptable on a laptop for an MVP. Real products reduce it by:
- **streaming** (e.g. `<audio>` elements with `MediaElementAudioSourceNode`), which makes
  keeping tracks in sync much harder;
- loading **shorter chunks** on demand;
- using **AudioWorklet** for custom low-level processing.

Also note what *doesn't* cause re-renders: the engine lives in a ref, and the waveform
canvas only redraws when its data or size changes.

---

## 9. Exercises
Ordered roughly by difficulty. Each one teaches something new.

1. **Keyboard shortcuts:** `1`–`6` toggle mute on each stem, `←`/`→` seek ±5 s.
   *(Events, state updates.)*
2. **Upload progress bar:** `fetch` can't report upload progress; rewrite `createJob` with
   `XMLHttpRequest` and its `upload.onprogress` event. *(Browser APIs.)*
3. **Level meters:** add an `AnalyserNode` after each stem's gain and draw its loudness with
   `getFloatTimeDomainData`. *(Audio graph, animation.)*
4. **Loop a region:** drag on the overview waveform to select a section; use
   `source.loop`, `loopStart`, `loopEnd`. *(Pointer events, Web Audio.)*
5. **Export your mix (preview of Milestone 4):** render the current settings with an
   `OfflineAudioContext` (same graph, renders faster than real time), then save the result as a
   WAV download. *(Offline rendering, binary file formats.)*
6. **Tests:** add Vitest and write unit tests for `trackWeights` and `computePeaks`. *(Testing.)*

---

## 10. Check yourself
<details>
<summary>Why does the engine create new source nodes on every play and seek?</summary>

`AudioBufferSourceNode` can only be started once. Pausing means stopping it for good; resuming
or seeking means new nodes started at a new `offset`.
</details>

<details>
<summary>Why does muting a stem send gain −1 instead of 0?</summary>

The mixture already contains the stem. Output = mixture + (0 − 1)·stem = mixture − stem.
A gain of 0 on the stem node would leave the original unchanged.
</details>

<details>
<summary>What would you hear if one stem started 2 ms late?</summary>

A hollow, phasey (comb-filtered) sound wherever that stem is being changed, because the
subtraction no longer lines up sample for sample. See experiment 5.5.
</details>

<details>
<summary>Why is the engine in a <code>useRef</code> and not <code>useState</code>?</summary>

It's a long-lived object whose changes shouldn't re-render the UI, and it must survive
re-renders. State is for values the screen displays.
</details>

<details>
<summary>Why do effects run twice in development?</summary>

StrictMode mounts, unmounts and re-mounts components to reveal effects that don't clean up
properly. Production runs them once.
</details>

<details>
<summary>Why is the playhead a div instead of being drawn on the canvas?</summary>

Moving a div is cheap; redrawing a full waveform 60 times a second for every track is not.
</details>

---

## 11. Resources
- **Web Audio:** MDN's *Web Audio API* guide and *Basic concepts behind Web Audio API*
  (developer.mozilla.org); the specification at webaudio.github.io/web-audio-api.
- **React:** react.dev → *Learn* (especially *Synchronizing with Effects* and
  *Referencing values with refs*). *You Might Not Need an Effect* is worth reading twice.
- **TypeScript:** the *TypeScript Handbook* (typescriptlang.org/docs).
- **Vite:** vite.dev → *Guide*.
- **Canvas:** MDN *Canvas tutorial*.

**Next (Milestone 4):** studio features — tempo and pitch change, key/BPM detection, and
exporting your custom mix.
