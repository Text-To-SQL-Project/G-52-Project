import { useState } from "react";
import { motion, AnimatePresence, useScroll, useMotionValueEvent } from "motion/react";
import { Database, History, LogOut, Network, ShieldCheck, SquareTerminal, type LucideIcon } from "lucide-react";
import { clearToken } from "../hooks/useAuthToken";
import type { MeResponse, UserRole } from "../types/api";
import { ThemeToggle } from "./ThemeToggle";
import { EASE, LogoMark, Wordmark } from "./kit";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type Screen = "workspace" | "history" | "schema" | "admin";

interface Tab {
  key: Screen;
  label: string;
  icon: LucideIcon;
  visibleTo?: UserRole[];
}

const TABS: Tab[] = [
  { key: "workspace", label: "Workspace", icon: SquareTerminal },
  { key: "history", label: "History", icon: History },
  { key: "schema", label: "Schema Explorer", icon: Network, visibleTo: ["admin"] },
  { key: "admin", label: "Admin", icon: ShieldCheck, visibleTo: ["admin"] },
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
  const [hovered, setHovered] = useState<Screen | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 8));

  // A progress line runs under the bar on every screen change.
  const [routeTick, setRouteTick] = useState(0);
  const [prev, setPrev] = useState(active);
  if (prev !== active) {
    setPrev(active);
    setRouteTick((n) => n + 1);
  }

  const initials = me?.username.slice(0, 2).toUpperCase() ?? "··";

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-[background-color,border-color,box-shadow] duration-500",
        scrolled
          ? "border-b border-border bg-[rgb(var(--void-rgb)/0.78)] shadow-[0_10px_30px_-20px_rgb(0_0_0/0.5)] backdrop-blur-xl backdrop-saturate-150"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-8 lg:px-10">
        {/* Brand */}
        <motion.div
          className="flex min-w-0 items-center gap-2.5"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          <LogoMark className="size-8" />
          <Wordmark className="hidden lg:inline" />
          <span className="hidden items-center gap-1 rounded-md border border-border bg-card/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground xl:inline-flex">
            <Database aria-hidden className="size-3" />
            college_erp
          </span>
        </motion.div>

        {/* Tabs: a sliding pill marks the active screen, a ghost pill follows hover. */}
        <nav
          aria-label="Screens"
          className="relative flex items-center gap-0.5 rounded-xl border border-border bg-card/60 p-1 shadow-[var(--shadow-lift)] backdrop-blur-md"
          onMouseLeave={() => setHovered(null)}
        >
          {tabs.map((tab) => {
            const isActive = active === tab.key;
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                data-tab={tab.key}
                onClick={() => onChange(tab.key)}
                onMouseEnter={() => setHovered(tab.key)}
                onFocus={() => setHovered(tab.key)}
                aria-current={isActive ? "page" : undefined}
                aria-label={tab.label}
                title={tab.label}
                className={cn(
                  "press relative flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium outline-none sm:px-3",
                  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {hovered === tab.key && !isActive && (
                  <motion.span
                    layoutId="nav-hover"
                    className="absolute inset-0 rounded-lg bg-hover"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                {isActive && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-lg border border-border bg-background shadow-[0_1px_2px_rgb(0_0_0/0.15),0_0_0_1px_rgb(var(--brand-rgb)/0.0)]"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  >
                    <span className="absolute inset-x-3 -bottom-px h-px bg-gradient-to-r from-transparent via-brand to-transparent" />
                  </motion.span>
                )}
                <Icon aria-hidden className={cn("relative size-4 transition-colors", isActive && "text-brand")} strokeWidth={2} />
                {/* Icons only on phones; the button keeps its name via aria-label. */}
                <span className="relative hidden md:inline">{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Account */}
        <motion.div
          className="flex items-center gap-2"
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          <ThemeToggle />
          {me ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Account menu"
                className="press group flex items-center gap-2 rounded-lg border border-border bg-card/70 py-1 pr-2.5 pl-1 outline-none hover:border-[rgb(var(--ink-rgb)/0.18)] hover:bg-hover focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                <span className="relative grid size-6 place-items-center rounded-md bg-foreground font-mono text-[10px] font-semibold text-background">
                  {initials}
                  <span className="live-dot absolute -right-0.5 -bottom-0.5 !size-[7px] ring-2 ring-card" />
                </span>
                <span className="hidden flex-col text-left leading-tight sm:flex">
                  <span className="max-w-[9rem] truncate text-xs font-semibold text-foreground">{me.username}</span>
                  <span className="font-mono text-[10px] text-brand">{ROLE_LABEL[me.role]}</span>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className="w-56 rounded-xl">
                <DropdownMenuLabel className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">{me.username}</span>
                  <span className="font-mono text-[11px] font-normal text-muted-foreground">
                    {ROLE_LABEL[me.role]} · row-level scoped
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={clearToken}
                  className="text-danger-text focus:bg-[rgb(var(--danger-rgb)/0.08)] focus:text-danger-text"
                >
                  <LogOut className="text-current" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className={cn("font-mono text-xs text-muted-foreground", meLoading && "animate-pulse")}>
              {meLoading ? "Loading…" : "guest"}
            </span>
          )}
        </motion.div>
      </div>

      <AnimatePresence>
        {routeTick > 0 && (
          <motion.span
            key={routeTick}
            aria-hidden
            className="route-line absolute inset-x-0 -bottom-px h-[2px]"
            initial={{ scaleX: 0, opacity: 1 }}
            animate={{ scaleX: 1, opacity: [1, 1, 0] }}
            transition={{ duration: 0.8, ease: EASE, opacity: { times: [0, 0.7, 1], duration: 0.8 } }}
          />
        )}
      </AnimatePresence>
    </header>
  );
}
