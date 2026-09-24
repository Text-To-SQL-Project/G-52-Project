import { useEffect, useRef } from "react";

/**
 * Custom cursor follower — a ring that trails the mouse and morphs
 * on hover over interactive elements. Native cursor stays visible.
 * Disabled on touch devices and prefers-reduced-motion (see index.css).
 */
export function CustomCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const posRef = useRef({ x: -100, y: -100 });
  const targetRef = useRef({ x: -100, y: -100 });
  const rafRef = useRef<number>(0);

  useEffect(() => {
    // Don't render on touch devices
    if (window.matchMedia("(hover: none) and (pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    function renderLoop() {
      const el = cursorRef.current;
      if (el) {
        // Smooth lerp
        posRef.current.x += (targetRef.current.x - posRef.current.x) * 0.15;
        posRef.current.y += (targetRef.current.y - posRef.current.y) * 0.15;

        el.style.left = `${posRef.current.x}px`;
        el.style.top = `${posRef.current.y}px`;
      }
      rafRef.current = requestAnimationFrame(renderLoop);
    }

    const onMouseMove = (e: MouseEvent) => {
      targetRef.current.x = e.clientX;
      targetRef.current.y = e.clientY;
    };

    const onMouseOver = (e: MouseEvent) => {
      const el = cursorRef.current;
      if (!el) return;
      const target = e.target as HTMLElement;

      if (
        target.closest("button") ||
        target.closest("a") ||
        target.closest("[role='button']")
      ) {
        el.classList.add("hovering");
        el.classList.remove("input-hover");
      } else if (
        target.closest("input") ||
        target.closest("textarea")
      ) {
        el.classList.add("input-hover");
        el.classList.remove("hovering");
      } else {
        el.classList.remove("hovering", "input-hover");
      }
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseover", onMouseOver, { passive: true });
    rafRef.current = requestAnimationFrame(renderLoop);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseover", onMouseOver);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      ref={cursorRef}
      className="custom-cursor pointer-events-none fixed z-50 rounded-full"
      style={{
        width: "28px",
        height: "28px",
        border: "1px solid var(--accent)",
        boxShadow: "0 0 12px var(--accent-dim), inset 0 0 6px var(--accent-dim)",
        transform: "translate(-50%, -50%)",
        transition: "width 0.2s var(--ease-snappy), height 0.2s var(--ease-snappy), border-color 0.2s, background-color 0.2s, border-radius 0.2s",
        willChange: "left, top",
      }}
    >
      <div
        className="absolute top-1/2 left-1/2 rounded-full"
        style={{
          width: "4px",
          height: "4px",
          background: "var(--accent)",
          boxShadow: "0 0 6px var(--accent)",
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}
