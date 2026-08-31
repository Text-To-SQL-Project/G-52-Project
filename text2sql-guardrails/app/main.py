"""FastAPI entrypoint. Run: uvicorn app.main:app --reload"""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import settings

# Root handler so every `logging.getLogger(__name__)` call in app/ actually
# reaches stdout (and therefore `docker logs`) -- without this, records
# propagate to the root logger and are silently dropped, since nothing else
# in this project calls basicConfig(). Used for the detailed, schema-bearing
# reasons behind REFUSED/CLARIFICATION_NEEDED/BLOCKED responses, which must
# be logged server-side but never sent to the client -- see app/api/routes.py.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title=settings.APP_NAME, version=settings.VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": settings.VERSION}
