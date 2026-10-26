"""Demucs stem separation — the same approach as notebooks/01, packaged for the worker."""
import subprocess
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model


def pick_device(preferred: str | None = None) -> str:
    if preferred:
        return preferred
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


@lru_cache(maxsize=2)
def load_model(name: str):
    """Load pretrained weights once per process (first call downloads them)."""
    model = get_model(name)
    model.eval()
    return model


def decode_audio(path: Path, samplerate: int, channels: int = 2) -> np.ndarray:
    """Decode any ffmpeg-readable file to float32 (channels, samples) at the given rate.

    ffmpeg also handles resampling and mono -> stereo upmixing.
    """
    cmd = [
        "ffmpeg", "-nostdin", "-v", "error", "-i", str(path),
        "-f", "f32le", "-acodec", "pcm_f32le", "-ac", str(channels), "-ar", str(samplerate), "-",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        err = proc.stderr.decode(errors="replace").strip()
        raise ValueError(f"could not decode audio: {err[-300:]}")
    audio = np.frombuffer(proc.stdout, dtype=np.float32)
    return audio.reshape(-1, channels).T.copy()


def separate(wav: torch.Tensor, model, device: str) -> dict[str, np.ndarray]:
    """Run Demucs on a (channels, samples) tensor. Returns {source: (channels, samples) array}."""
    # Same normalisation the demucs CLI uses
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std()
    x = (wav - mean) / (std + 1e-8)
    with torch.no_grad():
        try:
            out = apply_model(model, x[None], device=device, split=True, overlap=0.25)[0]
        except RuntimeError as e:  # some ops may be unsupported on MPS
            if device == "cpu":
                raise
            print(f"{device} failed ({e}); falling back to CPU")
            out = apply_model(model, x[None], device="cpu", split=True, overlap=0.25)[0]
    out = out * std + mean
    return {name: out[i].cpu().numpy() for i, name in enumerate(model.sources)}
