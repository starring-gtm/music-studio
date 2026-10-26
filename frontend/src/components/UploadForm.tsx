import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { createJob, MODELS, type ModelName } from "../api";

const MODEL_LABELS: Record<ModelName, string> = {
  htdemucs_6s: "6 stems: vocals, drums, bass, guitar, piano, other",
  htdemucs: "4 stems: vocals, drums, bass, other (fast)",
  htdemucs_ft: "4 stems, fine-tuned (best quality, ~4× slower)",
};

const ACCEPT = ".mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.aiff,.aif";

export default function UploadForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [model, setModel] = useState<ModelName>("htdemucs_6s");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await createJob(file, model));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form className="panel upload" onSubmit={onSubmit}>
      <h1>Split a song into stems</h1>

      <div
        className={`dropzone${dragging ? " dragging" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {file ? (
          <>
            <strong>{file.name}</strong>
            <span>{(file.size / 1024 / 1024).toFixed(1)} MB · click to change</span>
          </>
        ) : (
          <>
            <strong>Drop an audio file here</strong>
            <span>or click to browse · mp3, wav, flac, m4a, ogg</span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <fieldset className="models">
        <legend>Model</legend>
        {MODELS.map((m) => (
          <label key={m}>
            <input type="radio" name="model" checked={model === m} onChange={() => setModel(m)} />
            <code>{m}</code> <span>{MODEL_LABELS[m]}</span>
          </label>
        ))}
      </fieldset>

      {error && <p className="error">{error}</p>}

      <button className="primary" type="submit" disabled={!file || busy}>
        {busy ? "Uploading…" : "Separate"}
      </button>
    </form>
  );
}
