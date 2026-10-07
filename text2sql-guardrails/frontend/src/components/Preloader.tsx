import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

/**
 * Intro sequence, once per browser session:
 *   1. the crop brackets draw in and the vermilion cell drops into place;
 *   2. the wordmark rises letter by letter while a counter runs to 100;
 *   3. the overlay lifts away like a shutter.
 */
const SEEN_KEY = "preloader_seen";
const skip = () => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  try { return sessionStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
};

const WORD = "SQL.AI".split("");

export function Preloader({ onComplete }: { onComplete: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(() => !skip());
  // Latest callback in a ref: App passes a new inline function each render,
  // and depending on it would restart the timeline on every App re-render.
  const done = useRef(onComplete);
  useEffect(() => { done.current = onComplete; }, [onComplete]);

  useEffect(() => {
    if (!show) {
      done.current();
      return;
    }
    const el = root.current!;
    const count = el.querySelector<HTMLSpanElement>("[data-count]")!;
    const n = { v: 0 };
    const tl = gsap.timeline({
      defaults: { ease: "expo.out" },
      onComplete: () => {
        try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* storage blocked */ }
        setShow(false);
        done.current();
      },
    });
    tl.fromTo(el.querySelectorAll("[data-bracket]"), { strokeDashoffset: 30 }, { strokeDashoffset: 0, duration: 0.7, stagger: 0.08 })
      .fromTo(el.querySelector("[data-cell]"), { scale: 0, rotate: -90, transformOrigin: "16px 16px" }, { scale: 1, rotate: 0, duration: 0.7, ease: "back.out(2.2)" }, "-=0.45")
      .fromTo(el.querySelectorAll("[data-ch]"), { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.7, stagger: 0.04 }, "-=0.5")
      .to(n, { v: 100, duration: 0.9, ease: "power2.inOut", onUpdate: () => { count.textContent = String(Math.round(n.v)).padStart(3, "0"); } }, "<")
      .fromTo(el.querySelector("[data-bar]"), { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: "power2.inOut" }, "<")
      .to(el.querySelector("[data-stage]"), { y: -24, opacity: 0, duration: 0.45, ease: "power2.in" }, "+=0.1")
      .to(el, { clipPath: "inset(0 0 100% 0)", duration: 0.75, ease: "expo.inOut" }, "-=0.15");
    return () => { tl.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once: `show` only starts true/false
  }, []);

  if (!show) return null;

  return (
    <div ref={root} className="preloader" style={{ clipPath: "inset(0 0 0 0)" }}>
      <div aria-hidden className="app-bg absolute inset-0" />
      <div data-stage className="relative flex flex-col items-center gap-6">
        <svg viewBox="0 0 32 32" className="size-16">
          <path data-bracket d="M8.5 14V8.5H14" fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="30" />
          <path data-bracket d="M23.5 18v5.5H18" fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="30" />
          <rect data-cell x="12.5" y="12.5" width="7" height="7" rx="1.6" fill="var(--brand)" />
        </svg>
        <div className="font-display flex overflow-hidden text-5xl leading-none text-foreground sm:text-6xl">
          {WORD.map((c, i) => (
            <span key={i} data-ch className={c === "." ? "text-brand" : undefined}>{c}</span>
          ))}
        </div>
        <div className="flex w-48 items-center gap-3">
          <span className="relative h-px flex-1 overflow-hidden bg-border">
            <span data-bar className="route-line absolute inset-0 block" />
          </span>
          <span data-count className="font-mono text-[11px] tabular-nums text-muted-foreground">000</span>
        </div>
      </div>
    </div>
  );
}
