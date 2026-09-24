import { useState, useRef, useEffect } from "react";
import { gsap } from "gsap";
import { ApiError, login } from "../api/client";
import { setToken } from "../hooks/useAuthToken";

const DEMO_PERSONAS = [
  {
    name: "Student",
    username: "student1",
    password: "twX92dZcZCL-dXuLATX7S-LoJH2b",
  },
  {
    name: "Faculty",
    username: "faculty1",
    password: "FJ82fzygY8AAP538JaizvbORHgK4",
  },
  {
    name: "Admin",
    username: "admin",
    password: "BHe3TjQIgh7zL0zOr9B7Z1SNaHP8",
  },
];

export function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (formRef.current) {
      const children = formRef.current.children;
      gsap.fromTo(
        children,
        { opacity: 0, y: 30 },
        {
          opacity: 1,
          y: 0,
          duration: 0.6,
          stagger: 0.1,
          ease: "expo.out",
          delay: 0.3,
        }
      );
    }
  }, []);

  // Magnetic button
  useEffect(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const onMove = (e: MouseEvent) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      gsap.to(btn, { x: x * 0.15, y: y * 0.15, duration: 0.3, ease: "power2.out" });
    };
    const onLeave = () => {
      gsap.to(btn, { x: 0, y: 0, duration: 0.5, ease: "elastic.out(1, 0.4)" });
    };
    btn.addEventListener("mousemove", onMove);
    btn.addEventListener("mouseleave", onLeave);
    return () => {
      btn.removeEventListener("mousemove", onMove);
      btn.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  const submit = async (u = username, p = password) => {
    if (!u || !p || loading) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await login({ username: u, password: p });
      setToken(resp.token);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) {
          setError("Incorrect username or password.");
        } else if (e.status === 0) {
          setError("Cannot reach backend server. Please ensure the API is running on localhost:8000.");
        } else {
          setError(e.message || "Authentication failed.");
        }
      } else {
        setError("Could not reach the server.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPersona = (persona: typeof DEMO_PERSONAS[0]) => {
    setUsername(persona.username);
    setPassword(persona.password);
    setError(null);
  };

  return (
    <div
      className="relative z-[1] flex min-h-screen items-center justify-center px-5 py-12"
    >
      {/* Ambient orb glow behind the form */}
      <div
        className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: "500px",
          height: "500px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(245, 158, 11, 0.08) 0%, transparent 70%)",
          animation: "glow-pulse 4s ease-in-out infinite",
        }}
      />

      <div ref={formRef} className="w-full max-w-md space-y-0">
        {/* Brand — oversized, editorial */}
        <div className="mb-10 text-center" style={{ opacity: 0 }}>
          <div
            className="mx-auto mb-4 flex h-10 w-10 items-center justify-center"
            style={{
              border: "1px solid var(--border-accent)",
              background: "var(--accent-dim)",
              borderRadius: "2px",
              boxShadow: "0 0 25px var(--accent-glow)",
            }}
          >
            <span className="material-symbols-outlined text-[24px]" style={{ color: "var(--accent)" }}>
              terminal
            </span>
          </div>
          <h1
            className="font-display font-bold text-white"
            style={{ fontSize: "clamp(1.75rem, 5vw, 2.5rem)", letterSpacing: "-0.04em" }}
          >
            SQL<span style={{ color: "var(--accent)" }}>.</span>AI{" "}
            <span className="gradient-text">Guardrails</span>
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            Sign in to access your secure Text-to-SQL workspace
          </p>
        </div>

        {/* Demo personas — hairline-divided row, not cards */}
        <div className="mb-8" style={{ opacity: 0 }}>
          <div className="mb-3 flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Demo Accounts
            </p>
            <span className="pill-tag px-2 py-0.5 font-mono text-[9px]">Click to fill</span>
          </div>
          <div className="flex gap-0" style={{ border: "1px solid var(--border-subtle)", borderRadius: "2px" }}>
            {DEMO_PERSONAS.map((persona, i) => (
              <button
                key={persona.username}
                type="button"
                onClick={() => handleSelectPersona(persona)}
                className="flex flex-1 flex-col items-center py-3 transition-colors duration-200 focus-visible:outline-none"
                style={{
                  background:
                    username === persona.username ? "var(--accent-dim)" : "transparent",
                  borderRight:
                    i < DEMO_PERSONAS.length - 1 ? "1px solid var(--border-subtle)" : "none",
                  color:
                    username === persona.username ? "var(--accent)" : "var(--text-secondary)",
                }}
                onMouseEnter={(e) => {
                  if (username !== persona.username) {
                    e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                    e.currentTarget.style.color = "var(--text-primary)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (username !== persona.username) {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--text-secondary)";
                  }
                }}
              >
                <span className="font-sans text-xs font-semibold">{persona.name}</span>
                <span className="font-mono text-[10px]" style={{ opacity: 0.7 }}>
                  {persona.username}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Form — line-draw inputs */}
        <div className="space-y-6" style={{ opacity: 0 }}>
          <div>
            <label
              htmlFor="username"
              className="mb-2 block font-mono text-[11px] uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
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
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              className="signal-input"
              placeholder="e.g. student1"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-2 block font-mono text-[11px] uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              className="signal-input"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div
              className="animate-rise flex items-center gap-2.5 py-2.5 text-xs"
              style={{
                borderLeft: "2px solid var(--danger)",
                paddingLeft: "12px",
                color: "#fca5a5",
              }}
            >
              <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--danger)" }}>
                error
              </span>
              <span>{error}</span>
            </div>
          )}

          <button
            ref={buttonRef}
            onClick={() => submit()}
            disabled={loading || !username || !password}
            className="glow-button mt-4 flex w-full items-center justify-center gap-2 py-3 font-sans text-sm font-semibold transition"
            style={{ borderRadius: "2px" }}
          >
            {loading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
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

        {/* Bottom accent line */}
        <div
          className="relative mt-8 h-[1px] overflow-hidden"
          style={{ background: "var(--border-subtle)", opacity: 0 }}
        >
          {loading && (
            <div
              className="animate-sweep absolute inset-y-0 w-1/3"
              style={{ background: `linear-gradient(to right, transparent, var(--accent), transparent)` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
