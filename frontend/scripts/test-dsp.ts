// Tests for the DSP code. Node 22+ runs TypeScript directly:
//   node scripts/test-dsp.ts
import assert from "node:assert/strict";
import { FFT } from "../src/audio/dsp/fft.ts";
import { PitchShifter } from "../src/audio/dsp/pitchShifter.ts";
import { encodeWav } from "../src/audio/dsp/wav.ts";

const SR = 44100;

function sine(freq: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(SR * seconds));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}

/** Dominant frequency of a signal, via FFT peak + parabolic interpolation. */
function dominantFrequency(signal: Float32Array): number {
  const n = 8192;
  const fft = new FFT(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = signal[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  fft.transform(re, im);
  const mag = (k: number) => Math.log(Math.hypot(re[k], im[k]) + 1e-12);
  let peak = 1;
  for (let k = 2; k < n / 2; k++) if (mag(k) > mag(peak)) peak = k;
  const [a, b, c] = [mag(peak - 1), mag(peak), mag(peak + 1)];
  return ((peak + (0.5 * (a - c)) / (a - 2 * b + c)) * SR) / n;
}

function shift(input: Float32Array, ratio: number): Float32Array {
  const shifter = new PitchShifter();
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 128) {
    // feed 128-sample blocks, like an AudioWorklet does
    shifter.process(input.subarray(i, i + 128), output.subarray(i, i + 128), ratio);
  }
  return output;
}

const tests: Record<string, () => void> = {
  "FFT finds a pure tone in the right bin and inverts back"() {
    const n = 1024;
    const fft = new FFT(n);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 5 * i) / n);
    const original = re.slice();
    fft.transform(re, im);
    assert.ok(Math.abs(Math.hypot(re[5], im[5]) - n / 2) < 1e-6);
    assert.ok(Math.hypot(re[6], im[6]) < 1e-6);
    fft.transform(re, im, true);
    for (let i = 0; i < n; i++) assert.ok(Math.abs(re[i] / n - original[i]) < 1e-9);
  },

  "ratio 1 reproduces the input, delayed by the latency"() {
    const input = sine(440, 1);
    const output = shift(input, 1);
    const shifter = new PitchShifter();
    let err = 0;
    let sig = 0;
    for (let i = 10000; i < 40000; i++) {
      err += (output[i] - input[i - shifter.latency]) ** 2;
      sig += input[i - shifter.latency] ** 2;
    }
    const snr = 10 * Math.log10(sig / err);
    assert.ok(snr > 40, `SNR ${snr.toFixed(1)} dB`);
  },

  "shifts 440 Hz by semitones and octaves"() {
    for (const semitones of [-12, -5, 2, 7, 12]) {
      const ratio = 2 ** (semitones / 12);
      const output = shift(sine(440, 1), ratio);
      const got = dominantFrequency(output.subarray(20000));
      const want = 440 * ratio;
      assert.ok(Math.abs(got - want) / want < 0.005, `${semitones} st: got ${got.toFixed(1)} Hz, want ${want.toFixed(1)}`);
    }
  },

  "WAV header and samples"() {
    const left = new Float32Array([0, 0.5, -1, 2]); // 2 should clip to the max
    const right = new Float32Array([1, -0.5, 0, -2]);
    const view = new DataView(encodeWav([left, right], SR));
    const text = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(o + i)));
    assert.equal(text(0), "RIFF");
    assert.equal(text(8), "WAVE");
    assert.equal(view.getUint16(22, true), 2); // channels
    assert.equal(view.getUint32(24, true), SR);
    assert.equal(view.getUint32(40, true), 4 * 2 * 2); // 4 frames x 2 channels x 2 bytes
    const samples = Array.from({ length: 8 }, (_, i) => view.getInt16(44 + i * 2, true));
    assert.deepEqual(samples, [0, 32767, 16383, -16384, -32768, 0, 32767, -32768]);
  },
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try {
    test();
    console.log(`ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${e instanceof Error ? e.message : e}`);
  }
}
process.exit(failed ? 1 : 0);
