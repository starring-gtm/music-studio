"""Tempo (BPM) and musical key detection.

Both run on stems rather than the full mix, which makes them more reliable:
- tempo uses the drums stem: clean onsets, no sustained notes blurring the beat
- key uses everything except drums: drums add noise to every pitch class
"""
import librosa
import numpy as np

ANALYSIS_SR = 22050  # plenty for rhythm and pitch, and 2x faster than 44.1 kHz

PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Kessler key profiles: how strongly each pitch class (starting from the
# tonic) is felt to belong to a major / minor key, from listening experiments.
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def _to_mono(audio: np.ndarray, sr: int) -> np.ndarray:
    mono = audio.mean(axis=0) if audio.ndim == 2 else audio
    return librosa.resample(mono, orig_sr=sr, target_sr=ANALYSIS_SR)


def detect_bpm(audio: np.ndarray, sr: int) -> float:
    """Estimated tempo in beats per minute. May be off by 2x (half/double time)."""
    tempo, _ = librosa.beat.beat_track(y=_to_mono(audio, sr), sr=ANALYSIS_SR)
    return float(np.atleast_1d(tempo)[0])


def detect_key(audio: np.ndarray, sr: int) -> tuple[str, float]:
    """Return (key name, confidence) where confidence is a correlation in [-1, 1]."""
    chroma = librosa.feature.chroma_cqt(y=_to_mono(audio, sr), sr=ANALYSIS_SR)
    profile = chroma.mean(axis=1)  # average energy per pitch class over the song

    best_name, best_score = "", -2.0
    for tonic in range(12):
        for mode, template in (("major", MAJOR_PROFILE), ("minor", MINOR_PROFILE)):
            score = np.corrcoef(profile, np.roll(template, tonic))[0, 1]
            if score > best_score:
                best_name, best_score = f"{PITCH_CLASSES[tonic]} {mode}", float(score)
    return best_name, best_score


def analyze(mixture: np.ndarray, stems: dict[str, np.ndarray], sr: int) -> dict:
    drums = stems.get("drums")
    rhythm = drums if drums is not None else mixture
    harmonic = mixture - drums if drums is not None else mixture
    key, confidence = detect_key(harmonic, sr)
    return {
        "bpm": round(detect_bpm(rhythm, sr), 1),
        "key": key,
        "key_confidence": round(confidence, 3),
    }
