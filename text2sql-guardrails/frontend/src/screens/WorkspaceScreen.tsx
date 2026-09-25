import { useState, useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ApiError, postQuery } from "../api/client";
import { AiOrb } from "../components/AiOrb";
import { ClarificationPanel } from "../components/ClarificationPanel";
import { ConfidenceCard } from "../components/ConfidenceCard";
import { ErrorPanel } from "../components/ErrorPanel";
import { GuardrailBanner } from "../components/GuardrailBanner";
import { QuestionInput } from "../components/QuestionInput";
import { ResultsTable } from "../components/ResultsTable";
import { SqlPanel } from "../components/SqlPanel";
import { StatusBanner } from "../components/StatusBanner";
import { WarningsList } from "../components/WarningsList";
import { getSessionId } from "../hooks/useSessionId";
import type { QueryResponse, UserRole } from "../types/api";

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
      setClientError(e instanceof ApiError ? e.message : "Unexpected client error.");
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
            <AiOrb status={orbStatus} className="h-full w-full" />
          </div>
        </div>
      </div>

      {clientError && <ErrorPanel message={clientError} />}

      {loading && <RunningPanel isAdmin={isAdmin} />}

      {response && !loading && (
        <div ref={responseRef} className="response-stack space-y-6">
          {/* Status & timing */}
          <div
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 py-3"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <StatusBanner
              status={response.status}
              reason={response.status === "clarification" ? null : response.status_reason}
            />
            {response.execution_time_ms != null && (
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--text-muted)" }}>
                  timer
                </span>
                <span className="font-mono text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
                  {response.execution_time_ms.toFixed(0)} ms
                </span>
              </div>
            )}
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

          <ConfidenceCard confidence={response.confidence} />
        </div>
      )}
    </div>
  );
}
