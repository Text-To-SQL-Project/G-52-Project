"""
API CONTRACT for the Text-to-SQL service.

This file is the single source of truth for the shape of data exchanged
between the React frontend and the FastAPI backend. Both sides build
against these models. Change this file deliberately, together.

Pydantic v2.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class QueryStatus(str, Enum):
    """Top-level outcome of a query request. The frontend switches its whole
    view on this field."""
    SUCCESS = "success"                    # SQL generated, passed safety, executed
    BLOCKED = "blocked"                    # guardrails stopped it before execution
    CLARIFICATION_NEEDED = "clarification" # question was ambiguous, we ask back
    ERROR = "error"                        # generation / execution failure


class SignalStatus(str, Enum):
    """Per-detector verdict, used to color each signal bar in the UI."""
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"


class WarningLevel(str, Enum):
    INFO = "info"
    WARNING = "warning"
    DANGER = "danger"


# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------

class QueryRequest(BaseModel):
    """POST /v1/query body."""
    question: str = Field(..., min_length=1, description="Natural-language question.")
    session_id: Optional[str] = Field(
        None, description="Groups queries for the history panel."
    )
    # Power-user override: if the user edited the SQL in the UI and wants to
    # run their version, they send it here and we skip generation.
    sql_override: Optional[str] = Field(
        None, description="If set, run this SQL instead of generating one."
    )
    max_rows: int = Field(1000, ge=1, le=10000, description="Row cap for results.")


# ---------------------------------------------------------------------------
# Confidence — the signature component
# ---------------------------------------------------------------------------

class ConfidenceSignal(BaseModel):
    """One contributing signal in the confidence breakdown. Maps 1:1 to a
    detector in app/detection/ and to one progress bar in the UI card."""
    key: str = Field(..., description="Stable id, e.g. 'schema_alignment'.")
    label: str = Field(..., description="Human label, e.g. 'Schema Alignment'.")
    score: float = Field(..., ge=0.0, le=1.0, description="0..1 sub-score.")
    status: SignalStatus
    detail: Optional[str] = Field(
        None, description="Short reason shown on hover, e.g. 'all 3 tables exist'."
    )


class Confidence(BaseModel):
    """Overall calibrated confidence + the signals that produced it."""
    score: float = Field(..., ge=0.0, le=1.0, description="Calibrated overall score.")
    label: str = Field(..., description="'High' / 'Medium' / 'Low'.")
    calibrated: bool = Field(
        True, description="True once the learned+isotonic model is wired in."
    )
    signals: list[ConfidenceSignal]


# ---------------------------------------------------------------------------
# Safety / guardrails
# ---------------------------------------------------------------------------

class GuardrailReport(BaseModel):
    passed: bool
    blocked_reasons: list[str] = Field(
        default_factory=list, description="Why it was blocked (empty if passed)."
    )
    injected_limit: Optional[int] = Field(
        None, description="LIMIT auto-injected by the guardrail, if any."
    )
    checks_run: list[str] = Field(
        default_factory=list,
        description="e.g. ['ddl_block','dml_block','row_limit','subquery_depth'].",
    )


class Warning(BaseModel):
    """A non-fatal note surfaced to the user (ambiguity, sanity anomaly...)."""
    level: WarningLevel
    message: str
    source: Optional[str] = Field(
        None, description="Which stage raised it, e.g. 'result_sanity'."
    )


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------

class ResultTable(BaseModel):
    """Tabular result, capped at max_rows. Columns are ordered."""
    columns: list[str]
    rows: list[list[Any]]
    row_count: int = Field(..., description="Rows returned (after the cap).")
    truncated: bool = Field(
        False, description="True if more rows existed than the cap."
    )


class Clarification(BaseModel):
    """Returned when the question is ambiguous. The UI renders the options as
    buttons instead of results."""
    reason: str
    options: list[str] = Field(..., description="Interpretations to choose from.")


# ---------------------------------------------------------------------------
# Response
# ---------------------------------------------------------------------------

class QueryResponse(BaseModel):
    """POST /v1/query response. This is the object your confidence card,
    SQL panel, results table, and warning banner all read from."""
    query_id: str
    status: QueryStatus
    question: str
    timestamp: datetime

    # Present on SUCCESS (and usually BLOCKED, so the user sees what was blocked)
    sql: Optional[str] = None
    explanation: Optional[str] = Field(
        None, description="Plain-English description of what the SQL does."
    )
    tables_used: list[str] = Field(default_factory=list)
    columns_used: list[str] = Field(default_factory=list)

    # Present on SUCCESS
    results: Optional[ResultTable] = None
    confidence: Optional[Confidence] = None
    execution_time_ms: Optional[float] = None

    # Always present
    guardrail: GuardrailReport
    warnings: list[Warning] = Field(default_factory=list)

    # Present on CLARIFICATION_NEEDED
    clarification: Optional[Clarification] = None

    # Present on ERROR
    error_message: Optional[str] = None


# ---------------------------------------------------------------------------
# /v1/schema
# ---------------------------------------------------------------------------

class ColumnInfo(BaseModel):
    name: str
    data_type: str
    nullable: bool = True
    is_primary_key: bool = False
    is_foreign_key: bool = False
    references: Optional[str] = Field(
        None, description="'table.column' this FK points to."
    )
    sample_values: list[str] = Field(default_factory=list)


class TableInfo(BaseModel):
    name: str
    columns: list[ColumnInfo]
    row_estimate: Optional[int] = None


class SchemaResponse(BaseModel):
    """GET /v1/schema response — powers the Schema Explorer screen."""
    database: str
    tables: list[TableInfo]
    total_tables: int
    total_columns: int


# ---------------------------------------------------------------------------
# /v1/history
# ---------------------------------------------------------------------------

class HistoryItem(BaseModel):
    query_id: str
    question: str
    sql_preview: str = Field(..., description="Truncated one-line SQL for the card.")
    status: QueryStatus
    confidence_score: Optional[float] = None
    row_count: Optional[int] = None
    timestamp: datetime
    user_feedback: Optional[bool] = Field(
        None, description="True=correct, False=incorrect, None=unrated."
    )


class HistoryResponse(BaseModel):
    """GET /v1/history response — powers the History screen."""
    session_id: Optional[str] = None
    items: list[HistoryItem]
    total: int
