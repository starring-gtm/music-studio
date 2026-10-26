# Milestone 4 — Studio features: tempo, key, pitch and export

Milestone 4 adds four features:

| Feature | Where it runs | Main idea |
|---|---|---|
| **BPM detection** | worker (Python, librosa) | onset strength → periodicity → beat tracking |
| **Key detection** | worker (Python, librosa) | chroma features + key profiles + correlation |
| **Tempo and pitch change** | browser (AudioWorklet) | playback rate + a **phase vocoder** you wrote yourself |
| **Export your mix** | browser (OfflineAudioContext) | render the same audio graph faster than real time, then write a WAV file |

It builds directly on notebook 01 (samples, FFT, STFT, magnitude/phase) and guide 03 (Web
Audio graph, remix maths).

**Run it:** restart the worker (`python worker.py`) so it picks up the new analysis code, then
separate a new song. Songs separated before this milestone still play, but show no BPM or key.

**New and changed files**

| File | What it does |
|---|---|
| [backend/app/analysis.py](../backend/app/analysis.py) | `detect_bpm`, `detect_key`, `analyze` |
| [backend/app/tasks.py](../backend/app/tasks.py) | new `analyzing` stage; BPM and key are added to the job result |
| [frontend/src/audio/dsp/fft.ts](../frontend/src/audio/dsp/fft.ts) | FFT written from scratch |
| [frontend/src/audio/dsp/pitchShifter.ts](../frontend/src/audio/dsp/pitchShifter.ts) | streaming phase-vocoder pitch shifter |
| [frontend/src/audio/pitchShift.worklet.ts](../frontend/src/audio/pitchShift.worklet.ts) | runs the shifter on the audio thread |
| [frontend/src/audio/MixEngine.ts](../frontend/src/audio/MixEngine.ts) | `setTempo`, `setSemitones`, `render` |
| [frontend/src/audio/dsp/wav.ts](../frontend/src/audio/dsp/wav.ts) | WAV file encoder |
| [frontend/src/components/StudioControls.tsx](../frontend/src/components/StudioControls.tsx) | tempo slider, pitch stepper, key display |
| [frontend/scripts/test-dsp.ts](../frontend/scripts/test-dsp.ts) | tests for the FFT, shifter and WAV encoder (`node scripts/test-dsp.ts`) |

---

## 1. Tempo (BPM) detection

### How it works
1. **Onset strength.** Compute a spectrogram and measure, frame by frame, how much energy
   *suddenly increased* (spectral flux). Drum hits, plucks and consonants produce peaks. The result
   is a 1-D curve, the "onset envelope", that spikes on every hit.
2. **Find the periodicity.** A steady beat makes that curve repeat. Autocorrelating it (comparing
   the curve with a shifted copy of itself) shows strong matches at the beat period. 120 BPM =
   one beat every 0.5 s.
3. **Track the beats.** `librosa.beat.beat_track` uses dynamic programming to pick beat times
   that sit on strong onsets **and** stay evenly spaced (Ellis, 2007).

### Why use the drums stem
On the full mix, sustained vocals, pads and reverb smear the onset envelope. The drums stem is
mostly sharp hits, so the periodicity is much clearer. Separation makes analysis easier.

### Known limitations
- **Octave errors:** 70 vs 140 BPM is often ambiguous, even to people. Both fit the same hits.
- **Resolution:** the tempo is measured in whole analysis frames (512 samples at 22,050 Hz ≈
  23 ms), so a click track at exactly 128 BPM measures as 129.2.
- **Tempo changes:** a single number assumes a steady tempo. Songs that speed up get an average.

> **Try it** (in a notebook, with a separated job's stems):
> ```python
> import librosa, numpy as np, soundfile as sf, matplotlib.pyplot as plt
> drums, sr = sf.read("data/jobs/<id>/stems/drums.flac")
> y = librosa.to_mono(drums.T)
> env = librosa.onset.onset_strength(y=y, sr=sr)
> tempo, beats = librosa.beat.beat_track(onset_envelope=env, sr=sr)
> t = librosa.times_like(env, sr=sr)
> plt.figure(figsize=(12, 3)); plt.plot(t, env)
> plt.vlines(librosa.frames_to_time(beats, sr=sr), 0, env.max(), color="r", alpha=0.4)
> plt.xlim(10, 20); plt.title(f"onset envelope + beats, {float(np.atleast_1d(tempo)[0]):.1f} BPM")
> ```
> Then try it on `mixture.flac` and compare the two envelopes.

---

## 2. Key detection

### Chroma: folding the spectrum into 12 notes
Western music uses 12 pitch classes: C, C#, D … B. A **chroma** feature takes the spectrum and
adds up the energy of every octave of each note. All the Cs (C2, C3, C4 …) go into one bin, all
the C#s into the next, and so on. Each frame becomes a 12-number vector: "how much C, how much
C# …". `chroma_cqt` uses a constant-Q transform, which has bins spaced like musical notes
rather than evenly in Hz.

Averaged over the whole song, the chroma says which notes the song uses most.

### Key profiles
Krumhansl and Kessler asked listeners how well each note "fits" after hearing a key. The
result is a 12-number profile per mode:

```
C major:  C    C#   D    D#   E    F    F#   G    G#   A    A#   B
          6.35 2.23 3.48 2.33 4.38 4.09 2.52 5.19 2.39 3.66 2.29 2.88
          ▲tonic         ▲3rd      ▲4th      ▲5th
```

### Matching
Rotate the major and minor profiles to all 12 tonics (24 candidate keys). Compute the
**correlation** of each with the song's average chroma. The best match wins, and its
correlation is the `key_confidence`.

The analysis uses **mixture − drums**, because drums spread noise across every pitch class.

### Known limitations
- **Relative keys:** C major and A minor use exactly the same notes, so they're often confused.
  Real detectors add more context: bass notes, chord progressions, the final chord.
- **Modulation:** a song that changes key gets one averaged answer.
- **Tuning:** a band tuned slightly flat smears energy between neighbouring bins
  (`librosa.estimate_tuning` can correct it).

> **Try it:** `librosa.display.specshow(librosa.feature.chroma_cqt(y=y, sr=sr), y_axis="chroma", x_axis="time")`
> on the `other` or `vocals` stem. You can often read the melody's notes directly.

---

## 3. Tempo vs pitch: why they're tied, and how to untie them

### The record-player problem
Play a record faster and it also sounds higher. Web Audio's `playbackRate` does the same: at
1.1 every sample is consumed 10% faster, so every frequency is 10% higher. That's resampling,
and it changes **both** time and pitch.

### Semitone maths
In equal temperament, an octave doubles the frequency and is split into 12 equal steps:

$$\text{ratio} = 2^{\text{semitones}/12} \qquad 1\ \text{semitone} \approx \times 1.0595$$

| Shift | Ratio |
|---|---|
| +12 (octave up) | 2.0 |
| +7 (fifth) | 1.498 |
| +2 | 1.122 |
| −12 | 0.5 |

### The design
```
sources (playbackRate = tempo)  →  remix gains  →  master  →  pitch shifter (× 2^(s/12) / tempo)  →  🔊
```
- **Tempo** is set as each source's `playbackRate`. Cheap, sample-accurate, and every track
  changes together.
- That also scales pitch by `tempo`, so the pitch shifter multiplies by `1/tempo` to undo it,
  then by `2^(s/12)` for the transposition you asked for:

$$\text{shifter ratio} = \frac{2^{s/12}}{\text{tempo}}$$

- **Why one shifter after the mix, not one per stem:** remix mode relies on `mixture − vocals`
  cancelling exactly (guide 03, §5.5). A phase vocoder isn't linear: shifting the vocal and the
  mixture separately and then subtracting would no longer cancel. Mixing first and shifting once
  keeps the cancellation exact. It's also 7× cheaper.
- **Ratio exactly 1** (no tempo or pitch change) bypasses the shifter entirely, so the default
  playback is bit-for-bit untouched.

---

## 4. The phase vocoder

[pitchShifter.ts](../frontend/src/audio/dsp/pitchShifter.ts) is the core of this milestone. It
follows Stephan Bernsee's classic `smbPitchShift`. Everything it does is the STFT from
notebook 01, run in a streaming loop.

### 4.1 The loop
Audio arrives in small blocks. The shifter collects samples into a 2048-sample frame and, every
**hop** of 512 samples (75% overlap), processes one frame:

```
input → [window → FFT → analyse → move bins → resynthesise → inverse FFT → window] → overlap-add → output
```

### 4.2 The key insight: phase gives you the *exact* frequency
An FFT bin is about 21.5 Hz wide (notebook 01). A note at 440 Hz lands in bin 20 (centre
430.7 Hz). The magnitude alone can't tell 435 Hz from 440 Hz, but the **phase** can.

Between two frames 512 samples apart, a sinusoid at exactly the bin's centre frequency rotates
by a known amount (`k × 2π × hop / N`). If its phase rotated a bit *more*, its true frequency is a
bit higher. So for each bin:

```ts
let delta = phase - lastPhase[k] - k * expected;   // extra rotation beyond the bin centre
delta -= TWO_PI * Math.round(delta / TWO_PI);      // wrap into [-π, π]
anaFreq[k] = k + (delta * osamp) / TWO_PI;         // true frequency, in bins (e.g. 20.43)
```
This is why notebook 01 said "phase is needed to turn it back into audio". Here it's needed to
know what's really in the audio.

### 4.3 Shifting
Move each bin's energy to `k × ratio` and multiply its true frequency by `ratio`:
```ts
const target = Math.round(k * ratio);
synMag[target] += anaMag[k];
synFreq[target] = anaFreq[k] * ratio;
```

### 4.4 Resynthesis: phases must keep rotating
You can't reuse the original phases, because the frequencies changed. Each bin's phase is
**accumulated** at its new frequency, frame after frame (`sumPhase[k] += …`), so every shifted
partial keeps turning smoothly from one frame to the next. Then an inverse FFT and
**overlap-add** stitch the frames back together.

### 4.5 Two bugs found by the tests, and what they teach
The first version failed the "ratio 1 reproduces the input" test. A measurement script showed:

| | Expected | Measured | Why |
|---|---|---|---|
| gain | 1.0 | **1.5** | Each frame is windowed twice (analysis and synthesis). With 75% overlap, the squared Hann windows add up to 1.5, not 1. The fix divides by that sum (`olaGain`). |
| delay | 1536 samples | **2048** | A finished hop belongs to the *start* of the frame, which arrived a full frame ago. The real latency is the FFT size (46 ms). |

Overlap-add gain and latency are classic DSP pitfalls. Testing against a simple known signal,
like a sine wave, catches them immediately.

### 4.6 Quality and its limits
You'll hear the classic phase-vocoder artifacts on large shifts:
- **Phasiness / reverb-like smearing:** partials inside one bin interfere.
- **Soft transients:** drum hits get blurred across a 46 ms frame.
- **"Chipmunk" or "giant" voices:** shifting moves the **formants** (the vocal tract resonances)
  along with the pitch, so voices change character.

Better algorithms, worth knowing for interviews and later work:
- **Phase locking** (Laroche & Dolson): keep peak bins and their neighbours phase-coherent. A
  big quality jump for a small change.
- **Transient detection:** reset phases at drum hits to keep them sharp.
- **Rubber Band**, the library many DAWs use, which combines the above with formant preservation.
- **PSOLA:** time-domain, very good for single voices.
- **Neural pitch shifting:** state of the art, much heavier.

---

## 5. AudioWorklet: code on the audio thread

The shifter must run continuously, without gaps. The main thread, where React lives, can pause
for garbage collection or layout, and any pause would be a dropout. An **AudioWorklet** runs
your code on the browser's real-time audio thread.

```
main thread                                   audio thread
───────────                                   ────────────
ctx.audioWorklet.addModule(url)  ──loads──▶   registerProcessor("pitch-shift", PitchShiftProcessor)
new AudioWorkletNode(ctx, "pitch-shift")      process(inputs, outputs, parameters) every 128 samples
node.parameters.get("ratio")     ──AudioParam──▶ parameters.ratio[0]
node.port.postMessage("reset")   ──MessagePort──▶ port.onmessage
```

Rules of the audio thread:
- `process()` is called for every **128-sample block** (about 2.9 ms at 44.1 kHz). It must
  always finish in time.
- **Don't allocate memory in `process()`.** Garbage collection pauses cause glitches. The
  shifter allocates all its arrays once, in the constructor.
- **No DOM or `fetch`**: only computation. Talk to the main thread through `AudioParam`s
  (smooth numeric values) or the `port` (messages).
- Return `true` to keep the processor alive.

How fast is it? The benchmark processes 60 s of mono audio in about 0.7 s: **85× faster than real
time** per channel, so stereo playback uses only a few percent of one core.

**Vite detail:** `import url from "./pitchShift.worklet.ts?worker&url"` makes Vite bundle the
worklet and its imports (the FFT and the shifter) into a separate file, and gives you its URL for
`addModule`.

---

## 6. Exporting the mix

### 6.1 OfflineAudioContext
`OfflineAudioContext` has the same API as `AudioContext`, but it renders **into a buffer as fast as
the CPU allows** instead of playing in real time. `MixEngine.render()` builds the same graph
(sources at `tempo`, remix gains, master, pitch shifter), calls `startRendering()`, and gets an
`AudioBuffer` back. A 5-minute song renders in a few seconds.

Two details:
- **Length:** a song at tempo 1.25 lasts `duration / 1.25`.
- **Latency:** the shifter delays everything by 2048 samples, so the renderer renders 2048 extra
  samples and drops the first 2048. Otherwise the export would start with 46 ms of silence and
  lose its last 46 ms.

### 6.2 The WAV format
A WAV file is a 44-byte header followed by raw samples. [wav.ts](../frontend/src/audio/dsp/wav.ts)
writes it byte by byte with a `DataView`:

```
"RIFF" <file size − 8> "WAVE"
"fmt " 16  format=1(PCM)  channels  sampleRate  bytesPerSecond  blockAlign  bitsPerSample=16
"data" <data size>  L R L R L R …   (16-bit little-endian signed integers)
```
Floats in [−1, 1] become integers in [−32768, 32767], and anything louder is clipped.

### 6.3 Downloading a file the browser made
```ts
const url = URL.createObjectURL(new Blob([wavBytes], { type: "audio/wav" }));
const a = document.createElement("a");
a.href = url;
a.download = "song-mix-110pct-+2st.wav";
a.click();
URL.revokeObjectURL(url); // later, to free the memory
```

---

## 7. Testing DSP code

Audio code is hard to test by ear and easy to test with numbers. [scripts/test-dsp.ts](../frontend/scripts/test-dsp.ts) runs in plain Node (`node scripts/test-dsp.ts`):

| Test | What it proves |
|---|---|
| FFT on a cosine | energy lands in the right bin, and the inverse gives back the input |
| ratio 1 | the shifter is transparent: same signal, same gain, delayed by `latency` (> 40 dB SNR) |
| 440 Hz shifted by −12, −5, +2, +7, +12 semitones | the output frequency is within 0.5% of 440 × 2^(s/12) |
| WAV encoder | header fields, interleaving, conversion to integers and clipping |

The DSP lives in plain TypeScript files with no browser APIs (`dsp/`), which is what makes
them testable outside the browser. The worklet file is a thin wrapper around them.

---

## 8. Exercises
1. **Half/double-time buttons:** let the user correct an octave error (×2, ÷2 on the BPM).
2. **Metronome:** have the worker also return beat times (`librosa.frames_to_time(beats)`) and
   play a click on each beat with an `OscillatorNode`. Check whether the beats line up.
3. **Key-aware transposition:** add a "Transpose to…" dropdown that computes the semitones
   needed to reach a target key.
4. **Phase locking:** implement identity phase locking in `processFrame` (find spectral peaks, and give
   each bin near a peak the peak's phase rotation). Compare by ear at +7 semitones.
5. **Loop practice mode:** combine the loop region (guide 03, exercise 4) with tempo at 70%: the
   classic way musicians practise a hard passage.
6. **Server-side export:** add an API endpoint that renders the mix with Rubber Band
   (`pyrubberband`) and compare its quality with the browser's.

---

## 9. Check yourself
<details>
<summary>Why does setting playbackRate to 1.2 also raise the pitch?</summary>

Samples are read 20% faster, so every waveform's cycles pass 20% faster: every frequency is
×1.2. That's about +3.2 semitones (12·log2(1.2)).
</details>

<details>
<summary>With tempo 0.8 and +3 semitones, what ratio does the shifter use?</summary>

2^(3/12) / 0.8 ≈ 1.189 / 0.8 ≈ 1.487.
</details>

<details>
<summary>Why is the pitch shifter placed after the mix instead of on each stem?</summary>

Remix mode subtracts stems from the mixture, which only cancels if both go through identical
linear processing. A phase vocoder isn't linear, so it must come after the subtraction. It's also
cheaper: one shifter instead of seven.
</details>

<details>
<summary>How can the phase vocoder know a frequency more precisely than the bin width?</summary>

From how much each bin's phase rotated between frames, compared with what a sinusoid at the
bin's centre would do. The extra rotation gives the frequency offset.
</details>

<details>
<summary>Why must <code>process()</code> in an AudioWorklet avoid allocating memory?</summary>

Allocation can trigger garbage collection, which can pause the audio thread long enough to
miss the 128-sample deadline. That's an audible click or dropout.
</details>

<details>
<summary>Why does the key detector confuse C major and A minor?</summary>

They're relative keys with the same seven notes. The average chroma is nearly identical, and
only the emphasis on the tonic differs.
</details>

---

## 10. Resources
- **Beat tracking:** D. Ellis, *Beat Tracking by Dynamic Programming* (2007); librosa docs →
  *Onset detection* and *Beat and tempo*.
- **Key detection:** C. Krumhansl, *Cognitive Foundations of Musical Pitch*; the Temperley and
  Albrecht–Shanahan profiles as alternatives.
- **Phase vocoder:** S. Bernsee, *Pitch Shifting Using the Fourier Transform* (blog post with the
  original `smbPitchShift`); J. Laroche & M. Dolson, *Improved Phase Vocoder Time-Scale
  Modification of Audio* (1999).
- **Book:** Meinard Müller, *Fundamentals of Music Processing*. It covers chroma, tempo, beat
  tracking and more, with code (FMP notebooks, free online).
- **AudioWorklet:** MDN → *Using AudioWorklet*; Chrome Developers → *Audio Worklet design pattern*.

**Next (Milestone 5):** train your own separation model (a U-Net on spectrogram masks) and
compare it with Demucs.
