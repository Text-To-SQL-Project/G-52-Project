import type {
  AdminConfigResponse,
  HistoryResponse,
  QueryRequest,
  QueryResponse,
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
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(0, "Could not reach the API. Is uvicorn running on localhost:8000?");
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ? JSON.stringify(body.detail) : detail;
    } catch {
      // response wasn't JSON; fall back to statusText
    }
    throw new ApiError(res.status, `Request failed (${res.status}): ${detail}`);
  }

  return (await res.json()) as T;
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
