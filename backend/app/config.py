"""Runtime settings, read from environment variables."""
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]

DATA_DIR = Path(os.getenv("STUDIO_DATA_DIR", PROJECT_ROOT / "data" / "jobs"))
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
QUEUE_NAME = "separation"

DEFAULT_MODEL = os.getenv("DEMUCS_MODEL", "htdemucs_6s")
ALLOWED_MODELS = ("htdemucs", "htdemucs_6s", "htdemucs_ft")
DEVICE = os.getenv("DEMUCS_DEVICE")  # None = pick mps / cuda / cpu automatically

MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "50"))
MAX_DURATION_S = float(os.getenv("MAX_DURATION_S", "600"))
ALLOWED_EXTENSIONS = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".aiff", ".aif"}

JOB_TIMEOUT_S = 30 * 60
JOB_TTL_S = 7 * 24 * 3600  # how long Redis keeps job status/results

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
