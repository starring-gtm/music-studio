import { useEffect, useState } from "react";
import JobView from "./components/JobView";
import UploadForm from "./components/UploadForm";

// The current job lives in the URL (?job=<id>), so a refresh or a shared link
// reopens the same mixer.
function jobFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("job");
}

export default function App() {
  const [jobId, setJobId] = useState<string | null>(jobFromUrl);

  useEffect(() => {
    const onPopState = () => setJobId(jobFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function openJob(id: string | null) {
    window.history.pushState(null, "", id ? `?job=${id}` : window.location.pathname);
    setJobId(id);
  }

  return (
    <div className="app">
      <header className="app-header">
        <button className="logo" onClick={() => openJob(null)}>
          Music Studio
        </button>
        <span className="tagline">stem separation & mixer</span>
      </header>
      <main>
        {jobId ? (
          <JobView key={jobId} id={jobId} onNewSong={() => openJob(null)} />
        ) : (
          <UploadForm onCreated={openJob} />
        )}
      </main>
    </div>
  );
}
