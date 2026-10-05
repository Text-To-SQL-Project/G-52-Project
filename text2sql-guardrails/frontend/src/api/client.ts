import { clearToken, getToken } from "../hooks/useAuthToken";
import type {
  AddPoolDeployment,
  AdminConfigResponse,
  BlockedQueriesResponse,
  ConfidenceUpdate,
  EvalMetricsResponse,
  HistoryResponse,
  LoginRequest,
  LoginResponse,
  MeResponse,
  PoolHealth,
  PoolStatus,
  QueryRequest,
  QueryResponse,
  RlsDemoResponse,
  SchemaResponse,
} from "../types/api";

// Set VITE_API_BASE at build time for any deployment that isn't a laptop.
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  /** Seconds until a rate-limited (429) request may be retried. */
  retryAfter?: number;
  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.status = status;
    this.name = "ApiError";
    this.retryAfter = retryAfter;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, `Could not reach the API at ${API_BASE}.`);
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      // response wasn't JSON; fall back to statusText
    }
    if (res.status === 401) {
      // Token missing/invalid/expired -- clear it so App.tsx re-renders
      // the login gate instead of the caller silently retrying forever
      // against a route it can no longer reach.
      clearToken();
    }
    if (res.status === 429) {
      // The server's detail is already user-facing ("Try again in 12 s.").
      throw new ApiError(429, detail, Number(res.headers.get("Retry-After")) || undefined);
    }
    throw new ApiError(res.status, `Request failed (${res.status}): ${detail}`);
  }

  return (await res.json()) as T;
}

export function login(req: LoginRequest): Promise<LoginResponse> {
  return request<LoginResponse>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

/** The caller's identity as the server sees it right now. Called on mount
 * whenever a token exists: the token carries only a user id, so role and
 * active status cannot be recovered from it and must be asked for. A 401
 * here flows through request()'s existing handling and drops the session. */
export function getMe(): Promise<MeResponse> {
  return request<MeResponse>("/auth/me");
}

export function postQuery(req: QueryRequest): Promise<QueryResponse> {
  return request<QueryResponse>("/v1/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export function getQueryConfidence(queryId: string): Promise<ConfidenceUpdate> {
  return request<ConfidenceUpdate>(`/v1/query/${encodeURIComponent(queryId)}/confidence`);
}

export function getPool(): Promise<PoolStatus> {
  return request<PoolStatus>("/v1/admin/llm-pool");
}

export function addToPool(req: AddPoolDeployment): Promise<PoolStatus> {
  return request<PoolStatus>("/v1/admin/llm-pool", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export function removeFromPool(id: string): Promise<PoolStatus> {
  return request<PoolStatus>(`/v1/admin/llm-pool/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function checkPoolHealth(): Promise<PoolHealth> {
  return request<PoolHealth>("/v1/admin/llm-pool/health", { method: "POST" });
}

export function getSchema(): Promise<SchemaResponse> {
  return request<SchemaResponse>("/v1/schema");
}

export function getHistory(sessionId?: string, limit = 50): Promise<HistoryResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (sessionId) params.set("session_id", sessionId);
  return request<HistoryResponse>(`/v1/history?${params.toString()}`);
}

export function getAdminConfig(): Promise<AdminConfigResponse> {
  return request<AdminConfigResponse>("/v1/admin/config");
}

export function getBlockedQueries(limit = 50): Promise<BlockedQueriesResponse> {
  return request<BlockedQueriesResponse>(`/v1/admin/blocked-queries?limit=${limit}`);
}

export function getAdminEvalMetrics(): Promise<EvalMetricsResponse> {
  return request<EvalMetricsResponse>("/v1/admin/eval-metrics");
}

export function getAdminRlsDemo(): Promise<RlsDemoResponse> {
  return request<RlsDemoResponse>("/v1/admin/rls-demo");
}
