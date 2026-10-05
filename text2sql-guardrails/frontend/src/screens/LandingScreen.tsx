import { lazy, Suspense, useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { ThemeToggle } from "../components/ThemeToggle";

gsap.registerPlugin(ScrollTrigger);
const AiOrb = lazy(() => import("../components/AiOrb").then((m) => ({ default: m.AiOrb })));

// Illustrative only: shaped like real answers from the college_erp schema.
const DEMOS = [
  {
    q: "How many students are there in each department?",
    sql: ["SELECT d.department_name, COUNT(*) AS students", "FROM students s", "JOIN departments d USING (department_id)", "GROUP BY d.department_name", "ORDER BY students DESC;"],
    rows: [["Computer Science", "412"], ["Mechanical", "298"], ["Civil", "201"]],
    score: 92,
  },
  {
    q: "Show my attendance percentage by subject",
    sql: ["SELECT sub.subject_name,", "       ROUND(100.0 * AVG(a.present::int), 1) AS pct", "FROM attendance a JOIN subjects sub USING (subject_id)", "GROUP BY sub.subject_name;", "-- scoped to you by row-level security"],
    rows: [["Data Structures", "91.2"], ["Operating Systems", "84.7"], ["Discrete Math", "78.9"]],
    score: 88,
  },
  {
    q: "DROP TABLE students;",
    sql: ["-- Blocked before execution", "-- Statement type: Drop (destructive DDL)", "-- Guardrail: AST check, no LLM involved"],
    rows: [],
    score: 0,
  },
];

const STEPS = [
  { k: "01", t: "Generate", d: "The model writes one PostgreSQL query from your question and the live schema. Ambiguous questions come back as a clarifying question, not a guess." },
  { k: "02", t: "Guard", d: "The query is parsed into an AST and checked: anything that writes, drops, or nests too deep is blocked before it reaches the database." },
  { k: "03", t: "Scope", d: "It runs as a read-only role with row-level security bound to you, so a student's query physically cannot return another student's rows." },
  { k: "04", t: "Execute", d: "A per-query timeout and row cap keep a heavy question from slowing everyone else down." },
  { k: "05", t: "Score", d: "Independent checks (schema alignment, back-translation, result sanity) are fused into a confidence score, so you know when to double-check." },
];

const STATS = [
  { v: "0", l: "destructive queries executed", n: "across the full adversarial evaluation" },
  { v: "30/30", l: "direct SQL attacks blocked", n: "by the AST guardrail alone" },
  { v: "0.714", l: "execution accuracy", n: "161-question golden set" },
  { v: "2 s", l: "median answer time", n: "measured end to end (1.7–2.4 s)" },
];

const ROLES = [
  { r: "Student", icon: "school", d: "Asks about their own marks, attendance, fees and placements. Everyone else's rows are invisible at the database level." },
  { r: "Faculty", icon: "co_present", d: "Sees the sections and subjects they teach: class attendance, marks distributions, who needs attention." },
  { r: "Admin", icon: "admin_panel_settings", d: "Full access, schema explorer, and the audit trail of every blocked query and every guardrail decision." },
];

function DemoConsole() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current!;
    const q = el.querySelector<HTMLSpanElement>("[data-q]")!;
    const sqlBox = el.querySelector<HTMLDivElement>("[data-sql]")!;
    const rowsBox = el.querySelector<HTMLDivElement>("[data-rows]")!;
    const score = el.querySelector<HTMLSpanElement>("[data-score]")!;
    const ring = el.querySelector<SVGCircleElement>("[data-ring]")!;
    const status = el.querySelector<HTMLSpanElement>("[data-status]")!;

    const paint = (i: number) => {
      const d = DEMOS[i];
      sqlBox.innerHTML = d.sql.map((l) => `<div class="demo-line">${l.replace(/</g, "&lt;")}</div>`).join("");
      rowsBox.innerHTML = d.rows.length
        ? d.rows.map(([a, b]) => `<div class="demo-row"><span>${a}</span><span class="demo-num">${b}</span></div>`).join("")
        : `<div class="demo-row demo-blocked"><span>Not executed: blocked by guardrails</span></div>`;
      status.textContent = d.rows.length ? "success" : "blocked";
      status.dataset.kind = d.rows.length ? "ok" : "blocked";
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      paint(0);
      q.textContent = DEMOS[0].q;
      score.textContent = String(DEMOS[0].score);
      ring.style.strokeDashoffset = String(100 - DEMOS[0].score);
      return;
    }

    const tl = gsap.timeline({ repeat: -1, paused: true });
    DEMOS.forEach((d, i) => {
      const typed = { n: 0 };
      tl.call(() => paint(i))
        .set(q, { textContent: "" })
        .set([".demo-line", ".demo-row"].map((s) => el.querySelectorAll(s)), { opacity: 0, y: 8 })
        .set(score, { textContent: "0" })
        .set(ring, { strokeDashoffset: 100 })
        .to(typed, {
          n: d.q.length, duration: d.q.length * 0.035, ease: "none",
          onUpdate: () => { q.textContent = d.q.slice(0, Math.round(typed.n)); },
        })
        .to(() => sqlBox.querySelectorAll(".demo-line"), { opacity: 1, y: 0, stagger: 0.09, duration: 0.4, ease: "expo.out" }, "+=0.25")
        .to(() => rowsBox.querySelectorAll(".demo-row"), { opacity: 1, y: 0, stagger: 0.08, duration: 0.45, ease: "expo.out" }, "+=0.1")
        .to(ring, { strokeDashoffset: 100 - d.score, duration: 0.9, ease: "expo.out" }, "<")
        .to({ v: 0 }, {
          v: d.score, duration: 0.9, ease: "expo.out",
          onUpdate() { score.textContent = String(Math.round(this.targets()[0].v)); },
        }, "<")
        .to({}, { duration: 2.6 });
    });
    // Only animate while on screen.
    const st = ScrollTrigger.create({ trigger: el, start: "top bottom", end: "bottom top", onToggle: (s) => (s.isActive ? tl.play() : tl.pause()) });
    return () => { st.kill(); tl.kill(); };
  }, []);

  return (
    <div ref={root} className="landing-console" role="img" aria-label="Example: a question becomes guarded SQL, results and a confidence score">
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div className="flex gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 rounded-full" style={{ background: "var(--border-hover)" }} />)}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>illustrative example</span>
      </div>
      <div className="space-y-4 p-5">
        <p className="min-h-[1.5rem] font-sans text-[15px]" style={{ color: "var(--text-primary)" }}>
          <span data-q />
          <span className="landing-caret" aria-hidden />
        </p>
        <div data-sql className="landing-sql font-mono text-[12.5px] leading-relaxed" />
        <div className="grid grid-cols-[1fr_auto] items-end gap-5">
          <div data-rows className="space-y-1 font-mono text-[12px]" />
          <div className="flex flex-col items-center gap-1">
            <svg viewBox="0 0 36 36" className="h-14 w-14 -rotate-90" aria-hidden>
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--border-subtle)" strokeWidth="3" />
              <circle data-ring cx="18" cy="18" r="15.9" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" pathLength={100} strokeDasharray="100" strokeDashoffset="100" />
            </svg>
            <span className="font-mono text-[11px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
              <span data-score>0</span>% · <span data-status className="landing-status" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingScreen({ onSignIn }: { onSignIn: () => void }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mm = gsap.matchMedia();
    let lenis: Lenis | null = null;
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      lenis = new Lenis({ duration: 1.1, smoothWheel: true });
      lenis.on("scroll", ScrollTrigger.update);
      const raf = (t: number) => lenis?.raf(t * 1000);
      gsap.ticker.add(raf);
      gsap.ticker.lagSmoothing(0);

      const ctx = gsap.context(() => {
        gsap.from(".hero-word", { yPercent: 110, opacity: 0, duration: 1.1, stagger: 0.06, ease: "expo.out", delay: 0.15 });
        gsap.from(".hero-fade", { y: 18, opacity: 0, duration: 0.9, stagger: 0.1, ease: "expo.out", delay: 0.55 });
        gsap.utils.toArray<HTMLElement>(".reveal").forEach((el) =>
          gsap.from(el, { y: 36, opacity: 0, duration: 1, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 85%" } }),
        );
        gsap.from(".stat", { y: 30, opacity: 0, stagger: 0.08, duration: 0.9, ease: "expo.out", scrollTrigger: { trigger: ".stats", start: "top 80%" } });
        // Pipeline: the rail fills with scroll and each step lights up as it's passed.
        gsap.fromTo(".rail-fill", { scaleY: 0 }, { scaleY: 1, ease: "none", scrollTrigger: { trigger: ".pipeline", start: "top 65%", end: "bottom 60%", scrub: 0.6 } });
        gsap.utils.toArray<HTMLElement>(".step").forEach((el) =>
          ScrollTrigger.create({ trigger: el, start: "top 62%", onEnter: () => el.classList.add("is-on"), onLeaveBack: () => el.classList.remove("is-on") }),
        );
        gsap.to(".mesh", { yPercent: 18, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
      }, root);
      return () => {
        ctx.revert();
        gsap.ticker.remove(raf);
        lenis?.destroy();
      };
    });
    mm.add("(prefers-reduced-motion: reduce)", () => {
      root.current?.querySelectorAll(".step").forEach((el) => el.classList.add("is-on"));
    });
    return () => mm.revert();
  }, []);

  const headline = "Ask your database anything. It can't be talked into breaking it.".split(" ");

  return (
    <div ref={root} className="relative z-[1] min-h-screen">
      <header className="landing-nav sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3 sm:px-8">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center" style={{ border: "1px solid var(--border-accent)", background: "var(--accent-dim)", borderRadius: "2px" }}>
              <span className="material-symbols-outlined text-[18px]" style={{ color: "var(--accent)" }}>terminal</span>
            </span>
            <span className="font-display text-sm font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
              SQL.AI <span style={{ color: "var(--accent)" }}>Guardrails</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button onClick={onSignIn} className="glow-button px-4 py-1.5 text-xs" style={{ borderRadius: "2px" }}>Sign in</button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="hero relative overflow-hidden">
        <div aria-hidden className="mesh pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pt-16 pb-24 sm:px-8 lg:grid-cols-12 lg:pt-24">
          <div className="lg:col-span-7">
            <p className="hero-fade pill-tag mb-6 inline-flex items-center gap-2 px-3 py-1 font-mono text-[11px] uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--success)" }} /> Text-to-SQL for the college ERP
            </p>
            <h1 className="font-display font-bold tracking-tight" style={{ fontSize: "clamp(2.25rem, 5.4vw, 4.25rem)", lineHeight: 1.02, letterSpacing: "-0.035em", color: "var(--text-primary)" }}>
              {headline.map((w, i) => (
                <span key={i} className="inline-block overflow-hidden pb-1 align-bottom">
                  <span className={`hero-word inline-block ${i >= 4 ? "gradient-text-amber" : ""}`}>{w}&nbsp;</span>
                </span>
              ))}
            </h1>
            <p className="hero-fade mt-6 max-w-xl text-base leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Plain-English questions become guarded PostgreSQL. Every query is parsed, scoped to the
              person asking, and scored for confidence before you see a single row.
            </p>
            <div className="hero-fade mt-9 flex flex-wrap items-center gap-3">
              <button onClick={onSignIn} className="glow-button flex items-center gap-2 px-6 py-3 text-sm" style={{ borderRadius: "2px" }}>
                Sign in to the workspace
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </button>
              <a href="#how" className="landing-link px-4 py-3 text-sm">See how it stays safe</a>
            </div>
          </div>
          <div className="hero-fade relative lg:col-span-5">
            <div className="relative mx-auto aspect-square w-full max-w-[380px]">
              <Suspense fallback={null}>
                <AiOrb status="ready" className="h-full w-full" />
              </Suspense>
            </div>
          </div>
        </div>
      </section>

      {/* Demo */}
      <section className="mx-auto max-w-6xl px-5 pb-28 sm:px-8">
        <div className="grid items-center gap-10 lg:grid-cols-12">
          <div className="reveal lg:col-span-5">
            <p className="landing-eyebrow">What you get back</p>
            <h2 className="landing-h2">An answer, the SQL behind it, and how sure to be.</h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Nothing is hidden: you can read and edit the query, see which tables it touched, and
              get a confidence score that tells you when a result deserves a second look.
            </p>
          </div>
          <div className="reveal min-w-0 lg:col-span-7"><DemoConsole /></div>
        </div>
      </section>

      {/* Pipeline */}
      <section id="how" className="mx-auto max-w-6xl px-5 pb-28 sm:px-8">
        <div className="reveal mb-14 max-w-2xl">
          <p className="landing-eyebrow">How a question becomes an answer</p>
          <h2 className="landing-h2">Five steps. The model only writes the first one.</h2>
        </div>
        <ol className="pipeline relative ml-3 space-y-12 pl-10 sm:ml-6">
          <span aria-hidden className="absolute top-1 bottom-1 left-0 w-px" style={{ background: "var(--border-hairline)" }} />
          <span aria-hidden className="rail-fill absolute top-1 bottom-1 left-0 w-px origin-top" style={{ background: "linear-gradient(var(--accent-bright), var(--accent))" }} />
          {STEPS.map((s) => (
            <li key={s.k} className="step relative">
              <span aria-hidden className="step-dot absolute top-1.5 -left-[2.85rem] h-3 w-3 rounded-full" />
              <div className="grid gap-2 sm:grid-cols-[9.5rem_1fr] sm:gap-8">
                <p className="flex items-baseline gap-3 whitespace-nowrap font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                  {s.k} <span className="step-title font-display text-lg font-bold">{s.t}</span>
                </p>
                <p className="max-w-2xl text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Stats */}
      <section className="mx-auto max-w-6xl px-5 pb-28 sm:px-8">
        <div className="stats grid grid-cols-2 lg:grid-cols-4" style={{ borderTop: "1px solid var(--border-subtle)", borderLeft: "1px solid var(--border-subtle)" }}>
          {STATS.map((s) => (
            <div key={s.l} className="stat p-6" style={{ borderRight: "1px solid var(--border-subtle)", borderBottom: "1px solid var(--border-subtle)" }}>
              <p className="font-display font-bold tabular-nums" style={{ fontSize: "clamp(1.9rem, 3.4vw, 2.6rem)", letterSpacing: "-0.03em", color: "var(--text-primary)" }}>{s.v}</p>
              <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>{s.l}</p>
              <p className="mt-1 font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>{s.n}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>From the project's published evaluation; details in the admin console.</p>
      </section>

      {/* Roles */}
      <section className="mx-auto max-w-6xl px-5 pb-28 sm:px-8">
        <div className="reveal mb-10 max-w-2xl">
          <p className="landing-eyebrow">One workspace, three views of the data</p>
          <h2 className="landing-h2">Who you are decides what exists.</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {ROLES.map((r) => (
            <article key={r.r} className="reveal landing-card p-6">
              <span className="material-symbols-outlined text-[22px]" style={{ color: "var(--accent)" }}>{r.icon}</span>
              <h3 className="mt-4 font-display text-lg font-bold" style={{ color: "var(--text-primary)" }}>{r.r}</h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>{r.d}</p>
            </article>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 pb-24 sm:px-8">
        <div className="reveal landing-cta relative overflow-hidden px-8 py-14 text-center sm:px-16">
          <h2 className="landing-h2 mx-auto max-w-2xl">Your questions, answered safely.</h2>
          <p className="mx-auto mt-4 max-w-lg text-sm" style={{ color: "var(--text-secondary)" }}>
            Sign in with your college account or with Google, if your administrator has linked it.
          </p>
          <button onClick={onSignIn} className="glow-button mt-8 inline-flex items-center gap-2 px-7 py-3 text-sm" style={{ borderRadius: "2px" }}>
            Sign in <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-8 font-mono text-[11px] sm:px-8" style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)" }}>
        <span>SQL.AI Guardrails · college_erp</span>
        <span>Read-only by default · RLS-scoped · Every query audited</span>
      </footer>
    </div>
  );
}
