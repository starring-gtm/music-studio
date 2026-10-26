"""RQ job that turns an uploaded song into stems.

Layout of a job directory:
    data/jobs/<id>/input.<ext>       the upload
    data/jobs/<id>/stems/<name>.flac  one file per source, plus mixture.flac

Stems are written to stems.tmp/ and renamed when complete, so stems/ only
ever exists in a finished state.
"""
import shutil
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from rq import get_current_job

from . import config
from .analysis import analyze
from .separation import decode_audio, load_model, pick_device, separate


def _set_stage(stage: str, **extra) -> None:
    """Record progress in the job's meta so the API can report it."""
    job = get_current_job()
    if job is None:
        return
    job.meta.update(stage=stage, **extra)
    job.save_meta()


def _write_flac(path: Path, audio: np.ndarray, samplerate: int) -> None:
    # FLAC is lossless and has no encoder delay, so every stem stays sample-aligned
    # with the mixture (important for remixing: mixture + (gain - 1) * stem).
    sf.write(path, np.clip(audio, -1.0, 1.0).T, samplerate, format="FLAC", subtype="PCM_16")


def separate_job(job_dir: str, model_name: str) -> dict:
    try:
        return _run(Path(job_dir), model_name)
    except Exception as e:
        _set_stage("failed", error=str(e))
        raise


def _run(job_dir: Path, model_name: str) -> dict:
    input_path = next(job_dir.glob("input.*"))

    _set_stage("loading_model")
    model = load_model(model_name)

    _set_stage("decoding")
    audio = decode_audio(input_path, model.samplerate, model.audio_channels)
    duration = audio.shape[1] / model.samplerate
    if duration == 0:
        raise ValueError("file contains no audio")
    if duration > config.MAX_DURATION_S:
        raise ValueError(f"song is {duration:.0f}s long; the limit is {config.MAX_DURATION_S:.0f}s")

    device = pick_device(config.DEVICE)
    _set_stage("separating", duration_s=round(duration, 2), device=device)
    started = time.time()
    stems = separate(torch.from_numpy(audio), model, device)
    separation_s = time.time() - started

    _set_stage("analyzing")
    try:
        analysis = analyze(audio, stems, model.samplerate)
    except Exception as e:  # nice-to-have: never fail the whole job over it
        print(f"analysis failed: {e}")
        analysis = {}

    _set_stage("encoding")
    tmp_dir = job_dir / "stems.tmp"
    shutil.rmtree(tmp_dir, ignore_errors=True)
    tmp_dir.mkdir()
    _write_flac(tmp_dir / "mixture.flac", audio, model.samplerate)
    for name, stem in stems.items():
        _write_flac(tmp_dir / f"{name}.flac", stem, model.samplerate)
    tmp_dir.rename(job_dir / "stems")

    _set_stage("done")
    return {
        "model": model_name,
        "sources": list(stems),
        "samplerate": model.samplerate,
        "duration_s": round(duration, 2),
        "separation_s": round(separation_s, 2),
        "device": device,
        **analysis,
    }
