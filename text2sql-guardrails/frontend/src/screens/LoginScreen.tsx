import { useState } from "react";
import { ApiError, login } from "../api/client";
import { setToken } from "../hooks/useAuthToken";

const DEMO_PERSONAS = [
  {
    name: "Student",
    username: "student1",
    password: "twX92dZcZCL-dXuLATX7S-LoJH2b",
    color: "border-cyan-400/40 hover:bg-cyan-500/10 text-cyan-300",
  },
  {
    name: "Faculty",
    username: "faculty1",
    password: "FJ82fzygY8AAP538JaizvbORHgK4",
    color: "border-indigo-400/40 hover:bg-indigo-500/10 text-indigo-300",
  },
  {
    name: "Admin",
    username: "admin",
    password: "BHe3TjQIgh7zL0zOr9B7Z1SNaHP8",
    color: "border-purple-400/40 hover:bg-purple-500/10 text-purple-300",
  },
];

export function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (u = username, p = password) => {
    if (!u || !p || loading) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await login({ username: u, password: p });
      setToken(resp.token);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? "Incorrect username or password."
          : "Could not reach the server."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPersona = (persona: typeof DEMO_PERSONAS[0], autoLogin = false) => {
    setUsername(persona.username);
    setPassword(persona.password);
    setError(null);
    if (autoLogin) {
      submit(persona.username, persona.password);
    }
  };

  return (
    <div className="relative z-[1] flex min-h-screen items-center justify-center px-4 py-12 sm:px-6">
      <div className="animate-rise w-full max-w-md">
        <div className="glass-card relative overflow-hidden rounded-3xl border border-white/[0.12] p-8 shadow-[0_20px_50px_rgba(0,0,0,0.8)]">
          {/* Subtle top glow */}
          <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-indigo-500/20 blur-3xl" />

          {/* Header & Brand */}
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-500/30 bg-indigo-600/20 shadow-[0_0_25px_rgba(99,102,241,0.3)]">
              <span className="material-symbols-outlined text-[26px] text-indigo-400">terminal</span>
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-white">
              SQL.AI <span className="gradient-text font-semibold">Guardrails</span>
            </h1>
            <p className="mt-1.5 font-sans text-xs text-white/50">
              Sign in to access your secure Text-to-SQL workspace
            </p>
          </div>

          {/* Demo Persona Quick-Fill Chips */}
          <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-wider text-white/50">
                Demo Accounts (Click to Fill)
              </p>
              <span className="pill-tag-indigo rounded-full px-2 py-0.5 font-mono text-[9px]">
                Auto-Credentials
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {DEMO_PERSONAS.map((persona) => (
                <button
                  key={persona.username}
                  type="button"
                  onClick={() => handleSelectPersona(persona, false)}
                  className={`flex flex-col items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 transition hover:bg-white/[0.08] ${
                    username === persona.username ? "border-indigo-400/80 bg-indigo-500/15" : ""
                  }`}
                >
                  <span className="font-sans text-xs font-semibold text-white/90">
                    {persona.name}
                  </span>
                  <span className={`font-mono text-[10px] ${persona.color}`}>
                    {persona.username}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Form */}
          <div className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="username"
                className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-white/50"
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
                className="w-full rounded-xl border border-white/10 bg-[#060c18]/80 px-4 py-2.5 font-sans text-sm text-white placeholder:text-white/25 focus:border-indigo-400/60 focus:outline-none focus:ring-2 focus:ring-indigo-400/20"
                placeholder="e.g. student1"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-white/50"
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
                className="w-full rounded-xl border border-white/10 bg-[#060c18]/80 px-4 py-2.5 font-sans text-sm text-white placeholder:text-white/25 focus:border-indigo-400/60 focus:outline-none focus:ring-2 focus:ring-indigo-400/20"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="animate-rise flex items-center gap-2.5 rounded-xl border border-rose-500/30 bg-rose-950/30 px-3.5 py-2.5 text-xs text-rose-200">
                <span className="material-symbols-outlined text-[16px] text-rose-400">error</span>
                <span>{error}</span>
              </div>
            )}

            <button
              onClick={() => submit()}
              disabled={loading || !username || !password}
              className="glow-button mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 font-sans text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  <span>Authenticating…</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">lock_open</span>
                  <span>Sign In</span>
                </>
              )}
            </button>
          </div>

          {/* Sweep bar */}
          <div className="relative -mx-8 -mb-8 mt-6 h-[2px] overflow-hidden bg-white/[0.06]">
            {loading && (
              <div className="animate-sweep absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
