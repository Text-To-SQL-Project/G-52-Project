"""Vercel Python function entry point: the whole FastAPI app as one function.
vercel.json rewrites every path here, so /v1/*, /auth/* and /healthz keep
their URLs. Local and Docker runs still use uvicorn app.main:app."""
from app.main import app  # noqa: F401  (Vercel serves the ASGI `app`)
