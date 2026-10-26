// Client for the FastAPI backend (backend/app/main.py). Paths are relative:
// the Vite dev server proxies /api to localhost:8000.

export const MODELS = ["htdemucs_6s", "htdemucs", "htdemucs_ft"] as const;
export type ModelName = (typeof MODELS)[number];

export type JobStatus =
  | "queued" | "started" | "deferred" | "scheduled"
  | "finished" | "failed" | "stopped" | "canceled" | "unknown";

export interface Job {
  id: string;
  status: JobStatus;
  stage: string | null;
  model: ModelName | null;
  filename: string | null;
  position?: number | null;
  error?: string;
  // present once status === "finished"
  sources?: string[];
  samplerate?: number;
  duration_s?: number;
  separation_s?: number;
  device?: string;
  bpm?: number; // jobs separated before Milestone 4 don't have these
  key?: string;
  key_confidence?: number;
  mixture?: string;
  stems?: Record<string, string>;
  zip?: string;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // not JSON
  }
  return `${res.status} ${res.statusText}`;
}

export async function createJob(file: File, model: ModelName): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("model", model);
  const res = await fetch("/api/jobs", { method: "POST", body: form });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).id;
}

export async function getJob(id: string, signal?: AbortSignal): Promise<Job> {
  const res = await fetch(`/api/jobs/${id}`, { signal });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export function isTerminal(status: JobStatus): boolean {
  return ["finished", "failed", "stopped", "canceled"].includes(status);
}
