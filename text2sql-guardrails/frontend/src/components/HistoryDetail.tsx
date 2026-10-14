import { ArrowLeft, Clock3 } from "lucide-react";
import type { QueryResponse, StudentProfile } from "../types/api";
import { ConfidenceCard } from "./ConfidenceCard";
import { ResultsTable } from "./ResultsTable";
import { SqlPanel } from "./SqlPanel";
import { StatusBanner } from "./StatusBanner";
import { Stagger, StaggerItem } from "./kit";

/** A past answer re-opened from History: the stored snapshot, not a re-run,
 * so it shows exactly what the user saw (SQL, confidence, up to 200 rows). */
export function HistoryDetail({ resp, onBack, student }: { resp: QueryResponse; onBack: () => void; student?: StudentProfile | null }) {
  return (
    <Stagger className="space-y-6">
      <StaggerItem className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0 space-y-2.5">
          <button type="button" onClick={onBack} className="press inline-flex min-h-8 items-center gap-1.5 text-sm text-soft hover:text-foreground">
            <ArrowLeft className="size-4" /> Back to history
          </button>
          <p className="max-w-3xl text-lg leading-snug font-medium text-foreground">{resp.question}</p>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBanner status={resp.status} size="sm" />
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
              <Clock3 aria-hidden className="size-3" />
              {new Date(resp.timestamp).toLocaleString()}
            </span>
          </div>
        </div>
      </StaggerItem>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <StaggerItem className="min-w-0 xl:col-span-7">
          <SqlPanel sql={resp.sql} explanation={resp.explanation} tablesUsed={resp.tables_used} columnsUsed={resp.columns_used} />
        </StaggerItem>
        <StaggerItem className="min-w-0 xl:col-span-5">
          <ConfidenceCard confidence={resp.confidence} />
        </StaggerItem>
      </div>

      <StaggerItem>
        <ResultsTable results={resp.results} executed question={resp.question} queryId={resp.query_id} student={student} />
      </StaggerItem>
    </Stagger>
  );
}
