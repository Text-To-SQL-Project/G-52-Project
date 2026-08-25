const STORAGE_KEY = "text2sql_session_id";

/** Stable per-browser session id, persisted in localStorage, sent on every
 * query so the History screen can group a user's own queries. */
export function getSessionId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // localStorage unavailable (private mode, etc.) -- fall back to an
    // in-memory id for this page load only.
    return crypto.randomUUID();
  }
}
