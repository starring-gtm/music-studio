"""Shared Redis connection and the RQ queue that the API and worker both use."""
from functools import lru_cache

from redis import Redis
from rq import Queue

from . import config


@lru_cache(maxsize=1)
def get_redis() -> Redis:
    return Redis.from_url(config.REDIS_URL)


def get_queue() -> Queue:
    return Queue(config.QUEUE_NAME, connection=get_redis())
