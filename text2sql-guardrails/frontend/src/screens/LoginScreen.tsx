import { useState } from "react";
import { ApiError, login } from "../api/client";
import { setToken } from "../hooks/useAuthToken";

export function LoginScreen() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!password || loading) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await login({ password });
      setToken(resp.token);
    } catch (e) {
      // The backend returns the identical detail for "wrong password" and
      // "no OPERATOR_PASSWORD configured" is a 500, not a 401 -- either
      // way, show one generic message rather than parroting server detail
      // back (same reasoning as Task 1: don't forward raw backend text to
      // an unauthenticated screen).
      setError(e instanceof ApiError ? "Incorrect password." : "Could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative z-[1] flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <h1 className="mb-1 text-lg font-semibold text-white">Text-to-SQL Guardrails</h1>
        <p className="mb-5 text-sm text-white/40">Enter the operator password to continue.</p>

        <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-white/60">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-blue-500/50 focus:outline-none"
          placeholder="••••••••"
        />

        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

        <button
          onClick={submit}
          disabled={loading || !password}
          className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}
