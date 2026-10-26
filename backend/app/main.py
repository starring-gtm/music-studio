"""HTTP API: upload a song, poll its separation job, download the stems.

Run from backend/:  uvicorn app.main:app --reload
"""
import shutil
import uuid
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from redis.exceptions import RedisError
from rq.exceptions import NoSuchJobError
from rq.job import Job, JobStatus

from . import config
from .redis_queue import get_queue, get_redis

UPLOAD_CHUNK = 1024 * 1024

app = FastAPI(title="Music Studio API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _job_dir(job_id: str) -> Path:
    # Only accept canonical uuid4 hex ids, so the id can never escape DATA_DIR.
    try:
        valid = uuid.UUID(hex=job_id).hex == job_id
    except ValueError:
        valid = False
    if not valid:
        raise HTTPException(404, "job not found")
    return config.DATA_DIR / job_id


def _fetch_job(job_id: str) -> Job:
    _job_dir(job_id)
    try:
        return Job.fetch(job_id, connection=get_redis())
    except NoSuchJobError:
        raise HTTPException(404, "job not found") from None


@app.get("/api/health")
def health():
    try:
        redis_ok = bool(get_redis().ping())
    except RedisError:
        redis_ok = False
    return {"ok": redis_ok, "redis": redis_ok}


@app.post("/api/jobs", status_code=202)
async def create_job(file: UploadFile = File(...), model: str = Form(config.DEFAULT_MODEL)):
    if model not in config.ALLOWED_MODELS:
        raise HTTPException(422, f"model must be one of {', '.join(config.ALLOWED_MODELS)}")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in config.ALLOWED_EXTENSIONS:
        raise HTTPException(415, f"unsupported file type {ext or '(none)'}")

    job_id = uuid.uuid4().hex
    job_dir = config.DATA_DIR / job_id
    job_dir.mkdir(parents=True)

    # Stream to disk in chunks so a huge upload is rejected without holding it in memory.
    limit = config.MAX_UPLOAD_MB * 1024 * 1024
    size = 0
    try:
        with open(job_dir / f"input{ext}", "wb") as f:
            while chunk := await file.read(UPLOAD_CHUNK):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"file is larger than {config.MAX_UPLOAD_MB} MB")
                f.write(chunk)
        if size == 0:
            raise HTTPException(400, "file is empty")
        # Enqueued by path so the API process never imports torch/demucs.
        get_queue().enqueue(
            "app.tasks.separate_job",
            str(job_dir),
            model,
            job_id=job_id,
            job_timeout=config.JOB_TIMEOUT_S,
            result_ttl=config.JOB_TTL_S,
            failure_ttl=config.JOB_TTL_S,
            meta={"stage": "queued", "model": model, "filename": file.filename},
        )
    except (HTTPException, RedisError):
        shutil.rmtree(job_dir, ignore_errors=True)
        raise

    return {"id": job_id, "status": JobStatus.QUEUED.value}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = _fetch_job(job_id)
    status = job.get_status(refresh=True)
    body = {
        "id": job_id,
        "status": status.value if status else "unknown",
        "stage": job.meta.get("stage"),
        "model": job.meta.get("model"),
        "filename": job.meta.get("filename"),
    }
    if status == JobStatus.QUEUED:
        body["position"] = job.get_position()
    elif status == JobStatus.FAILED:
        body["error"] = job.meta.get("error") or "separation failed"
    elif status == JobStatus.FINISHED:
        result = job.return_value() or {}
        body.update(result)
        base = f"/api/jobs/{job_id}"
        body["mixture"] = f"{base}/stems/mixture.flac"
        body["stems"] = {name: f"{base}/stems/{name}.flac" for name in result.get("sources", [])}
        body["zip"] = f"{base}/stems.zip"
    return body


@app.get("/api/jobs/{job_id}/stems/{name}.flac")
def get_stem(job_id: str, name: str):
    path = _job_dir(job_id) / "stems" / f"{name}.flac"
    if not name.isidentifier() or not path.is_file():
        raise HTTPException(404, "stem not found")
    return FileResponse(path, media_type="audio/flac")


@app.get("/api/jobs/{job_id}/stems.zip")
def get_stems_zip(job_id: str):
    job_dir = _job_dir(job_id)
    stem_dir = job_dir / "stems"
    if not stem_dir.is_dir():
        raise HTTPException(404, "stems not ready")
    zip_path = job_dir / "stems.zip"
    if not zip_path.exists():
        tmp = job_dir / "stems.zip.tmp"
        # FLAC is already compressed, so store without deflating again.
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as zf:
            for p in sorted(stem_dir.glob("*.flac")):
                if p.stem != "mixture":
                    zf.write(p, p.name)
        tmp.replace(zip_path)
    return FileResponse(zip_path, media_type="application/zip", filename="stems.zip")
