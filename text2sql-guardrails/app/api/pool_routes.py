"""
Admin API for the AI key pool (app/llm_pool.py relays to the LiteLLM proxy).

    GET    /v1/admin/llm-pool          status + deployments (never keys)
    POST   /v1/admin/llm-pool          add a provider key
    DELETE /v1/admin/llm-pool/{id}     remove one
    POST   /v1/admin/llm-pool/health   one tiny request through every key
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from app import llm_pool
from app.auth import require_admin
from app.users import Principal

router = APIRouter(prefix="/v1/admin/llm-pool", tags=["admin"], dependencies=[Depends(require_admin)])
logger = logging.getLogger(__name__)

# LiteLLM provider prefixes offered in the Admin UI. Any OpenAI-compatible
# server (Ollama, vLLM, LM Studio, ...) works through "openai" + api_base.
PROVIDERS = [
    "openai", "anthropic", "gemini", "groq", "mistral", "deepseek", "xai", "cohere",
    "together_ai", "openrouter", "fireworks_ai", "perplexity", "cerebras", "deepinfra",
]


class Deployment(BaseModel):
    id: str
    provider: str
    model: str
    label: str = ""
    key_hint: str = ""
    api_base: Optional[str] = None
    requests: int = 0
    avg_latency_ms: Optional[float] = None
    last_used_at: Optional[float] = None


class PoolStatus(BaseModel):
    configured: bool
    reachable: bool
    # Provider /v1/query uses right now ("litellm" = this pool).
    app_provider: str
    providers: list[str]
    deployments: list[Deployment] = Field(default_factory=list)
    error: Optional[str] = None


class AddDeployment(BaseModel):
    provider: str
    model: str = Field(..., min_length=1, max_length=200)
    api_key: str = Field(..., min_length=8, max_length=500)
    api_base: Optional[str] = Field(None, max_length=500)
    label: str = Field("", max_length=80)

    @field_validator("provider")
    @classmethod
    def known_provider(cls, v: str) -> str:
        if v not in PROVIDERS:
            raise ValueError(f"provider must be one of: {', '.join(PROVIDERS)}")
        return v

    @field_validator("model")
    @classmethod
    def plain_model_name(cls, v: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9._:/@-]+", v):
            raise ValueError("model may contain letters, digits and . _ : / @ - only")
        return v

    @field_validator("api_base")
    @classmethod
    def http_url(cls, v: Optional[str]) -> Optional[str]:
        if v and not re.fullmatch(r"https?://[^\s]+", v):
            raise ValueError("api_base must be an http(s) URL")
        return v or None


class HealthResult(BaseModel):
    healthy: list[str]
    unhealthy: list[dict]


def _pool_error(e: llm_pool.PoolError) -> HTTPException:
    return HTTPException(status_code=502, detail=str(e))


@router.get("", response_model=PoolStatus)
def get_pool() -> PoolStatus:
    status = PoolStatus(
        configured=llm_pool.configured(), reachable=False,
        app_provider=llm_pool.app_provider(), providers=PROVIDERS,
    )
    if not status.configured:
        return status
    try:
        status.deployments = [Deployment(**d) for d in llm_pool.list_deployments()]
        status.reachable = True
    except llm_pool.PoolError as e:
        status.error = str(e)
    return status


@router.post("", response_model=PoolStatus, status_code=201)
def add_to_pool(req: AddDeployment, principal: Principal = Depends(require_admin)) -> PoolStatus:
    try:
        llm_pool.add_deployment(
            provider=req.provider, model=req.model, api_key=req.api_key,
            api_base=req.api_base, label=req.label,
        )
    except llm_pool.PoolError as e:
        raise _pool_error(e)
    # Audit without the key: who added which provider/model.
    logger.info("POOL ADD by user_id=%s: %s/%s", principal.user_id, req.provider, req.model)
    return get_pool()


@router.delete("/{model_id}", response_model=PoolStatus)
def remove_from_pool(model_id: str, principal: Principal = Depends(require_admin)) -> PoolStatus:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", model_id):
        raise HTTPException(status_code=422, detail="Invalid deployment id.")
    try:
        llm_pool.delete_deployment(model_id)
    except llm_pool.PoolError as e:
        raise _pool_error(e)
    logger.info("POOL DELETE by user_id=%s: %s", principal.user_id, model_id)
    return get_pool()


@router.post("/health", response_model=HealthResult)
def check_pool_health() -> HealthResult:
    try:
        return HealthResult(**llm_pool.health())
    except llm_pool.PoolError as e:
        raise _pool_error(e)

