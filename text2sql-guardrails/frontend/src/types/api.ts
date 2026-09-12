/**
 * Mirrors app/api/models.py -- the fixed API contract. Keep these two files
 * in sync manually; this file must never drift from the Pydantic models.
 */

export type QueryStatus = "success" | "refused" | "clarification" | "blocked" | "error";

export type SignalStatus = "pass" | "warn" | "fail";

export type WarningLevel = "info" | "warning" | "danger";

export interface QueryRequest {
  question: string;
  session_id?: string | null;
  sql_override?: string | null;
  max_rows?: number;
}

export interface ConfidenceSignal {
  key: string;
  label: string;
  score: number;
  status: SignalStatus;
  detail?: string | null;
}

export interface Confidence {
  score: number;
  label: string;
  calibrated: boolean;
  signals: ConfidenceSignal[];
}

export interface GuardrailReport {
  passed: boolean;
  blocked_reasons: string[];
  injected_limit?: number | null;
  checks_run: string[];
}

export interface Warning {
  level: WarningLevel;
  message: string;
  source?: string | null;
}

export interface ResultTable {
  columns: string[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
}

export interface Clarification {
  reason: string;
  options: string[];
}

export interface QueryResponse {
  query_id: string;
  status: QueryStatus;
  status_reason?: string | null;
  question: string;
  timestamp: string;

  sql?: string | null;
  explanation?: string | null;
  tables_used: string[];
  columns_used: string[];

  results?: ResultTable | null;
  confidence?: Confidence | null;
  execution_time_ms?: number | null;

  guardrail: GuardrailReport;
  warnings: Warning[];

  clarification?: Clarification | null;
  error_message?: string | null;
}

// ---------------------------------------------------------------------------
// /v1/schema
// ---------------------------------------------------------------------------

export interface ColumnInfo {
  name: string;
  data_type: string;
  nullable: boolean;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  references?: string | null;
  sample_values: string[];
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  row_estimate?: number | null;
}

export interface SchemaResponse {
  database: string;
  tables: TableInfo[];
  total_tables: number;
  total_columns: number;
}

// ---------------------------------------------------------------------------
// /v1/history
// ---------------------------------------------------------------------------

export interface HistoryItem {
  query_id: string;
  question: string;
  sql_preview?: string | null;
  status: QueryStatus;
  status_reason?: string | null;
  confidence_score?: number | null;
  row_count?: number | null;
  timestamp: string;
  user_feedback?: boolean | null;
}

export interface HistoryResponse {
  session_id?: string | null;
  items: HistoryItem[];
  total: number;
}

// ---------------------------------------------------------------------------
// /v1/admin/config -- NOT part of app/api/models.py's fixed contract; see
// app/api/admin_models.py. Operational introspection for the Admin screen.
// ---------------------------------------------------------------------------

export interface GuardrailConfig {
  default_row_limit: number;
  max_subquery_depth: number;
  statement_timeout_ms: number;
}

export interface DetectionConfig {
  back_translation_enabled: boolean;
  multi_query_enabled: boolean;
  multi_query_n: number;
  confidence_weights: Record<string, number>;
  fail_score_cap: number;
  calibration_loaded: boolean;
}

export interface EvalSummary {
  execution_accuracy: number;
  fused_auroc: number;
  held_out_ece: number;
  guardrail_block_rate: string;
  destructive_queries_executed: number;
  adversarial_executed_flags: number;
  golden_set_size: number;
  unique_answerable_questions: number;
  note: string;
}

export interface AdminConfigResponse {
  app_name: string;
  version: string;
  llm_model: string;
  guardrail: GuardrailConfig;
  detection: DetectionConfig;
  eval_summary: EvalSummary;
}

// ---------------------------------------------------------------------------
// GET /v1/admin/blocked-queries -- admin-only, real unredacted SQL for
// BLOCKED queries (see app/api/admin_models.py::BlockedQueryItem). Never
// present in QueryResponse or HistoryItem -- Task 1's fix stays intact.
// ---------------------------------------------------------------------------

export interface BlockedQueryItem {
  query_id: string;
  question: string;
  sql?: string | null;
  blocked_reason?: string | null;
  timestamp: string;
}

export interface BlockedQueriesResponse {
  items: BlockedQueryItem[];
  total: number;
}

// ---------------------------------------------------------------------------
// POST /auth/login -- outside /v1 and outside app/api/models.py; see
// app/api/auth_models.py.
// ---------------------------------------------------------------------------

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  expires_in: number;
  /** Display convenience only. Never treated as an authorisation input --
   * the server re-reads role on every request and enforces independently,
   * so hiding UI based on this is presentation, not access control. */
  username: string;
  role: UserRole;
}

export type UserRole = "student" | "faculty" | "admin";

/** GET /auth/me -- the caller as the SERVER currently sees them.
 * Fetched on mount rather than persisted, because role is deliberately not
 * a token claim: it is re-read per request server-side, so the client must
 * ask rather than remember. */
export interface MeResponse {
  user_id: number;
  username: string;
  role: UserRole;
  student_id?: number | null;
  faculty_id?: number | null;
}
