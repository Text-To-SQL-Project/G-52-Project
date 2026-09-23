import { clearToken } from "../hooks/useAuthToken";
import type { MeResponse, UserRole } from "../types/api";

export type Screen = "workspace" | "history" | "schema" | "admin";

interface Tab {
  key: Screen;
  label: string;
  icon: string;
  visibleTo?: UserRole[];
}

const TABS: Tab[] = [
  { key: "workspace", label: "Workspace", icon: "terminal" },
  { key: "history", label: "History", icon: "history" },
  { key: "schema", label: "Schema Explorer", icon: "schema" },
  { key: "admin", label: "Admin", icon: "admin_panel_settings", visibleTo: ["admin"] },
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
  const tabs = TABS.filter((t) => !t.visibleTo || (me && t.visibleTo.includes(me.role)));

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#0b1120]/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-y-3 px-4 py-3 sm:px-6 md:px-8">
        {/* Brand identity from Stitch Syntactic Deep */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-indigo-500/30 bg-indigo-600/20 shadow-[0_0_15px_rgba(99,102,241,0.25)]">
            <span className="material-symbols-outlined text-[20px] text-indigo-400">terminal</span>
          </div>
          <div className="flex items-baseline gap-2">
            <h1 className="font-display text-[16px] font-bold tracking-tight text-white">
              SQL.AI <span className="gradient-text font-semibold">Guardrails</span>
            </h1>
            <span className="pill-tag hidden rounded-full px-2 py-0.5 font-mono text-[10px] sm:inline-block">
              college_erp
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Navigation tabs */}
          <nav className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
            {tabs.map((tab) => {
              const isActive = active === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => onChange(tab.key)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-sans text-xs font-medium transition duration-200 focus-visible:outline-none ${
                    isActive
                      ? "glow-button text-white shadow-[0_2px_12px_rgba(99,102,241,0.4)]"
                      : "text-white/60 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* User profile & session state */}
          <div className="flex items-center gap-2.5 border-l border-white/[0.08] pl-3">
            {me ? (
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-indigo-300">
                  <span className="material-symbols-outlined text-[16px]">person</span>
                </div>
                <div className="hidden flex-col text-left leading-tight sm:flex">
                  <span className="truncate text-xs font-semibold text-white/90">
                    {me.username}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-[#5de6ff]">
                    {ROLE_LABEL[me.role]}
                  </span>
                </div>
              </div>
            ) : (
              <span className={`text-xs text-white/30 ${meLoading ? "animate-pulse" : ""}`}>
                {meLoading ? "Loading…" : "guest"}
              </span>
            )}

            <button
              onClick={clearToken}
              className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 font-sans text-xs text-white/50 transition hover:border-rose-400/30 hover:bg-rose-500/10 hover:text-rose-300 focus-visible:outline-none"
              title="Log out"
            >
              <span className="material-symbols-outlined text-[14px]">logout</span>
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
