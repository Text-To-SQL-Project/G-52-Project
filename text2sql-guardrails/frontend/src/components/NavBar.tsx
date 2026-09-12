import { clearToken } from "../hooks/useAuthToken";
import type { MeResponse, UserRole } from "../types/api";

export type Screen = "workspace" | "history" | "schema" | "admin";

interface Tab {
  key: Screen;
  label: string;
  /** Roles allowed to SEE this tab. Visibility only -- the API gates the
   * routes independently (require_admin), so hiding a tab is a courtesy to
   * the user, never the access control. */
  visibleTo?: UserRole[];
}

const TABS: Tab[] = [
  { key: "workspace", label: "Workspace" },
  { key: "history", label: "History" },
  { key: "schema", label: "Schema Explorer" },
  { key: "admin", label: "Admin", visibleTo: ["admin"] },
];

const ROLE_LABEL: Record<UserRole, string> = {
  student: "Student",
  faculty: "Faculty",
  admin: "Administrator",
};

interface Props {
  active: Screen;
  onChange: (screen: Screen) => void;
  me: MeResponse | null;
  meLoading?: boolean;
}

export function NavBar({ active, onChange, me, meLoading }: Props) {
  // Until identity resolves, show only the tabs everyone has. Rendering the
  // Admin tab optimistically and pulling it away a moment later is worse
  // than showing it a moment late.
  const tabs = TABS.filter((t) => !t.visibleTo || (me && t.visibleTo.includes(me.role)));

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
            {tabs.map((tab) => (
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

          {/* Who is signed in. Fetched from /auth/me, not read out of the
              token -- the token carries no role, by design. */}
          <div className="flex items-center gap-2 border-l border-white/[0.08] pl-3">
            {me ? (
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[13px] font-medium text-white/80">
                  {me.username}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-white/35">
                  {ROLE_LABEL[me.role]}
                </span>
              </span>
            ) : (
              <span
                className={`text-[13px] text-white/30 ${meLoading ? "animate-pulse" : ""}`}
                title={meLoading ? "Loading account" : "Account details unavailable"}
              >
                {meLoading ? "…" : "unknown"}
              </span>
            )}
            <button
              onClick={clearToken}
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-white/40 transition hover:bg-white/[0.06] hover:text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              title="Log out"
            >
              Log out
            </button>
          </div>
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
