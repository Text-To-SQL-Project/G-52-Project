import { useState } from "react";
import { ApiError, login } from "../api/client";
import { setToken } from "../hooks/useAuthToken";

export function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!username || !password || loading) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await login({ username, password });
      setToken(resp.token);
    } catch (e) {
      // The backend returns the identical detail for "wrong password" and
      // "no OPERATOR_PASSWORD configured" is a 500, not a 401 -- either
      // way, show one generic message rather than parroting server detail
      // back (same reasoning as Task 1: don't forward raw backend text to
      // an unauthenticated screen).
      // ONE message for every credential failure. The server deliberately
      // returns an identical 401 for unknown username, wrong password and
      // deactivated account (app/auth.py::authenticate), and it equalises
      // the timing too. Saying "no such user" here would hand that
      // enumeration oracle straight back through the UI.
      setError(
        e instanceof ApiError
          ? "Incorrect username or password."
          : "Could not reach the server."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative z-[1] flex min-h-screen items-center justify-center px-6 py-10">
      <div className="animate-rise w-full max-w-sm">
        <div className="rounded-2xl border border-white/[0.12] bg-[#131d33]/88 shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_28px_64px_-32px_rgba(0,0,0,0.95)]">
          <div className="px-6 pt-6 pb-5">
            <h1 className="text-lg font-semibold tracking-[-0.01em] text-white">
              Text-to-SQL Guardrails
            </h1>
            <p className="mt-1 text-sm text-white/45">Sign in with your account to continue.</p>
          </div>

          <div className="border-t border-white/[0.07] px-6 py-5">
            <label
              htmlFor="username"
              className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.09em] text-white/45"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              className="mb-4 w-full rounded-lg border border-white/10 bg-[#020617]/60 px-3.5 py-2.5 text-sm text-white transition duration-200 placeholder:text-white/25 focus:border-blue-400/50 focus:bg-[#020617]/80 focus:outline-none focus:ring-2 focus:ring-blue-400/20"
              placeholder="e.g. student1"
            />

            <label
              htmlFor="password"
              className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.09em] text-white/45"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              className="w-full rounded-lg border border-white/10 bg-[#020617]/60 px-3.5 py-2.5 text-sm text-white transition duration-200 placeholder:text-white/25 focus:border-blue-400/50 focus:bg-[#020617]/80 focus:outline-none focus:ring-2 focus:ring-blue-400/20"
              placeholder="••••••••"
            />

            {/* Neutral slate, matching ErrorPanel and the ERROR state: a failed
                sign-in is the system saying no, not a guardrail verdict, and
                red is reserved for the latter. */}
            {error && (
              <div className="animate-rise mt-3 flex items-start gap-2.5 rounded-lg border border-slate-300/20 bg-slate-300/[0.06] px-3 py-2.5">
                <span
                  aria-hidden
                  className="mt-px inline-flex h-[15px] w-[15px] shrink-0 rotate-45 items-center justify-center rounded-[2px] border border-slate-200/80 text-slate-100"
                >
                  <span className="block -rotate-45 text-[9px] font-bold leading-none">!</span>
                </span>
                <p className="text-[13px] leading-relaxed text-slate-200/80">{error}</p>
              </div>
            )}

            <button
              onClick={submit}
              disabled={loading || !username || !password}
              className="relative mt-4 w-full overflow-hidden rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition duration-200 before:absolute before:inset-0 before:-translate-x-full before:bg-gradient-to-r before:from-transparent before:via-white/25 before:to-transparent before:transition-transform before:duration-700 before:content-[''] hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1120] enabled:hover:shadow-[0_10px_24px_-10px_rgba(37,99,235,0.8)] enabled:hover:before:translate-x-full disabled:cursor-not-allowed disabled:bg-white/[0.07] disabled:text-white/25"
            >
              <span className="relative flex items-center justify-center gap-2">
                {loading && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                )}
                {loading ? "Signing in…" : "Sign in"}
              </span>
            </button>
          </div>

          {/* The same indeterminate sweep the Workspace uses while a query is in
              flight, so "the system is working" looks identical on every screen.
              Holds its track height whether or not it is running, so the card
              does not change size mid-request. */}
          <div className="relative h-[2px] overflow-hidden rounded-b-2xl bg-white/[0.06]">
            {loading && (
              <div className="animate-sweep absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-blue-400 to-transparent" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
