"""
Response model for GET /v1/admin/config. Deliberately kept OUT of
app/api/models.py: that file is the fixed contract for the core query/
schema/history flows, and this endpoint is operational introspection (live
config + eval numbers for the Admin screen), not part of that contract.
"""
from __future__ import annotations

from pydantic import BaseModel


class GuardrailConfig(BaseModel):
    default_row_limit: int
    max_subquery_depth: int
    statement_timeout_ms: int


class DetectionConfig(BaseModel):
    back_translation_enabled: bool
    multi_query_enabled: bool
    multi_query_n: int
    confidence_weights: dict[str, float]
    fail_score_cap: float
    calibration_loaded: bool


class EvalSummary(BaseModel):
    """Published numbers from the last full eval/analyze.py run (see
    eval/README.md) -- not live-computed, since that requires a completed
    eval/results.jsonl and offline analysis, not a request-time query."""
    execution_accuracy: float
    fused_auroc: float
    held_out_ece: float
    guardrail_block_rate: str
    destructive_queries_executed: int
    adversarial_executed_flags: int
    golden_set_size: int
    unique_answerable_questions: int
    note: str


class AdminConfigResponse(BaseModel):
    app_name: str
    version: str
    llm_model: str
    guardrail: GuardrailConfig
    detection: DetectionConfig
    eval_summary: EvalSummary
