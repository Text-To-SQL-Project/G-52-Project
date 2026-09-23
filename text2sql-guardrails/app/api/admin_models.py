"""
Response model for GET /v1/admin/config. Deliberately kept OUT of
app/api/models.py: that file is the fixed contract for the core query/
schema/history flows, and this endpoint is operational introspection (live
config + eval numbers for the Admin screen), not part of that contract.
"""
from __future__ import annotations

from datetime import datetime

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


class BlockedQueryItem(BaseModel):
    """The REAL, unredacted SQL for one BLOCKED query -- deliberately not
    in app/api/models.py or exposed via GET /v1/history (see
    app/history.py::read_blocked_queries()'s docstring). Only reachable
    via GET /v1/admin/blocked-queries, behind require_auth."""
    query_id: str
    question: str
    sql: str | None
    blocked_reason: str | None
    timestamp: datetime


class BlockedQueriesResponse(BaseModel):
    items: list[BlockedQueryItem]
    total: int


class AblationCell(BaseModel):
    provider: str
    split: str
    regime: str
    five_signal: float
    four_signal: float
    delta: float
    dropping_hurts: bool
    is_justification_cell: bool = False


class PerSignalAurocItem(BaseModel):
    signal: str
    permissive: float
    strict: float
    delta: float
    is_focal: bool = False


class SafetyLayerMetrics(BaseModel):
    provider: str
    guardrail_block_rate: float
    refusal_accuracy: float
    clarification_accuracy: float
    destructive_executed: int
    adversarial_flags: int


class AurocComparison(BaseModel):
    in_sample_raw: float = 0.625
    held_out_raw: float = 0.552
    held_out_calibrated: float = 0.564
    superseded_frozen_value: float = 0.649
    superseded_note: str = (
        "0.649 was retired on 2026-09-15 because it could not be independently reproduced. "
        "The authoritative in-sample figure is 0.625, and held-out is 0.552."
    )


class EvalMetricsResponse(BaseModel):
    auroc_comparison: AurocComparison
    ablation_cells: list[AblationCell]
    per_signal_auroc: dict[str, list[PerSignalAurocItem]]
    safety_breakdown: list[SafetyLayerMetrics]


class RlsPrincipalRowCounts(BaseModel):
    principal: str
    label: str
    role: str
    students: int
    marks: int
    attendance: int
    fee_payments: int


class RlsDemoResponse(BaseModel):
    principals: list[RlsPrincipalRowCounts]
    caveat: str
