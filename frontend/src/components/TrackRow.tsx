import type { TrackSettings } from "../audio/mixing";
import Waveform from "./Waveform";

interface Props {
  name: string;
  color: string;
  peaks: Float32Array;
  settings: TrackSettings;
  audible: boolean;
  progress: number;
  downloadUrl: string;
  onChange: (patch: Partial<TrackSettings>) => void;
  onSeek: (fraction: number) => void;
}

export default function TrackRow(props: Props) {
  const { name, color, peaks, settings, audible, progress, downloadUrl, onChange, onSeek } = props;
  return (
    <div className="track">
      <div className="track-controls">
        <span className="track-name" style={{ color }}>
          {name}
        </span>
        <div className="track-buttons">
          <button
            className={`toggle mute${settings.muted ? " on" : ""}`}
            title="Mute"
            onClick={() => onChange({ muted: !settings.muted })}
          >
            M
          </button>
          <button
            className={`toggle solo${settings.solo ? " on" : ""}`}
            title="Solo"
            onClick={() => onChange({ solo: !settings.solo })}
          >
            S
          </button>
          <a className="toggle" href={downloadUrl} download={`${name}.flac`} title={`Download ${name}.flac`}>
            ↓
          </a>
        </div>
        <label className="volume">
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={settings.volume}
            onChange={(e) => onChange({ volume: Number(e.target.value) })}
            onDoubleClick={() => onChange({ volume: 1 })}
            title="Double-click to reset"
          />
          <span>{Math.round(settings.volume * 100)}%</span>
        </label>
      </div>
      <Waveform peaks={peaks} progress={progress} color={color} dimmed={!audible} onSeek={onSeek} />
    </div>
  );
}
