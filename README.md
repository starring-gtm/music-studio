# Music Studio

A Moises-style music studio, built for learning. v1 extracts instrument stems
(vocals, drums, bass, guitar, piano, other) from a song.

## Milestone 1 — audio basics + Demucs

```bash
cd ~/Documents/Projects/music-studio
/opt/homebrew/bin/python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
jupyter lab notebooks/01_audio_basics_and_demucs.ipynb
```

Put any song at `audio/song.mp3` (mp3/wav/flac all work) before running the notebook.
Separated stems are written to `stems/<model>/`.

Notes
- Demucs downloads its pretrained weights (~80 MB per model) on first run.
- `ffmpeg` (already installed via Homebrew) lets librosa decode mp3.
- The optional SDR section downloads MUSDB18 7-second sample tracks.

## Milestone 2 — Backend (FastAPI + Redis/RQ worker)

```
client ──POST /api/jobs──▶ FastAPI ──enqueue──▶ Redis ──▶ worker.py (Demucs)
       ◀─GET /api/jobs/{id}─┘                              │
       ◀─────── stems/*.flac, stems.zip ◀── data/jobs/<id>/ ┘
```

Setup (once):

```bash
brew install redis
source .venv/bin/activate
pip install -r backend/requirements.txt
```

Run (three terminals, all with the venv active):

```bash
brew services start redis              # or: redis-server
cd backend && python worker.py         # loads Demucs, waits for jobs
cd backend && uvicorn app.main:app --reload
```

Try it: open http://localhost:8000/docs, or run `cd backend && scripts/smoke_test.sh`.

| Endpoint | What it does |
|---|---|
| `POST /api/jobs` | multipart `file` (+ optional `model`: htdemucs, htdemucs_6s, htdemucs_ft) → `202 {id}` |
| `GET /api/jobs/{id}` | `status` (queued/started/finished/failed), `stage`, queue `position`, and when finished: stem URLs, duration, timing |
| `GET /api/jobs/{id}/stems/{name}.flac` | one stem, or `mixture.flac` (the decoded original, sample-aligned with the stems) |
| `GET /api/jobs/{id}/stems.zip` | all stems |
| `GET /api/health` | Redis connectivity |

Settings are environment variables (see `backend/app/config.py`): `REDIS_URL`,
`DEMUCS_MODEL`, `DEMUCS_DEVICE`, `MAX_UPLOAD_MB` (50), `MAX_DURATION_S` (600), `CORS_ORIGINS`.

Design notes
- The API never imports torch; jobs are enqueued by name (`app.tasks.separate_job`).
- The worker uses RQ's `SimpleWorker` (no fork per job): the model stays loaded, and MPS works on macOS.
- Stems are FLAC: lossless, about half the size of WAV, and with no encoder delay, so
  `mixture + (gain − 1) × stem` remixes stay sample-aligned for the Milestone 3 mixer.

## Milestone 3 — Frontend (React + Web Audio mixer)

Setup (once) and run, with Redis, the worker and the API from Milestone 2 running:

```bash
cd frontend && npm install
cd frontend && npm run dev     # http://localhost:5173
```

Vite proxies `/api` to `localhost:8000`, so no CORS setup is needed in development.

**Learning guide:** [docs/03_frontend_mixer.md](docs/03_frontend_mixer.md) explains React, the Web Audio
API, the remix maths and waveform drawing, with console experiments and exercises.

Flow: upload → progress (polls `GET /api/jobs/{id}` every 1.5 s) → mixer. The job id is kept
in the URL (`?job=<id>`), so a refresh reopens the same mixer.

Mixer: play/pause (space bar), click any waveform to seek, per-stem mute / solo / volume
(0–150 %, double-click to reset), master volume, per-stem and zip downloads.

| File | Role |
|---|---|
| `src/audio/MixEngine.ts` | Web Audio graph: one `AudioBufferSourceNode` → `GainNode` per track, all started at the same `AudioContext` time so they stay sample-aligned |
| `src/audio/mixing.ts` | Turns mixer settings into gains: remix mode `mixture + Σ (g − 1)·stem`, solo mode `Σ g·stem` |
| `src/audio/peaks.ts` | Min/max summary of each track for drawing |
| `src/components/Waveform.tsx` | Canvas waveform; the playhead is a div so playback doesn't repaint the canvas |
| `src/components/Mixer.tsx` | Loads tracks, transport, settings → engine |
| `src/useJob.ts` | Polls a job until it finishes or fails |

Known limits: every track is decoded fully into memory (about 100 MB per track for a 5-minute
song, ~700 MB for 6 stems + mixture). Fine on a laptop; streaming playback is a later optimisation.

## Milestone 4 — Studio features

- **BPM and key** are detected in the worker after separation (`backend/app/analysis.py`): tempo from
  the drums stem, key from mixture − drums. They're shown in the mixer header.
- **Tempo** (50–150 %) and **pitch** (±12 semitones) change independently in real time: sources play
  at `playbackRate = tempo`, then one phase-vocoder pitch shifter (an AudioWorklet, written from
  scratch in `frontend/src/audio/dsp/`) corrects by `2^(semitones/12) / tempo`.
- **Export mix (.wav)** renders the current mix (stems, tempo, pitch, master) with an `OfflineAudioContext`.

Restart `python worker.py` after pulling these changes so new jobs get BPM and key.
DSP tests: `cd frontend && node scripts/test-dsp.ts`.

**Learning guide:** [docs/04_studio_features.md](docs/04_studio_features.md).

## Roadmap
1. Audio basics + run Demucs (this notebook)
2. Backend MVP — FastAPI + Redis worker running Demucs
3. Frontend MVP — React multitrack mixer (Web Audio API)
4. Studio features — tempo/pitch, key/BPM, export mix
5. Own model — U-Net spectrogram masking trained on MUSDB18
6. Deploy
