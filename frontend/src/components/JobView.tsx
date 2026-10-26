import { useEffect, useState } from "react";
import { useJob } from "../useJob";
import Mixer from "./Mixer";

const STAGE_LABELS: Record<string, string> = {
  queued: "Waiting in queue",
  loading_model: "Loading model",
  decoding: "Decoding audio",
  separating: "Separating stems",
  analyzing: "Detecting tempo and key",
  encoding: "Saving stems",
  done: "Done",
};

export default function JobView({ id, onNewSong }: { id: string; onNewSong: () => void }) {
  const { job, error } = useJob(id);
  const elapsed = useElapsedSeconds(job?.status !== "finished" && job?.status !== "failed");

  if (!job) {
    return (
      <div className="panel">
        {error ? <p className="error">{error}</p> : <p>Loading job…</p>}
        <button onClick={onNewSong}>Upload a new song</button>
      </div>
    );
  }

  if (job.status === "finished") {
    return <Mixer job={job} onNewSong={onNewSong} />;
  }

  if (job.status === "failed" || job.status === "stopped" || job.status === "canceled") {
    return (
      <div className="panel">
        <h2>{job.filename}</h2>
        <p className="error">Separation failed: {job.error ?? job.status}</p>
        <button onClick={onNewSong}>Try another song</button>
      </div>
    );
  }

  const stage = job.stage ?? job.status;
  return (
    <div className="panel progress">
      <h2>{job.filename}</h2>
      <div className="spinner" aria-hidden />
      <p className="stage">{STAGE_LABELS[stage] ?? stage}</p>
      <p className="muted">
        {job.status === "queued" && job.position != null && `Position in queue: ${job.position + 1} · `}
        {job.model} · {elapsed}s
      </p>
      {error && <p className="error">Connection problem: {error}. Retrying…</p>}
    </div>
  );
}

function useElapsedSeconds(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return seconds;
}
