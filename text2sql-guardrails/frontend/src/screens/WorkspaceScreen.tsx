import { useState } from "react";
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
import type { QueryResponse } from "../types/api";

function RunningPanel({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="glass-card animate-rise overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between px-6 py-4 text-sm">
        <div className="flex items-center gap-3 text-white/85">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-[#22d3ee]" />
          <span className="font-display font-medium text-white/90">
            {isAdmin
              ? "Executing administrative operation (privileged mode)…"
              : "Validating schema & checking AST security guardrails…"}
          </span>
        </div>
        <span
          className={
            isAdmin
              ? "hidden rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 font-mono text-[11px] text-amber-300 sm:inline-flex"
              : "pill-tag-indigo hidden rounded-full px-2.5 py-0.5 font-mono text-[11px] sm:inline-flex"
          }
        >
          {isAdmin ? "Admin Superuser Engine" : "Dual AST + Learned Confidence Pipeline"}
        </span>
      </div>
      <div className="relative h-[2px] overflow-hidden bg-white/[0.06]">
        <div className="animate-sweep absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-[#22d3ee] to-transparent" />
      </div>
    </div>
  );
}

interface Props {
  isAdmin?: boolean;
}

export function WorkspaceScreen({ isAdmin = false }: Props) {
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

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
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 md:px-8">
      {/* Hero Zone: Input bar + 3D Shader Orb from Stitch */}
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-4">
        <div className="lg:col-span-3">
          <QuestionInput onSubmit={(q) => run(q)} loading={loading} isAdmin={isAdmin} />
        </div>
        <div className="flex h-full min-h-[220px] lg:col-span-1">
          <AiOrb status={orbStatus} className="h-full w-full" />
        </div>
      </div>

      {clientError && <ErrorPanel message={clientError} />}

      {loading && <RunningPanel isAdmin={isAdmin} />}

      {response && !loading && (
        <div className="response-stack space-y-6">
          {/* Status Chip & Execution Metrics */}
          <div className="glass-card flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl px-6 py-3.5">
            <StatusBanner
              status={response.status}
              reason={response.status === "clarification" ? null : response.status_reason}
            />
            {response.execution_time_ms != null && (
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-white/40">timer</span>
                <span className="font-mono text-xs tabular-nums text-white/60">
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
