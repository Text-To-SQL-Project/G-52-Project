import { clearToken, getToken } from "../hooks/useAuthToken";
import type {
  AdminConfigResponse,
  BlockedQueriesResponse,
  EvalMetricsResponse,
  HistoryResponse,
  LoginRequest,
  LoginResponse,
  MeResponse,
  QueryRequest,
  QueryResponse,
  RlsDemoResponse,
  SchemaResponse,
} from "../types/api";

const API_BASE = "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
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
    throw new ApiError(0, "Could not reach the API. Is uvicorn running on localhost:8000?");
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
