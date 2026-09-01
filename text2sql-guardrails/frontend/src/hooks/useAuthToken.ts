const STORAGE_KEY = "text2sql_auth_token";

/** Fires whenever the stored token changes (login, logout, or a 401
 * forcing a logout mid-session) so App.tsx can re-render the login gate
 * without a full page reload. Not a generic pub/sub -- just this one
 * signal, matching Task 4's "simplest that's safe" scope. */
export const AUTH_CHANGED_EVENT = "text2sql:auth-changed";

export function getToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // localStorage unavailable (private mode, etc.) -- the session just
    // won't survive a reload; nothing else to do about it here.
  }
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function clearToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore, same as above
  }
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}
