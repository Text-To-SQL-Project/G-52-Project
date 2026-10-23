import { gsap } from "gsap";

/**
 * Pointer-driven motion for the whole app, from ONE delegated listener
 * (no per-component effects):
 *  - [data-magnetic] elements lean toward the pointer and spring back;
 *  - .spotlight surfaces get --sx/--sy so their light follows the pointer;
 *  - <html> gets --mx/--my, which lights the background dot grid.
 * Coalesced to one write per frame. Off for touch and reduced motion.
 */
export function installPointerMotion() {
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const root = document.documentElement;
  let magnet: HTMLElement | null = null;
  let last: PointerEvent | null = null;
  let frame = 0;

  const release = () => {
    if (magnet) gsap.to(magnet, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1, 0.45)" });
    magnet = null;
  };

  const tick = () => {
    frame = 0;
    const e = last;
    if (!e) return;
    root.style.setProperty("--mx", `${e.clientX}px`);
    root.style.setProperty("--my", `${e.clientY}px`);

    const target = e.target as Element | null;
    const spot = target?.closest<HTMLElement>(".spotlight");
    if (spot) {
      const r = spot.getBoundingClientRect();
      spot.style.setProperty("--sx", `${e.clientX - r.left}px`);
      spot.style.setProperty("--sy", `${e.clientY - r.top}px`);
    }

    const btn = target?.closest<HTMLElement>("[data-magnetic]:not(:disabled)") ?? null;
    if (btn !== magnet) release();
    if (!btn) return;
    magnet = btn;
    const r = btn.getBoundingClientRect();
    const pull = Number(btn.dataset.magnetic) || 0.22;
    gsap.to(btn, {
      x: (e.clientX - r.left - r.width / 2) * pull,
      y: (e.clientY - r.top - r.height / 2) * pull * 1.3,
      duration: 0.4,
      ease: "power3.out",
    });
  };

  document.addEventListener("pointermove", (e) => {
    if (!fine.matches || reduced.matches || e.pointerType !== "mouse") return;
    last = e;
    if (!frame) frame = requestAnimationFrame(tick);
  }, { passive: true });
  document.addEventListener("pointerleave", release);
}
