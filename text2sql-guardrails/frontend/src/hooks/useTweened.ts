import { useEffect, useRef, useState } from "react";

/** Eases a displayed number toward `target` (score refinements read as
 * motion, not a jump); pass `initial` (e.g. 0) to count up on mount.
 * Snaps under prefers-reduced-motion. */
export function useTweened(target: number, ms = 650, initial = target): number {
  const [value, setValue] = useState(initial);
  const from = useRef(initial);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    if (reduced) return;
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setValue(a + (target - a) * (1 - (1 - p) ** 3)); // unrounded: callers format
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target, ms, reduced]);
  return reduced ? target : value;
}
