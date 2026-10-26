"""Start a separation worker. Run from backend/:  python worker.py

Uses SimpleWorker, which runs jobs in this process instead of forking per job:
the Demucs model stays loaded between jobs, and PyTorch/MPS avoids macOS
fork-safety crashes.
"""
from rq.worker import SimpleWorker

from app import config
from app.redis_queue import get_queue, get_redis
from app.separation import load_model

if __name__ == "__main__":
    print(f"preloading {config.DEFAULT_MODEL} ...")
    load_model(config.DEFAULT_MODEL)
    worker = SimpleWorker([get_queue()], connection=get_redis())
    worker.work()
