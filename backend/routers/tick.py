"""HTTP-triggered equivalent of `python -m ingestion.tick`. The recurring
GitHub Actions cron no longer calls this — it now runs ingestion.tick
directly on the runner against Turso (see .github/workflows/cron.yml for
why: routing heavy jobs through this host's free-tier container was
OOM-killing them and getting rate-limited by external APIs on this host's
shared egress IP). Left in place as a manual/admin trigger. Protected by a
shared secret, not user auth — this isn't tied to any one person's account.
"""
import os
import threading
import traceback

from fastapi import APIRouter, Header, HTTPException, Response

router = APIRouter(prefix="/api/tick", tags=["tick"])

CRON_SECRET = os.environ.get("CRON_SECRET")


def _run_job(name: str, fn):
    try:
        fn()
        print(f"tick '{name}' finished")
    except Exception:
        print(f"tick '{name}' failed:\n{traceback.format_exc()}")


@router.post("/{job}")
def run_tick(job: str, response: Response, x_cron_secret: str = Header(default=None)):
    if not CRON_SECRET:
        raise HTTPException(status_code=503, detail="CRON_SECRET not configured on this deployment")
    if x_cron_secret != CRON_SECRET:
        raise HTTPException(status_code=401, detail="invalid cron secret")

    from ingestion.tick import JOBS

    if job not in JOBS:
        raise HTTPException(status_code=404, detail=f"unknown job '{job}', expected one of {list(JOBS)}")

    threading.Thread(target=_run_job, args=(job, JOBS[job]), daemon=True).start()
    response.status_code = 202
    return {"job": job, "status": "started"}
