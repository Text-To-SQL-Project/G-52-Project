"""FastAPI entrypoint. Run: uvicorn app.main:app --reload"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth_routes import router as auth_router
from app.api.routes import router
from app.api.pool_routes import router as pool_router
from app.api.user_routes import router as user_router
from app.auth import require_auth
from app.config import settings
from app.http_guard import GuardMiddleware
from app.startup_checks import run_startup_checks

# Root handler so every `logging.getLogger(__name__)` call in app/ actually
# reaches stdout (and therefore `docker logs`) -- without this, records
# propagate to the root logger and are silently dropped, since nothing else
# in this project calls basicConfig(). Used for the detailed, schema-bearing
# reasons behind REFUSED/CLARIFICATION_NEEDED/BLOCKED responses, which must
# be logged server-side but never sent to the client -- see app/api/routes.py.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Fail closed at boot rather than per-request. A role misconfiguration
    # does not produce wrong answers, it removes a defence, so nothing
    # downstream would ever surface it -- see app/startup_checks.py. Raising
    # here stops uvicorn from serving at all, which is the intended
    # behaviour: a running API with read-only enforcement or RLS silently
    # disabled is worse than one that refused to start.
    run_startup_checks()
    _warm_up()
    yield


def _warm_up() -> None:
    """Pay connection-pool and schema-reflection costs at boot, not on the
    first user's question (measured: ~3 s cold vs ~0.2 s warm)."""
    from sqlalchemy import text

    from app.db import get_engine, get_readonly_engine
    from app.schema.introspect import introspect_schema

    try:
        for engine in (get_engine(), get_readonly_engine()):
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        from app import llm_pool

        llm_pool.refresh_ready()
        # Loads scikit-learn + the isotonic calibrator: measured 4.4 s, which
        # every first answer after a (re)start used to pay inside post-checks.
        from app.detection.calibration import calibrate

        calibrate(0.5)
        for omit_restricted in (True, False):
            introspect_schema(
                include_samples=False, omit_restricted=omit_restricted, include_row_estimates=False
            )
    except Exception as e:  # warm-up is an optimisation; startup_checks own failures
        logging.getLogger(__name__).warning("Warm-up skipped: %s", e)


app = FastAPI(title=settings.APP_NAME, version=settings.VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    # Any localhost port is a dev convenience only; prod allows exactly CORS_ORIGINS.
    allow_origin_regex=None if settings.ENV == "prod" else r"https?://(localhost|127\.0\.0\.1)(:[0-9]+)?",
    # Auth is a bearer header, never a cookie, so credentialed CORS isn't needed.
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["Server-Timing", "X-Request-ID", "Retry-After"],
    max_age=600,
)
app.add_middleware(GuardMiddleware)

# dependencies=[Depends(require_auth)] here, not on individual routes:
# gates every current AND future route registered on `router` (query,
# schema, history, admin/config) in one place, so a new endpoint can't be
# added later and accidentally left unauthenticated by omission -- the
# same "guarantee it at the single choke point, not per-branch" reasoning
# Task 3 applied to the history write.
#
# Routes that need the caller's IDENTITY re-declare Depends(require_auth)
# in their own signature to receive the Principal. FastAPI caches a
# dependency per request, so it resolves once either way -- the router-level
# gate and the route-level parameter are the same call, not two.
app.include_router(router, dependencies=[Depends(require_auth)])
# auth_router is NOT gated -- see app/auth.py's require_auth() docstring.
app.include_router(auth_router)
app.include_router(pool_router)
app.include_router(user_router)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness: the process is up."""
    return {"status": "ok", "version": settings.VERSION}


@app.get("/healthz")
def healthz() -> dict[str, str]:
    """Readiness: both database roles answer. For load balancers/orchestrators."""
    from sqlalchemy import text

    from app.db import get_engine, get_readonly_engine

    try:
        for engine in (get_engine(), get_readonly_engine()):
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
    except Exception:
        logging.getLogger(__name__).exception("Readiness check failed")
        raise HTTPException(status_code=503, detail="Database unavailable.")
    return {"status": "ready"}
