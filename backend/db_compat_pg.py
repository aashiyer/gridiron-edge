"""Thin adapter so a Postgres (Supabase) connection can be used everywhere
the code already does sqlite3.Row-style access (`row["col"]`, `dict(row)`)
and `?` placeholders.

Placeholders: every query in this codebase is written with SQLite's `?`
style. Rather than rewrite every query at every call site, `execute()`
translates `?` -> `%s` before handing off to psycopg2. Checked: no query
anywhere in this codebase has a literal `?` character inside a string
constant, so a blanket replace is safe.
"""
import os
import re
import threading
from typing import Iterable, Optional


class Row(dict):
    """Drop-in enough for sqlite3.Row: `row["col"]` and `dict(row)` both
    work since this *is* a dict. Case-insensitive lookups on purpose,
    matching real sqlite3.Row's documented case-insensitive string
    indexing."""

    def __getitem__(self, key):
        try:
            return super().__getitem__(key)
        except KeyError:
            if isinstance(key, str):
                for k in self:
                    if k.lower() == key.lower():
                        return super().__getitem__(k)
            raise

    def get(self, key, default=None):
        try:
            return self[key]
        except KeyError:
            return default

    def __contains__(self, key):
        if super().__contains__(key):
            return True
        if isinstance(key, str):
            return any(k.lower() == key.lower() for k in self)
        return False


_WRITE_PREFIXES = ("insert", "update", "delete", "create", "drop", "alter", "replace")

_VALUES_RE = re.compile(r"VALUES\s*(\([^)]*\))", re.IGNORECASE)


def _translate(sql: str) -> str:
    return sql.replace("?", "%s")


class PgCursor:
    def __init__(self, cursor):
        self._cursor = cursor

    def _wrap(self, raw) -> Optional[Row]:
        return Row(raw) if raw is not None else None

    def execute(self, sql: str, params: Iterable = ()):
        self._cursor.execute(_translate(sql), tuple(params))
        return self

    def fetchone(self) -> Optional[Row]:
        return self._wrap(self._cursor.fetchone())

    def fetchall(self):
        return [self._wrap(r) for r in self._cursor.fetchall()]

    def __iter__(self):
        return iter(self.fetchall())


class PgConnection:
    """Wraps one real psycopg2 connection checked out of the pool below."""

    def __init__(self, conn, pool=None):
        self._conn = conn
        self._pool = pool

    def execute(self, sql: str, params: Iterable = ()) -> PgCursor:
        import psycopg2.extras

        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(_translate(sql), tuple(params))
        return PgCursor(cur)

    def executemany(self, sql: str, seq_of_params: Iterable):
        import psycopg2.extras

        translated = _translate(sql)
        params = [tuple(p) for p in seq_of_params]
        if not params:
            return

        match = _VALUES_RE.search(translated)
        if not match:
            cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.executemany(translated, params)
            return

        template = match.group(1)
        query = translated[: match.start()] + "VALUES %s" + translated[match.end() :]
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        psycopg2.extras.execute_values(cur, query, params, template=template, page_size=1000)

    def executescript(self, sql: str):
        cur = self._conn.cursor()
        cur.execute(sql)
        return cur

    def commit(self):
        self._conn.commit()

    def rollback(self):
        try:
            self._conn.rollback()
        except Exception:
            pass

    def close(self):
        if self._pool is not None:
            self._pool.putconn(self._conn)
        else:
            self._conn.close()


_pool = None
_pool_init_lock = threading.Lock()
_POOL_MIN = int(os.environ.get("PG_POOL_MIN", "1"))
_POOL_MAX = int(os.environ.get("PG_POOL_MAX", "10"))


def connect_postgres(database_url: str) -> PgConnection:
    """`database_url` is a standard postgres:// connection string — for
    Supabase specifically, use the "Transaction pooler" (port 6543)
    connection string, not the direct one: this app opens many short-lived
    connections (every request, every GitHub Actions ingestion run), and
    the pooler is built for exactly that instead of a handful of
    long-lived ones."""
    global _pool

    if _pool is None:
        with _pool_init_lock:
            if _pool is None:
                import psycopg2.pool

                _pool = psycopg2.pool.ThreadedConnectionPool(_POOL_MIN, _POOL_MAX, dsn=database_url)

    raw = _pool.getconn()
    raw.rollback()
    return PgConnection(raw, pool=_pool)
