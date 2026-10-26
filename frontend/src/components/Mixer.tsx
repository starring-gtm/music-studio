import { useCallback, useEffect, useRef, useState } from "react";
import type { Job } from "../api";
import { MixEngine } from "../audio/MixEngine";
import { DEFAULT_TRACK, MIXTURE, trackWeights, type TrackSettings } from "../audio/mixing";
import { encodeWav } from "../audio/dsp/wav.ts";
import { computePeaks } from "../audio/peaks";
import { formatSemitones } from "../music";
import StudioControls from "./StudioControls";
import TrackRow from "./TrackRow";
import Waveform from "./Waveform";

const STEM_COLORS: Record<string, string> = {
  vocals: "#f472b6",
  drums: "#fb923c",
  bass: "#a78bfa",
  guitar: "#34d399",
  piano: "#60a5fa",
  other: "#facc15",
};
const FALLBACK_COLOR = "#94a3b8";

type LoadState =
  | { kind: "loading"; loaded: number; total: number }
  | { kind: "ready" }
  | { kind: "error"; message: string };

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function exportFilename(original: string | null, tempo: number, semitones: number): string {
  const base = (original ?? "song").replace(/\.[^.]+$/, "");
  const changes = [
    tempo !== 1 ? `${Math.round(tempo * 100)}pct` : "",
    semitones !== 0 ? `${formatSemitones(semitones)}st` : "",
  ].filter(Boolean);
  return `${base}-mix${changes.length ? `-${changes.join("-")}` : ""}.wav`;
}

function defaultSettings(sources: string[]): Record<string, TrackSettings> {
  return Object.fromEntries(sources.map((name) => [name, { ...DEFAULT_TRACK }]));
}

export default function Mixer({ job, onNewSong }: { job: Job; onNewSong: () => void }) {
  const sources = job.sources ?? [];
  const engineRef = useRef<MixEngine | null>(null);
  const [load, setLoad] = useState<LoadState>({ kind: "loading", loaded: 0, total: sources.length + 1 });
  const [peaks, setPeaks] = useState<Record<string, Float32Array>>({});
  const [settings, setSettings] = useState(() => defaultSettings(sources));
  const [masterVolume, setMasterVolume] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(job.duration_s ?? 0);
  const [tempo, setTempo] = useState(1);
  const [semitones, setSemitones] = useState(0);
  const [canShiftPitch, setCanShiftPitch] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Create the engine and load every track once per job.
  useEffect(() => {
    const engine = new MixEngine(job.samplerate);
    const controller = new AbortController();
    engineRef.current = engine;
    engine.onEnded = () => {
      setPlaying(false);
      setPosition(0);
    };

    const tracks: Record<string, string> = { [MIXTURE]: job.mixture!, ...job.stems };
    engine
      .load(tracks, (loaded, total) => setLoad({ kind: "loading", loaded, total }), controller.signal)
      .then(() => {
        const next: Record<string, Float32Array> = {};
        for (const name of Object.keys(tracks)) next[name] = computePeaks(engine.buffer(name)!);
        setPeaks(next);
        setDuration(engine.duration);
        setCanShiftPitch(engine.canShiftPitch);
        setLoad({ kind: "ready" });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setLoad({ kind: "error", message: String(e) });
      });

    return () => {
      controller.abort();
      engine.dispose();
      engineRef.current = null;
    };
  }, [job]);

  // Push mixer settings into the audio graph.
  useEffect(() => {
    if (load.kind === "ready") engineRef.current?.setWeights(trackWeights(settings));
  }, [settings, load.kind]);

  useEffect(() => {
    engineRef.current?.setMasterVolume(masterVolume);
  }, [masterVolume]);

  useEffect(() => {
    if (load.kind === "ready") engineRef.current?.setTempo(tempo);
  }, [tempo, load.kind]);

  useEffect(() => {
    if (load.kind === "ready") engineRef.current?.setSemitones(semitones);
  }, [semitones, load.kind]);

  function resetAll() {
    setSettings(defaultSettings(sources));
    setMasterVolume(1);
    setTempo(1);
    setSemitones(0);
  }

  async function exportMix() {
    const engine = engineRef.current;
    if (!engine) return;
    setExporting(true);
    setExportError(null);
    try {
      const { channels, sampleRate } = await engine.render(trackWeights(settings), masterVolume);
      const url = URL.createObjectURL(new Blob([encodeWav(channels, sampleRate)], { type: "audio/wav" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFilename(job.filename, tempo, semitones);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setExportError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  // Move the playhead while playing.
  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function tick() {
      setPosition(engineRef.current?.position() ?? 0);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const togglePlay = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.isPlaying) {
      engine.pause();
      setPosition(engine.position());
      setPlaying(false);
    } else {
      await engine.play();
      setPlaying(true);
    }
  }, []);

  const seek = useCallback(
    (fraction: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.seek(fraction * engine.duration);
      setPosition(engine.position());
    },
    [],
  );

  // Space bar toggles playback (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      if (load.kind === "ready") void togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, load.kind]);

  function updateTrack(name: string, patch: Partial<TrackSettings>) {
    setSettings((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  }

  const anySolo = Object.values(settings).some((s) => s.solo);
  const isAudible = (s: TrackSettings) => !s.muted && s.volume > 0 && (!anySolo || s.solo);
  const progress = duration > 0 ? position / duration : 0;

  return (
    <div className="panel mixer">
      <div className="mixer-header">
        <div>
          <h2>{job.filename}</h2>
          <p className="muted">
            {job.model} · {formatTime(job.duration_s ?? duration)}
            {job.bpm ? ` · ${job.bpm} BPM` : ""}
            {job.key ? ` · ${job.key}` : ""} · separated in {job.separation_s}s on {job.device}
          </p>
        </div>
        <div className="mixer-actions">
          <a className="button" href={job.zip} download="stems.zip">
            Download all stems
          </a>
          <button onClick={onNewSong}>New song</button>
        </div>
      </div>

      {load.kind === "loading" && (
        <p className="muted">
          Loading tracks {load.loaded}/{load.total}…
        </p>
      )}
      {load.kind === "error" && <p className="error">{load.message}</p>}

      {load.kind === "ready" && (
        <>
          <div className="transport">
            <button className="primary play" onClick={() => void togglePlay()}>
              {playing ? "Pause" : "Play"}
            </button>
            <span className="time">
              {formatTime(position)} / {formatTime(duration)}
            </span>
            <label className="volume master">
              Master
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.01}
                value={masterVolume}
                onChange={(e) => setMasterVolume(Number(e.target.value))}
              />
            </label>
            <button onClick={resetAll}>Reset</button>
            <button onClick={() => void exportMix()} disabled={exporting}>
              {exporting ? "Rendering…" : "Export mix (.wav)"}
            </button>
          </div>
          {exportError && <p className="error">{exportError}</p>}

          <StudioControls
            tempo={tempo}
            semitones={semitones}
            bpm={job.bpm}
            songKey={job.key}
            canShiftPitch={canShiftPitch}
            onTempo={setTempo}
            onSemitones={setSemitones}
          />

          <p className="mode muted">
            {anySolo
              ? "Solo: playing only the soloed stems."
              : "Remix: original song ± your changes, so untouched stems sound exactly like the original."}
          </p>

          <div className="overview">
            <span className="track-name">original</span>
            <Waveform peaks={peaks[MIXTURE]} progress={progress} color="#64748b" height={40} onSeek={seek} />
          </div>

          <div className="tracks">
            {sources.map((name) => (
              <TrackRow
                key={name}
                name={name}
                color={STEM_COLORS[name] ?? FALLBACK_COLOR}
                peaks={peaks[name]}
                settings={settings[name]}
                audible={isAudible(settings[name])}
                progress={progress}
                downloadUrl={job.stems![name]}
                onChange={(patch) => updateTrack(name, patch)}
                onSeek={seek}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
