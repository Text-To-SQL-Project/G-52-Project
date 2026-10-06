import { ThemeToggle } from "./ThemeToggle";
import { useRef, useEffect } from "react";
import { gsap } from "gsap";
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
  { key: "schema", label: "Schema Explorer", icon: "schema", visibleTo: ["admin"] },
  { key: "admin", label: "Admin", icon: "admin_panel_settings", visibleTo: ["admin"] },
];

const ROLE_LABEL: Record<UserRole, string> = {
  student: "Student",
  faculty: "Faculty",
  admin: "Administrator",
  guest: "Guest",
};

interface Props {
  active: Screen;
  onChange: (screen: Screen) => void;
  me: MeResponse | null;
  meLoading?: boolean;
}

export function NavBar({ active, onChange, me, meLoading }: Props) {
  const tabs = TABS.filter((t) => !t.visibleTo || (me && t.visibleTo.includes(me.role)));
  const indicatorRef = useRef<HTMLDivElement>(null);
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  // Animated underline indicator
  useEffect(() => {
    const container = tabsContainerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;

    const activeButton = container.querySelector(`[data-tab="${active}"]`) as HTMLElement;
    if (!activeButton) return;

    gsap.to(indicator, {
      x: activeButton.offsetLeft,
      width: activeButton.offsetWidth,
      duration: 0.4,
      ease: "expo.out",
    });
  }, [active]);

  return (
    <header
      className="sticky top-0 z-30"
      style={{
        background: "rgb(var(--void-rgb) / 0.85)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between px-5 py-3 sm:px-8 lg:px-10">
        {/* Brand */}
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-8 w-8 items-center justify-center"
            style={{
              border: "1px solid var(--border-accent)",
              background: "var(--accent-dim)",
              borderRadius: "8px",
              boxShadow: "0 0 15px var(--accent-glow)",
            }}
          >
            <span className="material-symbols-outlined text-[18px]" style={{ color: "var(--accent)" }}>
              terminal
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <h1 className="font-display text-[15px] font-bold tracking-tight text-[var(--text-primary)]">
              SQL<span style={{ color: "var(--accent)" }}>.</span>AI{" "}
              <span className="gradient-text font-semibold">Guardrails</span>
            </h1>
            <span
              className="pill-tag hidden px-2 py-0.5 font-mono text-[10px] sm:inline-block"
              style={{ borderRadius: "8px" }}
            >
              college_erp
            </span>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          {/* Tab navigation */}
          <nav
            ref={tabsContainerRef}
            className="relative flex items-center gap-0.5"
            style={{
              borderBottom: "1px solid var(--border-subtle)",
              paddingBottom: "1px",
            }}
          >
            {/* Animated underline indicator */}
            <div
              ref={indicatorRef}
              className="absolute bottom-0 left-0 h-[2px]"
              style={{
                background: "var(--accent)",
                boxShadow: "0 0 8px var(--accent-glow)",
                borderRadius: "1px",
                width: 0,
              }}
            />

            {tabs.map((tab) => {
              const isActive = active === tab.key;
              return (
                <button
                  key={tab.key}
                  data-tab={tab.key}
                  onClick={() => onChange(tab.key)}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={tab.label}
                  title={tab.label}
                  className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium sm:px-3.5 transition-colors duration-200 focus-visible:outline-none"
                  style={{
                    color: isActive ? "var(--accent)" : "var(--text-secondary)",
                    background: "transparent",
                    border: "none",
                    fontFamily: "var(--font-sans)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
                  }}
                >
                  <span aria-hidden className="material-symbols-outlined text-[15px]">{tab.icon}</span>
                  {/* Icons only on phones; the button keeps its name via aria-label. */}
                  <span className="hidden md:inline">{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Hairline divider */}
          <div className="hidden sm:block" style={{ width: "1px", height: "24px", background: "var(--border-subtle)" }} />

          {/* User badge */}
          <div className="flex items-center gap-2.5">
            {me ? (
              <div className="flex items-center gap-2">
                <div
                  className="flex h-7 w-7 items-center justify-center"
                  style={{
                    border: "1px solid var(--border-hairline)",
                    background: "rgb(var(--ink-rgb) / 0.03)",
                    borderRadius: "8px",
                  }}
                >
                  <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--accent)" }}>
                    person
                  </span>
                </div>
                <div className="hidden flex-col text-left leading-tight sm:flex">
                  <span className="truncate text-xs font-semibold text-[var(--text-primary)]/90">
                    {me.username}
                  </span>
                  <span
                    className="font-mono text-[10px] uppercase tracking-wider"
                    style={{ color: "var(--accent)" }}
                  >
                    {ROLE_LABEL[me.role]}
                  </span>
                </div>
              </div>
            ) : (
              <span className={`text-xs ${meLoading ? "animate-pulse" : ""}`} style={{ color: "var(--text-muted)" }}>
                {meLoading ? "Loading…" : "guest"}
              </span>
            )}

            <ThemeToggle />

            <button
              onClick={clearToken}
              className="flex items-center gap-1 px-2.5 py-1 font-sans text-xs transition duration-200 focus-visible:outline-none"
              title="Log out"
              style={{
                color: "var(--text-secondary)",
                border: "1px solid var(--border-subtle)",
                background: "transparent",
                borderRadius: "8px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgb(var(--danger-soft-rgb) / 0.3)";
                e.currentTarget.style.color = "rgb(var(--danger-soft-rgb))";
                e.currentTarget.style.background = "rgb(var(--danger-soft-rgb) / 0.06)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border-subtle)";
                e.currentTarget.style.color = "var(--text-secondary)";
                e.currentTarget.style.background = "transparent";
              }}
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
