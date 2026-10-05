import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ApiError, getQueryConfidence, postQuery } from "../api/client";
// three.js is ~600 KB; let the input render first and stream the orb in.
const AiOrb = lazy(() => import("../components/AiOrb").then((m) => ({ default: m.AiOrb })));
import { ClarificationPanel } from "../components/ClarificationPanel";
import { ConfidenceCard } from "../components/ConfidenceCard";
import { LatencyMeter } from "../components/LatencyMeter";
import { ErrorPanel } from "../components/ErrorPanel";
import { GuardrailBanner } from "../components/GuardrailBanner";
import { QuestionInput } from "../components/QuestionInput";
import { ResultsTable } from "../components/ResultsTable";
import { SqlPanel } from "../components/SqlPanel";
import { StatusBanner } from "../components/StatusBanner";
import { WarningsList } from "../components/WarningsList";
import { getSessionId } from "../hooks/useSessionId";
import type { Confidence, QueryResponse, UserRole } from "../types/api";

function RunningPanel({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="animate-rise overflow-hidden" style={{ border: "1px solid var(--border-subtle)", borderRadius: "2px" }}>
      <div className="flex items-center justify-between px-6 py-4 text-sm">
        <div className="flex items-center gap-3" style={{ color: "var(--text-primary)" }}>
          <span
            className="h-4 w-4 animate-spin rounded-full border-2"
            style={{ borderColor: "var(--border-hairline)", borderTopColor: "var(--accent)" }}
          />
          <span className="font-display font-medium">
            {isAdmin
              ? "Executing administrative operation (privileged mode)…"
              : "Validating schema & checking AST security guardrails…"}
          </span>
        </div>
        <span
          className="hidden font-mono text-[11px] sm:inline-flex"
          style={{
            padding: "2px 10px",
            border: isAdmin ? "1px solid rgba(251, 191, 36, 0.3)" : "1px solid var(--border-accent)",
            background: isAdmin ? "rgba(251, 191, 36, 0.06)" : "var(--accent-dim)",
            color: isAdmin ? "#fbbf24" : "var(--accent)",
            borderRadius: "2px",
          }}
        >
          {isAdmin ? "Admin Superuser Engine" : "Dual AST + Learned Confidence Pipeline"}
        </span>
      </div>
      <div className="relative h-[2px] overflow-hidden" style={{ background: "var(--border-subtle)" }}>
        <div
          className="animate-sweep absolute inset-y-0 w-1/3"
          style={{
            background: `linear-gradient(to right, transparent, var(--accent), transparent)`,
          }}
        />
      </div>
    </div>
  );
}

interface Props {
  isAdmin?: boolean;
  role?: UserRole;
}

export function WorkspaceScreen({ isAdmin = false, role }: Props) {
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  // Final score from the background checks. Kept apart from `response` so
  // its arrival doesn't replay the response stack's entrance animation.
  const [final, setFinal] = useState<{ queryId: string; confidence: Confidence } | null>(null);
  const finalConfidence = final && final.queryId === response?.query_id ? final.confidence : null;

  useEffect(() => {
    if (!response?.confidence_pending) return;
    let cancelled = false;
    let timer = 0;
    const started = Date.now();
    const poll = async () => {
      try {
        const update = await getQueryConfidence(response.query_id);
        if (cancelled) return;
        if (!update.pending && update.confidence) {
          return setFinal({ queryId: response.query_id, confidence: update.confidence });
        }
      } catch {
        return; // e.g. server restarted: keep the provisional score
      }
      // Under a provider RPM cap the check can be deferred ~1 min.
      if (Date.now() - started < 90_000) timer = window.setTimeout(poll, 1500);
    };
    timer = window.setTimeout(poll, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [response]);

  const run = async (question: string, sqlOverride?: string) => {
    setLoading(true);
    setClientError(null);
    try {
      const result = await postQuery({
        question,
        session_id: getSessionId(),
        max_rows: 1000,
        ...(sqlOverride ? { sql_override: sqlOverride } : {}),
      });
      setResponse(result);
    } catch (e) {
      setResponse(null);
      setClientError(
        e instanceof ApiError && e.status === 429
          ? `You're asking faster than the limit allows. Try again in ${e.retryAfter ?? 60} seconds.`
          : e instanceof ApiError ? e.message : "Unexpected client error.",
      );
    } finally {
      setLoading(false);
    }
  };

  // Animate response stack entrance
  useEffect(() => {
    if (response && !loading && responseRef.current) {
      const children = responseRef.current.children;
      gsap.fromTo(
        children,
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.5,
          stagger: 0.08,
          ease: "expo.out",
        }
      );
    }
  }, [response, loading]);

  const orbStatus = loading
    ? "loading"
    : response?.status === "success"
    ? "success"
    : response?.status === "blocked"
    ? "blocked"
    : response?.status === "error"
    ? "error"
    : "ready";

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-5 py-10 sm:px-8 lg:px-10">
      {/* Hero Zone: Input + Orb — asymmetric grid */}
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-5">
        {/* Input — takes 3/5 of the width */}
        <div className="lg:col-span-3">
          <QuestionInput onSubmit={(q) => run(q)} loading={loading} isAdmin={isAdmin} role={role} />
        </div>

        {/* Orb — centerpiece with ambient glow, framed from here (AiOrb.tsx untouched) */}
        <div className="flex items-center justify-center lg:col-span-2">
          <div
            className="orb-frame relative"
            data-status={orbStatus}
            style={{ width: "260px", height: "260px" }}
          >
            <Suspense fallback={null}>
              <AiOrb status={orbStatus} className="h-full w-full" />
            </Suspense>
          </div>
        </div>
      </div>

      {clientError && <ErrorPanel message={clientError} />}

      {loading && <RunningPanel isAdmin={isAdmin} />}

      {response && !loading && (
        <div ref={responseRef} className="response-stack space-y-6">
          {/* Status & timing */}
          <div
            // relative z-30: the stack's children are GSAP-transformed (each its
            // own stacking context), so the latency popover must sit above them.
            className="relative z-30 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 py-3"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <StatusBanner
              status={response.status}
              reason={response.status === "clarification" ? null : response.status_reason}
            />
            {response.timings_ms && <LatencyMeter timings={response.timings_ms} />}
          </div>

          <WarningsList warnings={response.warnings} />

          {response.status === "clarification" && response.clarification && (
            <ClarificationPanel
              clarification={response.clarification}
              onSelect={(opt) => run(opt)}
            />
          )}

          {response.status === "error" && <ErrorPanel message={response.error_message} />}

          {response.status === "blocked" && <GuardrailBanner guardrail={response.guardrail} />}

          {response.status === "success" && (
            <SqlPanel
              sql={response.sql}
              explanation={response.explanation}
              tablesUsed={response.tables_used}
              columnsUsed={response.columns_used}
              onRerun={(editedSql) => run(response.question, editedSql)}
              rerunning={loading}
            />
          )}

          <ResultsTable results={response.results} executed={response.status === "success"} />

          <ConfidenceCard confidence={finalConfidence ?? response.confidence} />
        </div>
      )}
    </div>
  );
}
