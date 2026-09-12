import { clearToken } from "../hooks/useAuthToken";

export type Screen = "workspace" | "history" | "schema" | "admin";

const TABS: { key: Screen; label: string }[] = [
  { key: "workspace", label: "Workspace" },
  { key: "history", label: "History" },
  { key: "schema", label: "Schema Explorer" },
  { key: "admin", label: "Admin" },
];

interface Props {
  active: Screen;
  onChange: (screen: Screen) => void;
}

export function NavBar({ active, onChange }: Props) {
  return (
    /* Sticky so the active tab and the database name stay on screen while a
       long results table is scrolled -- during a demo the audience loses track
       of which screen they are on otherwise. */
    <header className="sticky top-0 z-30 bg-[#0b1120]/85 backdrop-blur-md">
      <div className="animate-fade mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-y-3 px-6 py-3 md:px-8">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-white">
            Text-to-SQL Guardrails
          </h1>
          <span aria-hidden className="text-white/15">
            /
          </span>
          <p className="font-mono text-xs text-white/40">college_erp</p>
        </div>

        <div className="flex items-center gap-2">
          <nav className="flex gap-0.5 rounded-xl border border-white/[0.07] bg-white/[0.03] p-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => onChange(tab.key)}
                aria-current={active === tab.key ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 ${
                  active === tab.key
                    ? "bg-blue-600 text-white shadow-[0_1px_0_0_rgba(255,255,255,0.12)_inset,0_6px_16px_-8px_rgba(37,99,235,0.9)]"
                    : "text-white/50 hover:bg-white/[0.06] hover:text-white/85"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <button
            onClick={clearToken}
            className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-white/40 transition hover:bg-white/[0.06] hover:text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            title="Log out"
          >
            Log out
          </button>
        </div>
      </div>
      {/* Gradient seam instead of a flat border: brightest under the centre
          of the page, fading out at both gutters. */}
      <div
        aria-hidden
        className="h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
      />
    </header>
  );
}
