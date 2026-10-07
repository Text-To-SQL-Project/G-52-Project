import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Eye, EyeOff, Loader2 } from "lucide-react";
import { ApiError, getAuthProviders, googleLogin, login } from "../api/client";
import { GoogleSignIn } from "../components/GoogleSignIn";
import { ThemeToggle } from "../components/ThemeToggle";
import { EASE, LogoMark, Wordmark } from "../components/kit";
import { setToken } from "../hooks/useAuthToken";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Local development only. Production builds compile this to `[]`: the
// minifier drops the dead branch, so no password ships in the public bundle,
// and the panel below isn't rendered. Deployed accounts use separate passwords.
const DEMO_PERSONAS = import.meta.env.DEV ? [
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
] : [];

const LAYERS = [
  { k: "01", t: "Generate", d: "one SELECT from your words" },
  { k: "02", t: "Guard", d: "AST check, writes rejected" },
  { k: "03", t: "Scope", d: "row-level security bound to you" },
  { k: "04", t: "Execute", d: "read-only role, 2.5 s cap" },
  { k: "05", t: "Score", d: "calibrated confidence" },
];

/** Left panel: a question descends through the five layers on a loop. */
function PipelineArt() {
  const [reduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [lit, setLit] = useState(() => (reduced ? LAYERS.length : -1));
  useEffect(() => {
    if (reduced) return;
    const t = window.setInterval(() => setLit((n) => (n >= LAYERS.length + 2 ? -1 : n + 1)), 650);
    return () => window.clearInterval(t);
  }, [reduced]);

  return (
    <div className="relative">
      <div className="panel crop mb-5 px-4 py-3 font-mono text-[13px] text-foreground">
        <span className="text-brand">›</span> Which departments have the most students?
        <span className="caret" aria-hidden />
      </div>
      <ol className="relative space-y-2 pl-7">
        <span aria-hidden className="absolute top-2 bottom-2 left-[9px] w-px bg-border" />
        <motion.span
          aria-hidden
          className="absolute top-2 left-[9px] w-px origin-top bg-gradient-to-b from-brand to-[var(--brand-bright)]"
          animate={{ height: `${Math.max(0, Math.min(lit, LAYERS.length - 1)) * 20 + (lit >= 0 ? 4 : 0)}%` }}
          transition={{ duration: 0.6, ease: EASE }}
        />
        {LAYERS.map((l, i) => {
          const on = lit >= i;
          return (
            <li key={l.k} className="relative">
              <motion.span
                aria-hidden
                className="absolute top-1/2 -left-[26px] grid size-[18px] -translate-y-1/2 place-items-center rounded-full border"
                animate={{
                  backgroundColor: on ? "var(--brand)" : "var(--card)",
                  borderColor: on ? "var(--brand)" : "var(--border)",
                  scale: lit === i ? 1.2 : 1,
                }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
              >
                <Check className={cn("size-2.5 text-brand-foreground transition-opacity", on ? "opacity-100" : "opacity-0")} strokeWidth={3.5} />
              </motion.span>
              <motion.div
                className="flex items-baseline justify-between gap-4 rounded-lg border px-3.5 py-2.5"
                animate={{
                  borderColor: lit === i ? "rgb(var(--brand-rgb) / 0.45)" : "var(--border)",
                  backgroundColor: lit === i ? "rgb(var(--brand-rgb) / 0.06)" : "rgb(var(--surface-rgb) / 0.6)",
                }}
                transition={{ duration: 0.35 }}
              >
                <span className="flex items-baseline gap-2.5">
                  <span className="font-mono text-[10px] text-muted-foreground">{l.k}</span>
                  <span className={cn("text-sm font-medium transition-colors duration-300", on ? "text-foreground" : "text-muted-foreground")}>{l.t}</span>
                </span>
                <span className="hidden truncate text-xs text-muted-foreground xl:inline">{l.d}</span>
              </motion.div>
            </li>
          );
        })}
      </ol>
      <motion.div
        className="mt-5 grid grid-cols-[1fr_auto] gap-y-1 rounded-lg border border-border bg-card/60 px-4 py-3 font-mono text-xs"
        animate={{ opacity: lit >= LAYERS.length ? 1 : 0.25, y: lit >= LAYERS.length ? 0 : 6 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        {[["Computer Science", "412"], ["Mechanical", "298"], ["Civil", "201"]].map(([a, b]) => (
          <span key={a} className="contents">
            <span className="text-soft">{a}</span>
            <span className="text-right tabular-nums text-brand">{b}</span>
          </span>
        ))}
      </motion.div>
    </div>
  );
}

export function LoginScreen({ onBack }: { onBack?: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);

  useEffect(() => {
    // Shown only when the server has a Google client ID configured.
    getAuthProviders().then((p) => setGoogleClientId(p.google_client_id ?? null)).catch(() => {});
  }, []);

  const signInWithGoogle = async (credential: string) => {
    setLoading(true);
    setError(null);
    try {
      setToken((await googleLogin(credential)).token);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setError(`Too many sign-in attempts. Try again in ${e.retryAfter ?? 60} seconds.`);
      } else if (e instanceof ApiError && (e.status === 403 || e.status === 401)) {
        // Server messages here are written for users ("No account is linked...").
        setError(e.message.replace(/^Request failed \(\d+\): /, ""));
      } else {
        setError(e instanceof ApiError ? e.message : "Google sign-in failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  const submit = async (u = username, p = password) => {
    if (!u || !p || loading) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await login({ username: u, password: p });
      setToken(resp.token);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) setError("Incorrect username or password.");
        else if (e.status === 429) setError(`Too many sign-in attempts. Try again in ${e.retryAfter ?? 60} seconds.`);
        else if (e.status === 0) setError(e.message);
        else setError(e.message || "Authentication failed.");
      } else {
        setError("Could not reach the server.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPersona = (persona: (typeof DEMO_PERSONAS)[0]) => {
    setUsername(persona.username);
    setPassword(persona.password);
    setError(null);
  };

  const item = {
    hidden: { opacity: 0, y: 16, filter: "blur(6px)" },
    show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: EASE } },
  };

  return (
    <div className="relative z-[1] grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand side */}
      <aside className="relative hidden overflow-hidden border-r border-border lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_28rem_at_20%_0%,rgb(var(--brand-rgb)/0.12),transparent_70%)]" />
        <motion.div className="relative flex items-center gap-2.5" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.7, ease: EASE }}>
          <LogoMark className="size-9" />
          <Wordmark />
        </motion.div>
        <motion.div
          className="relative mx-auto w-full max-w-md"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: EASE, delay: 0.15 }}
        >
          <PipelineArt />
        </motion.div>
        <motion.p
          className="relative max-w-sm font-display text-2xl leading-tight text-foreground"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.3 }}
        >
          The model writes the first step<span className="mark-brand">.</span>{" "}
          <span className="text-muted-foreground">Four more decide whether it runs.</span>
        </motion.p>
      </aside>

      {/* Form side */}
      <div className="relative flex min-h-screen flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          {onBack ? (
            <Button type="button" variant="ghost" size="sm" onClick={onBack} className="group -ml-2">
              <ArrowLeft className="transition-transform duration-300 group-hover:-translate-x-0.5" /> Back
            </Button>
          ) : <span />}
          <ThemeToggle />
        </div>

        <motion.div
          className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10"
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } } }}
        >
          <motion.div variants={item} className="mb-8">
            <LogoMark className="mb-6 size-10 lg:hidden" />
            <p className="eyebrow eyebrow-brand">Secure workspace</p>
            <h1 className="font-display mt-3 text-[2.6rem] leading-[0.95] text-foreground">
              Welcome back<span className="mark-brand">.</span>
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Sign in to ask the college database in plain English, scoped to your own role.
            </p>
          </motion.div>

          {DEMO_PERSONAS.length > 0 && (
            <motion.div variants={item} className="mb-6">
              <div className="mb-2 flex items-center justify-between">
                <p className="eyebrow !text-[10px]">Demo accounts</p>
                <span className="font-mono text-[10px] text-muted-foreground">click to fill</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {DEMO_PERSONAS.map((persona) => {
                  const on = username === persona.username;
                  return (
                    <button
                      key={persona.username}
                      type="button"
                      onClick={() => handleSelectPersona(persona)}
                      className={cn(
                        "press spotlight relative flex flex-col items-start rounded-xl border px-3 py-2.5 text-left transition-colors",
                        on ? "border-[rgb(var(--brand-rgb)/0.5)] bg-[rgb(var(--brand-rgb)/0.07)]" : "border-border bg-card/60 hover:border-[rgb(var(--ink-rgb)/0.2)]",
                      )}
                    >
                      <span className={cn("text-xs font-semibold", on ? "text-brand" : "text-foreground")}>{persona.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{persona.username}</span>
                      {on && (
                        <motion.span layoutId="persona-check" className="absolute top-2 right-2 grid size-4 place-items-center rounded-full bg-brand text-brand-foreground">
                          <Check className="size-2.5" strokeWidth={3.5} />
                        </motion.span>
                      )}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}

          <motion.form
            variants={item}
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-xs text-soft">Username</Label>
              <Input
                id="username"
                type="text"
                autoFocus
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. student1"
                className="h-11 rounded-xl bg-card/60 px-3.5 transition-[border-color,box-shadow] focus-visible:border-[rgb(var(--brand-rgb)/0.5)] focus-visible:ring-[rgb(var(--brand-rgb)/0.15)]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs text-soft">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={reveal ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-11 rounded-xl bg-card/60 px-3.5 pr-11 transition-[border-color,box-shadow] focus-visible:border-[rgb(var(--brand-rgb)/0.5)] focus-visible:ring-[rgb(var(--brand-rgb)/0.15)]"
                />
                <button
                  type="button"
                  onClick={() => setReveal((r) => !r)}
                  aria-label={reveal ? "Hide password" : "Show password"}
                  className="press absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:bg-hover hover:text-foreground"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span key={String(reveal)} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.15 }}>
                      {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </motion.span>
                  </AnimatePresence>
                </button>
              </div>
            </div>

            <AnimatePresence initial={false}>
              {error && (
                <motion.div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-xl border border-[rgb(var(--danger-rgb)/0.35)] bg-[rgb(var(--danger-rgb)/0.06)] px-3.5 py-2.5 text-xs text-danger-text"
                  initial={{ opacity: 0, height: 0, x: 0 }}
                  animate={{ opacity: 1, height: "auto", x: [0, -6, 6, -3, 3, 0] }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.45, ease: EASE }}
                >
                  <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <Button
              type="submit"
              variant="brand"
              size="lg"
              disabled={loading || !username || !password}
              data-magnetic="0.1"
              className="group w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" /> Authenticating…
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight className="nudge" />
                </>
              )}
            </Button>
          </motion.form>

          {googleClientId && (
            <motion.div className="mt-5 space-y-4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
              <div className="flex items-center gap-3" aria-hidden>
                <span className="h-px flex-1 bg-border" />
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <GoogleSignIn clientId={googleClientId} onCredential={signInWithGoogle} />
            </motion.div>
          )}

          <motion.p variants={item} className="mt-8 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <span className="live-dot" /> Read-only by default · RLS-scoped · every query audited
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}
