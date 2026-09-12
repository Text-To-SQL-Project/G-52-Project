"""FastAPI entrypoint. Run: uvicorn app.main:app --reload"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth_routes import router as auth_router
from app.api.routes import router
from app.auth import require_auth
from app.config import settings
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
    yield


app = FastAPI(title=settings.APP_NAME, version=settings.VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": settings.VERSION}
