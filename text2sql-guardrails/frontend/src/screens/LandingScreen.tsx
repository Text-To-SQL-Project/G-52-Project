import { useEffect, useRef } from "react";
import { animate, motion, useInView, useMotionValue, useScroll, useSpring, useTransform } from "motion/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import {
  ArrowRight, ArrowUpRight, Gauge, GitBranch, Globe, GraduationCap, History, IdCard, Lock,
  Presentation, ShieldCheck, Timer, type LucideIcon,
} from "lucide-react";
import { OrbStage } from "../components/OrbStage";
import { ThemeToggle } from "../components/ThemeToggle";
import { ADMIN_SAMPLE_QUERIES, FACULTY_SAMPLE_QUERIES, GUEST_SAMPLE_QUERIES, STUDENT_SAMPLE_QUERIES } from "../components/QuestionInput";
import { EASE, LogoMark, Reveal, Wordmark } from "../components/kit";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

gsap.registerPlugin(ScrollTrigger);

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

const WAYS_IN = [
  { k: "01", t: "Sign in", d: "Use your college account, or continue with Google. Any Gmail works: a new address gets guest access straight away, and an admin can link it to your student or faculty record." },
  { k: "02", t: "Ask", d: "Type a question the way you'd ask a colleague. No table names, no joins. If it's ambiguous, you get a clarifying question back instead of a guess." },
  { k: "03", t: "Review", d: "Read the answer next to the SQL that produced it and a confidence score. Copy the query, export the rows, or refine the question." },
];

const SECURITY: { icon: LucideIcon; t: string; d: string; span?: string }[] = [
  { icon: GitBranch, t: "Parsed, not trusted", d: "Every generated query is parsed into a syntax tree. Writes, DDL, multiple statements and runaway nesting are rejected before execution.", span: "lg:col-span-2" },
  { icon: Lock, t: "Read-only by construction", d: "Queries run as a database role with SELECT rights only. Even a query that slipped past the parser could not change a row." },
  { icon: IdCard, t: "Row-level security", d: "Postgres policies bind each session to the signed-in user, so filtering happens in the database, not in a prompt." },
  { icon: Timer, t: "Bounded cost", d: "A 2.5 s statement timeout and a row cap stop one heavy question from slowing the system for everyone else." },
  { icon: Gauge, t: "Rate limited", d: "Sign-in and query endpoints are rate limited per client, and model calls share a fixed per-minute budget." },
  { icon: History, t: "Every query audited", d: "Questions, generated SQL and every guardrail decision are logged, and admins can review blocked attempts.", span: "lg:col-span-2" },
];

const DATA_FACTS = [
  { v: "25", l: "tables in the college ERP schema" },
  { v: "~190k", l: "rows of realistic college data" },
  { v: "6", l: "domains: academics, attendance, marks, fees, library, placements" },
  { v: "4", l: "roles, each seeing a different slice" },
];

const ASK_GROUPS = [
  { r: "Student", qs: STUDENT_SAMPLE_QUERIES },
  { r: "Faculty", qs: FACULTY_SAMPLE_QUERIES },
  { r: "Admin", qs: ADMIN_SAMPLE_QUERIES },
  { r: "Guest", qs: GUEST_SAMPLE_QUERIES },
];

const FAQ = [
  { q: "Can a question change or delete data?", a: "No. Generated SQL is checked by an AST guardrail that only admits read queries, and it then runs as a read-only database role. Both layers would have to fail, and the second one can't." },
  { q: "What can I see if I sign in as a guest?", a: "Public reference data only: departments, programs, subjects, exams, library books and placement drives. Personal tables such as marks, attendance and fees return no rows for a guest, because the database policies match nothing." },
  { q: "How do I get student or faculty access?", a: "Sign in once with Google, then ask an administrator to link your email to your college record. Your next sign-in opens your own data." },
  { q: "How is the confidence score worked out?", a: "Independent checks (schema alignment, translating the SQL back into English and comparing it with your question, and result sanity) are combined and calibrated against a labelled evaluation set." },
  { q: "Which language model writes the SQL?", a: "Gemini by default, behind a provider-agnostic client. Administrators can also run a pool of their own API keys through a LiteLLM proxy." },
  { q: "Is the SQL shown to me?", a: "Always. Every answer comes with the exact query that produced it, which you can copy and run elsewhere." },
];

const ROLES: { r: string; icon: LucideIcon; d: string }[] = [
  { r: "Student", icon: GraduationCap, d: "Asks about their own marks, attendance, fees and placements. Everyone else's rows are invisible at the database level." },
  { r: "Faculty", icon: Presentation, d: "Sees the sections and subjects they teach: class attendance, marks distributions, who needs attention." },
  { r: "Admin", icon: ShieldCheck, d: "Reads every record (still read-only, still guarded), plus the schema explorer and the audit trail of every blocked query." },
  { r: "Guest", icon: Globe, d: "Anyone with a Google account. Explores public reference data (departments, programs, subjects, library, placements) with no personal rows." },
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
      sqlBox.innerHTML = d.sql
        .map((l, n) => `<div class="demo-line flex gap-4"><span class="w-4 shrink-0 text-right text-muted-foreground select-none">${n + 1}</span><span>${l.replace(/</g, "&lt;")}</span></div>`)
        .join("");
      rowsBox.innerHTML = d.rows.length
        ? d.rows.map(([a, b]) => `<div class="demo-row"><span>${a}</span><span class="demo-num">${b}</span></div>`).join("")
        : `<div class="demo-row demo-blocked"><span>Not executed: blocked by guardrails</span></div>`;
      status.textContent = d.rows.length ? "success" : "blocked";
      status.dataset.kind = d.rows.length ? "ok" : "blocked";
      ring.style.stroke = d.rows.length ? "var(--brand)" : "var(--destructive)";
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
    <div ref={root} className="panel crop spotlight overflow-hidden" role="img" aria-label="Example: a question becomes guarded SQL, results and a confidence score">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-1.5" aria-hidden>
          {["var(--destructive)", "var(--warning)", "var(--success)"].map((c) => (
            <span key={c} className="size-2.5 rounded-full opacity-70" style={{ background: c }} />
          ))}
        </div>
        <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">illustrative example</span>
      </div>
      <div className="space-y-4 p-5">
        <p className="flex min-h-[1.5rem] items-baseline gap-2 text-[15px] text-foreground">
          <span className="font-mono text-brand">›</span>
          <span>
            <span data-q />
            <span className="caret" aria-hidden />
          </span>
        </p>
        <div data-sql className="code-surface min-h-[8rem] overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre text-soft" />
        <div className="grid grid-cols-[1fr_auto] items-end gap-6">
          <div data-rows className="space-y-0.5 font-mono text-[12px]" />
          <div className="flex flex-col items-center gap-1.5">
            <div className="relative">
              <svg viewBox="0 0 36 36" className="size-16 -rotate-90" aria-hidden>
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--border)" strokeWidth="2.5" />
                <circle data-ring cx="18" cy="18" r="15.9" fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinecap="round" pathLength={100} strokeDasharray="100" strokeDashoffset="100" />
              </svg>
              <span className="absolute inset-0 grid place-items-center font-mono text-[13px] font-semibold tabular-nums text-foreground">
                <span><span data-score>0</span><span className="text-[9px] text-muted-foreground">%</span></span>
              </span>
            </div>
            <span data-status className="landing-status font-mono text-[10px] tracking-wider uppercase" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** "30/30" → counts 0→30 keeping "/30"; "0.714" keeps 3 decimals; "2 s" keeps the unit. */
function StatValue({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -15% 0px" });
  const m = /^(\d+(?:\.(\d+))?)(.*)$/s.exec(value);
  const mv = useMotionValue(0);
  useEffect(() => {
    if (!inView || !m || !ref.current) return;
    const decimals = m[2]?.length ?? 0;
    const el = ref.current;
    const controls = animate(mv, parseFloat(m[1]), {
      duration: 1.6,
      ease: EASE,
      onUpdate: (v) => { el.textContent = v.toFixed(decimals) + m[3]; },
    });
    return () => controls.stop();
  }, [inView]); // eslint-disable-line react-hooks/exhaustive-deps -- one count-up per mount
  return <span ref={ref}>{value}</span>;
}

/** Card that tilts toward the pointer in 3D. */
function TiltCard({ children, className }: { children: React.ReactNode; className?: string }) {
  const rx = useSpring(0, { stiffness: 200, damping: 20 });
  const ry = useSpring(0, { stiffness: 200, damping: 20 });
  return (
    <motion.div
      className={className}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        rx.set(((e.clientY - r.top) / r.height - 0.5) * -6);
        ry.set(((e.clientX - r.left) / r.width - 0.5) * 8);
      }}
      onPointerLeave={() => { rx.set(0); ry.set(0); }}
    >
      {children}
    </motion.div>
  );
}

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
    </svg>
  );
}

function SectionHead({ eyebrow, title, lede, center = false }: { eyebrow: string; title: React.ReactNode; lede?: string; center?: boolean }) {
  return (
    <Reveal className={cn("mb-12 max-w-2xl", center && "mx-auto text-center")}>
      <p className={cn("eyebrow eyebrow-brand flex items-center gap-2", center && "justify-center")}>
        <span aria-hidden className="h-px w-6 bg-brand" />
        {eyebrow}
      </p>
      <h2 className="font-display mt-4 text-[clamp(2.1rem,4.4vw,3.4rem)] leading-[0.98] text-foreground text-balance">{title}</h2>
      {lede && <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">{lede}</p>}
    </Reveal>
  );
}

export function LandingScreen({ onSignIn }: { onSignIn: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: hero, offset: ["start start", "end start"] });
  const orbY = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const orbScale = useTransform(scrollYProgress, [0, 1], [1, 0.86]);
  const heroFade = useTransform(scrollYProgress, [0, 0.8], [1, 0]);
  const { scrollYProgress: pageProgress } = useScroll();
  const bar = useSpring(pageProgress, { stiffness: 140, damping: 30 });

  useEffect(() => {
    const mm = gsap.matchMedia();
    let lenis: Lenis | null = null;
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      lenis = new Lenis({ duration: 1.15, smoothWheel: true });
      lenis.on("scroll", ScrollTrigger.update);
      const raf = (t: number) => lenis?.raf(t * 1000);
      gsap.ticker.add(raf);
      gsap.ticker.lagSmoothing(0);
      // In-page anchors glide through Lenis instead of jumping.
      const onClick = (e: MouseEvent) => {
        const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
        if (!a || !lenis) return;
        e.preventDefault();
        lenis.scrollTo(a.getAttribute("href")!, { offset: -72 });
      };
      document.addEventListener("click", onClick);

      const ctx = gsap.context(() => {
        // Pipeline: the rail fills with scroll and each step lights up as it's passed.
        gsap.fromTo(".rail-fill", { scaleY: 0 }, { scaleY: 1, ease: "none", scrollTrigger: { trigger: ".pipeline", start: "top 65%", end: "bottom 60%", scrub: 0.6 } });
        gsap.utils.toArray<HTMLElement>(".step").forEach((el) =>
          ScrollTrigger.create({ trigger: el, start: "top 62%", onEnter: () => el.classList.add("is-on"), onLeaveBack: () => el.classList.remove("is-on") }),
        );
      }, root);
      return () => {
        ctx.revert();
        gsap.ticker.remove(raf);
        document.removeEventListener("click", onClick);
        lenis?.destroy();
      };
    });
    mm.add("(prefers-reduced-motion: reduce)", () => {
      root.current?.querySelectorAll(".step").forEach((el) => el.classList.add("is-on"));
    });
    return () => mm.revert();
  }, []);

  const headline = "Ask your database anything. It can't be talked into breaking it.".split(" ");
  const marquee = ASK_GROUPS.flatMap((g) => g.qs.map((q) => ({ r: g.r, q })));

  return (
    <div ref={root} className="relative z-[1] min-h-screen overflow-x-clip">
      {/* Reading progress */}
      <motion.div aria-hidden className="route-line fixed inset-x-0 top-0 z-50 h-[2px] origin-left" style={{ scaleX: bar }} />

      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6">
        <motion.div
          className="mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-2xl border border-border bg-[rgb(var(--void-rgb)/0.72)] px-3 py-2 shadow-[var(--shadow-lift)] backdrop-blur-xl backdrop-saturate-150 sm:px-4"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE }}
        >
          <a href="#top" className="flex items-center gap-2.5" aria-label="SQL.AI Guardrails, back to top">
            <LogoMark className="size-8" />
            <Wordmark className="hidden sm:inline" />
          </a>
          <nav aria-label="Sections" className="hidden items-center gap-6 text-[13px] text-soft md:flex">
            {[["#product", "Product"], ["#how", "How it works"], ["#security", "Security"], ["#roles", "Roles"], ["#faq", "FAQ"]].map(([h, t]) => (
              <a key={h} href={h} className="link-draw py-1 transition-colors hover:text-foreground">{t}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button onClick={onSignIn} size="sm" className="group">
              Sign in
            </Button>
          </div>
        </motion.div>
      </header>

      <main>

      {/* Hero */}
      <section id="top" ref={hero} className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[44rem] bg-[radial-gradient(50rem_26rem_at_70%_10%,rgb(var(--brand-rgb)/0.13),transparent_70%)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pt-16 pb-20 sm:px-8 lg:grid-cols-12 lg:pt-24 lg:pb-28">
          <motion.div className="lg:col-span-7" style={{ opacity: heroFade }}>
            <motion.p
              className="mb-7 inline-flex items-center gap-2.5 rounded-full border border-border bg-card/70 py-1 pr-3 pl-1.5 text-xs text-soft backdrop-blur-md"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.1 }}
            >
              <span className="rounded-full bg-brand px-2 py-0.5 font-mono text-[10px] font-semibold text-brand-foreground uppercase">New</span>
              Text-to-SQL for the college ERP
              <span className="live-dot" />
            </motion.p>
            <h1 className="font-display text-[clamp(2.9rem,7vw,5.6rem)] leading-[0.92] tracking-[-0.045em] text-foreground">
              {headline.map((w, i) => (
                <span key={i} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
                  <motion.span
                    className={cn("inline-block", i >= 4 && "text-muted-foreground", w === "breaking" && "mark-brand")}
                    initial={{ y: "110%", rotate: 6 }}
                    animate={{ y: 0, rotate: 0 }}
                    transition={{ duration: 1.1, ease: EASE, delay: 0.15 + i * 0.055 }}
                  >
                    {w}&nbsp;
                  </motion.span>
                </span>
              ))}
            </h1>
            <motion.p
              className="mt-7 max-w-xl text-[17px] leading-relaxed text-muted-foreground"
              initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.9, ease: EASE, delay: 0.6 }}
            >
              Plain-English questions become guarded PostgreSQL. Every query is parsed, scoped to the person asking, and
              scored for confidence before you see a single row.
            </motion.p>
            <motion.div
              className="mt-10 flex flex-wrap items-center gap-3"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: EASE, delay: 0.72 }}
            >
              <Button onClick={onSignIn} variant="brand" size="lg" className="group" data-magnetic="0.2">
                Sign in to the workspace
                <ArrowRight className="nudge" />
              </Button>
              <Button asChild variant="outline" size="lg" className="group">
                <a href="#how">
                  See how it stays safe
                  <ArrowUpRight className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </a>
              </Button>
            </motion.div>
            <motion.dl
              className="mt-12 flex flex-wrap gap-x-8 gap-y-3 border-t border-border pt-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 0.95 }}
            >
              {[["0", "writes ever executed"], ["5", "layers per query"], ["~2 s", "to an answer"]].map(([v, l]) => (
                <div key={l} className="flex items-baseline gap-2">
                  <dt className="font-display text-2xl text-foreground">{v}</dt>
                  <dd className="text-xs text-muted-foreground">{l}</dd>
                </div>
              ))}
            </motion.dl>
          </motion.div>

          <motion.div
            className="relative lg:col-span-5"
            style={{ y: orbY, scale: orbScale }}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.4, ease: EASE, delay: 0.3 }}
          >
            <OrbStage className="max-w-[400px]" />
          </motion.div>
        </div>

        {/* Marquee of real example questions */}
        <div className="marquee-mask group relative overflow-hidden border-y border-border bg-card/40 py-4 backdrop-blur-sm">
          <div className="animate-marquee flex w-max gap-3 group-hover:[animation-play-state:paused]">
            {[...marquee, ...marquee].map((m, i) => (
              <span key={i} aria-hidden={i >= marquee.length} className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-background/60 px-3.5 py-1.5 text-[13px] text-soft">
                <span className="font-mono text-[10px] tracking-wider text-brand uppercase">{m.r}</span>
                &ldquo;{m.q}&rdquo;
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Three ways in */}
      <section className="mx-auto max-w-6xl px-5 py-28 sm:px-8">
        <SectionHead eyebrow="Getting started" title={<>Three steps, no SQL<span className="mark-brand">.</span></>} lede="Nothing to install and no schema to learn. Bring a question, leave with an answer you can check." />
        <div className="grid gap-4 md:grid-cols-3">
          {WAYS_IN.map((w, i) => (
            <Reveal key={w.k} delay={i * 0.08}>
              <article className="panel spotlight lift group relative h-full overflow-hidden p-7">
                <span
                  aria-hidden
                  data-n={w.k}
                  className="font-display pointer-events-none absolute -top-4 -right-2 text-[7rem] leading-none text-[rgb(var(--ink-rgb)/0.04)] transition-all duration-700 before:content-[attr(data-n)] group-hover:-translate-y-1 group-hover:text-[rgb(var(--brand-rgb)/0.1)]"
                />
                <p className="font-mono text-xs text-brand">{w.k}</p>
                <h3 className="font-display mt-4 text-2xl text-foreground">{w.t}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{w.d}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Demo */}
      <section id="product" className="mx-auto max-w-6xl scroll-mt-24 px-5 pb-28 sm:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <SectionHead
              eyebrow="What you get back"
              title="An answer, the SQL behind it, and how sure to be."
              lede="Nothing is hidden: you can read and edit the query, see which tables it touched, and get a confidence score that tells you when a result deserves a second look."
            />
          </div>
          <Reveal className="min-w-0 lg:col-span-7">
            <TiltCard>
              <DemoConsole />
            </TiltCard>
          </Reveal>
        </div>
      </section>

      {/* Pipeline */}
      <section id="how" className="scroll-mt-24 border-y border-border bg-card/30 py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 sm:px-8 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-32">
              <SectionHead eyebrow="How a question becomes an answer" title={<>Five steps. The model only writes the <span className="mark-brand">first</span> one.</>} />
            </div>
          </div>
          <ol className="pipeline relative ml-3 space-y-14 pl-10 lg:col-span-7">
            <span aria-hidden className="absolute top-1 bottom-1 left-0 w-px bg-border" />
            <span aria-hidden className="rail-fill absolute top-1 bottom-1 left-0 w-px origin-top bg-gradient-to-b from-[var(--brand-bright)] to-brand" />
            {STEPS.map((s) => (
              <li key={s.k} className="step relative">
                <span aria-hidden className="step-dot absolute top-2 -left-[2.85rem] size-3 rounded-full" />
                <p className="flex items-baseline gap-3 font-mono text-xs text-muted-foreground">
                  {s.k} <span className="step-title font-display text-3xl tracking-[-0.03em]">{s.t}</span>
                </p>
                <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Security bento */}
      <section id="security" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-28 sm:px-8">
        <SectionHead
          eyebrow="Trust"
          title={<>Nothing runs <span className="mark-brand">unseen</span>.</>}
          lede="Safety doesn't depend on the model behaving. Each layer below works even if the one above it fails."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SECURITY.map((s, i) => (
            <Reveal key={s.t} delay={(i % 3) * 0.07} className={s.span}>
              <article className="panel spotlight lift group flex h-full flex-col p-6">
                <span className="grid size-10 place-items-center rounded-xl border border-[rgb(var(--brand-rgb)/0.25)] bg-[rgb(var(--brand-rgb)/0.08)] text-brand transition-transform duration-500 ease-[cubic-bezier(.34,1.56,.64,1)] group-hover:scale-110 group-hover:-rotate-6">
                  <s.icon aria-hidden className="size-[18px]" />
                </span>
                <h3 className="mt-6 text-base font-semibold text-foreground">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.d}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section className="mx-auto max-w-6xl px-5 pb-28 sm:px-8">
        <Reveal>
          <div className="panel crop grid grid-cols-2 overflow-hidden lg:grid-cols-4">
            {STATS.map((s, i) => (
              <div key={s.l} className={cn("group p-6 transition-colors hover:bg-hover/50 sm:p-8", i % 2 && "border-l border-border", i >= 2 && "border-t border-border lg:border-t-0", i === 2 && "lg:border-l")}>
                <p className="font-display text-[clamp(2.2rem,4vw,3.4rem)] leading-none tabular-nums text-foreground transition-colors group-hover:text-brand">
                  <StatValue value={s.v} />
                </p>
                <p className="mt-3 text-sm text-soft">{s.l}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{s.n}</p>
              </div>
            ))}
          </div>
        </Reveal>
        <p className="mt-3 font-mono text-[11px] text-muted-foreground">From the project's published evaluation; details in the admin console.</p>
      </section>

      {/* Data */}
      <section className="mx-auto max-w-6xl px-5 pb-28 sm:px-8">
        <Reveal>
          <div className="panel spotlight relative grid gap-10 overflow-hidden p-8 lg:grid-cols-12 lg:p-12">
            <div aria-hidden className="pointer-events-none absolute -right-20 -bottom-24 size-80 rounded-full bg-[radial-gradient(circle,rgb(var(--brand-rgb)/0.12),transparent_65%)]" />
            <div className="lg:col-span-5">
              <p className="eyebrow eyebrow-brand">Under the hood</p>
              <h2 className="font-display mt-4 text-[clamp(2rem,4vw,3rem)] leading-[0.98] text-foreground">A real college, in one schema.</h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Students, faculty, timetables, exams, fees, the library and placements, all related the way a real ERP
                is. After signing in, the Schema Explorer draws it as an interactive diagram.
              </p>
            </div>
            <dl className="relative grid grid-cols-2 gap-8 lg:col-span-7">
              {DATA_FACTS.map((f) => (
                <div key={f.l} className="border-l border-border pl-5">
                  <dt className="font-display text-[clamp(2.2rem,4vw,3.2rem)] leading-none text-foreground">{f.v}</dt>
                  <dd className="mt-2 text-sm text-muted-foreground">{f.l}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Reveal>
      </section>

      {/* Roles */}
      <section id="roles" className="mx-auto max-w-6xl scroll-mt-24 px-5 pb-28 sm:px-8">
        <SectionHead eyebrow="One workspace, four views of the data" title={<>Who you are decides what <span className="mark-brand">exists</span>.</>} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((r, i) => (
            <Reveal key={r.r} delay={i * 0.07}>
              <article className="panel spotlight lift group relative h-full overflow-hidden p-6">
                <span aria-hidden className="absolute inset-x-0 top-0 h-px origin-left scale-x-0 bg-gradient-to-r from-brand to-transparent transition-transform duration-700 group-hover:scale-x-100" />
                <r.icon aria-hidden className="size-6 text-brand transition-transform duration-500 group-hover:-translate-y-0.5" strokeWidth={1.6} />
                <h3 className="font-display mt-6 text-2xl text-foreground">{r.r}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{r.d}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-5 pb-28 sm:px-8">
        <SectionHead eyebrow="FAQ" title="Good questions." center />
        <Reveal>
          <Accordion type="single" collapsible className="panel divide-y divide-border px-2">
            {FAQ.map((f, i) => (
              <AccordionItem key={f.q} value={`q${i}`} className="border-0 px-4">
                <AccordionTrigger className="py-5 text-left text-[15px] font-medium text-foreground hover:no-underline [&[data-state=open]]:text-brand">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="pr-8 text-sm leading-relaxed text-muted-foreground">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 pb-24 sm:px-8">
        <Reveal>
          <div className="panel crop crop-brand relative overflow-hidden px-8 py-20 text-center sm:px-16">
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgb(var(--brand-rgb)/0.16),transparent_70%)]" />
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(var(--grid-dot)_1px,transparent_1.2px)] [background-size:18px_18px] [mask-image:radial-gradient(ellipse_at_center,#000,transparent_75%)]" />
            <div className="relative">
              <h2 className="font-display mx-auto max-w-2xl text-[clamp(2.2rem,5vw,3.8rem)] leading-[0.95] text-foreground">
                Your questions, answered <span className="mark-brand">safely</span>.
              </h2>
              <p className="mx-auto mt-5 max-w-lg text-[15px] text-muted-foreground">
                Sign in with your college account, or continue with any Google account for guest access.
              </p>
              <Button onClick={onSignIn} variant="brand" size="lg" className="group mt-9" data-magnetic="0.25">
                Start asking <ArrowRight className="nudge" />
              </Button>
            </div>
          </div>
        </Reveal>
      </section>

      </main>

      <footer className="relative overflow-hidden border-t border-border">
        <div className="mx-auto max-w-6xl px-5 pt-14 pb-10 sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-10">
            <div className="max-w-xs">
              <div className="flex items-center gap-2.5"><LogoMark /><Wordmark /></div>
              <p className="mt-4 text-sm text-muted-foreground">Safe, explainable Text-to-SQL for the college ERP. Built by the G-52 project team.</p>
            </div>
            <nav aria-label="Footer" className="flex gap-16 text-sm text-soft">
              <ul className="space-y-2.5">
                <li><a href="#product" className="link-draw inline-block py-1.5 hover:text-foreground">Product</a></li>
                <li><a href="#how" className="link-draw inline-block py-1.5 hover:text-foreground">How it works</a></li>
                <li><a href="#security" className="link-draw inline-block py-1.5 hover:text-foreground">Security</a></li>
              </ul>
              <ul className="space-y-2.5">
                <li><a href="#faq" className="link-draw inline-block py-1.5 hover:text-foreground">FAQ</a></li>
                <li>
                  <a href="https://github.com/Text-To-SQL-Project/G-52-Project" target="_blank" rel="noreferrer" className="link-draw inline-flex items-center gap-1 py-1.5 hover:text-foreground">
                    <GithubMark /> GitHub
                  </a>
                </li>
                <li><button onClick={onSignIn} className="link-draw inline-block py-1.5 hover:text-foreground">Open the workspace</button></li>
              </ul>
            </nav>
          </div>
          <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
            <p className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground"><span className="live-dot" /> Read-only by default · RLS-scoped · Every query audited</p>
          </div>
        </div>
        <p
          aria-hidden
          data-n="SQL.AI"
          className="font-display pointer-events-none -mb-[0.22em] text-center text-[clamp(4rem,17vw,15rem)] leading-none tracking-[-0.06em] text-[rgb(var(--ink-rgb)/0.045)] select-none before:content-[attr(data-n)]"
        />
      </footer>
    </div>
  );
}
