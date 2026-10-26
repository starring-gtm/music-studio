import { useEffect, useState } from "react";
import { getJob, isTerminal, type Job } from "./api";

const POLL_MS = 1500;

/** Poll a job until it finishes or fails. */
export function useJob(id: string): { job: Job | null; error: string | null } {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;

    async function poll() {
      try {
        const next = await getJob(id, controller.signal);
        setJob(next);
        setError(null);
        if (!isTerminal(next.status)) timer = window.setTimeout(poll, POLL_MS);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        // A 404 won't fix itself; anything else (e.g. API restarting) is worth retrying.
        if (!String(e).includes("not found")) timer = window.setTimeout(poll, POLL_MS * 2);
      }
    }

    setJob(null);
    poll();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [id]);

  return { job, error };
}
