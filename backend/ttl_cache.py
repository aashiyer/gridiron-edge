import time

_CACHES: dict = {}


def ttl_memo(name: str, ttl_seconds: int):
    def deco(fn):
        cache = _CACHES.setdefault(name, {})

        def wrapper(conn, *args):
            hit = cache.get(args)
            if hit and time.time() - hit[0] < ttl_seconds:
                return hit[1]
            value = fn(conn, *args)
            cache[args] = (time.time(), value)
            return value

        wrapper.__name__ = fn.__name__
        return wrapper

    return deco
