import { formatSemitones, transposeKey } from "../music";

const MAX_SEMITONES = 12;

interface Props {
  tempo: number;
  semitones: number;
  bpm?: number;
  songKey?: string;
  canShiftPitch: boolean;
  onTempo: (tempo: number) => void;
  onSemitones: (update: (semitones: number) => number) => void;
}

const clampSemitones = (s: number) => Math.max(-MAX_SEMITONES, Math.min(MAX_SEMITONES, s));

export default function StudioControls(props: Props) {
  const { tempo, semitones, bpm, songKey, canShiftPitch, onTempo, onSemitones } = props;
  return (
    <div className="studio">
      <label className="studio-control">
        <span className="studio-label">Tempo</span>
        <input
          type="range"
          min={0.5}
          max={1.5}
          step={0.01}
          value={tempo}
          onChange={(e) => onTempo(Number(e.target.value))}
          onDoubleClick={() => onTempo(1)}
          title="Double-click to reset"
        />
        <span className="studio-value">
          {Math.round(tempo * 100)}%
          {bpm ? <small>{(bpm * tempo).toFixed(1)} BPM</small> : null}
        </span>
      </label>

      <div className="studio-control">
        <span className="studio-label">Pitch</span>
        <div className="stepper">
          <button
            onClick={() => onSemitones((s) => clampSemitones(s - 1))}
            disabled={!canShiftPitch || semitones <= -MAX_SEMITONES}
          >
            −
          </button>
          <button onClick={() => onSemitones(() => 0)} disabled={!canShiftPitch || semitones === 0} title="Reset">
            {formatSemitones(semitones)} st
          </button>
          <button
            onClick={() => onSemitones((s) => clampSemitones(s + 1))}
            disabled={!canShiftPitch || semitones >= MAX_SEMITONES}
          >
            +
          </button>
        </div>
        <span className="studio-value">
          {songKey ? (
            <>
              {transposeKey(songKey, semitones)}
              {semitones !== 0 && <small>from {songKey}</small>}
            </>
          ) : (
            <small>key unknown</small>
          )}
        </span>
      </div>

      {!canShiftPitch && <p className="muted">This browser can't run the pitch shifter: tempo changes will also change pitch.</p>}
    </div>
  );
}
