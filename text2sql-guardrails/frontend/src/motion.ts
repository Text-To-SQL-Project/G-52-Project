import { gsap } from "gsap";

/** Every `.glow-button` (the primary-action class) leans toward the pointer
 * and springs back. One delegated listener for the whole app instead of an
 * effect per button. Off for touch input and prefers-reduced-motion. */
export function installMagneticButtons() {
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let active: HTMLElement | null = null;

  const release = () => {
    if (active) gsap.to(active, { x: 0, y: 0, duration: 0.6, ease: "elastic.out(1, 0.4)" });
    active = null;
  };

  document.addEventListener("pointermove", (e) => {
    if (!fine.matches || reduced.matches) return;
    const btn = (e.target as Element | null)?.closest<HTMLElement>(".glow-button:not(:disabled)");
    if (btn !== active) release();
    if (!btn) return;
    active = btn;
    const r = btn.getBoundingClientRect();
    gsap.to(btn, {
      x: (e.clientX - r.left - r.width / 2) * 0.18,
      y: (e.clientY - r.top - r.height / 2) * 0.28,
      duration: 0.35,
      ease: "power3.out",
    });
  }, { passive: true });
  document.addEventListener("pointerleave", release);
}
