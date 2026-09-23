import { useEffect, useRef, useCallback } from "react";

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

  const updatePosition = useCallback(() => {
    const el = cursorRef.current;
    if (!el) return;

    // Smooth lerp
    posRef.current.x += (targetRef.current.x - posRef.current.x) * 0.15;
    posRef.current.y += (targetRef.current.y - posRef.current.y) * 0.15;

    el.style.left = `${posRef.current.x}px`;
    el.style.top = `${posRef.current.y}px`;

    rafRef.current = requestAnimationFrame(updatePosition);
  }, []);

  useEffect(() => {
    // Don't render on touch devices
    if (window.matchMedia("(hover: none) and (pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

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

    const onMouseDown = () => {
      cursorRef.current?.classList.add("clicking");
    };

    const onMouseUp = () => {
      cursorRef.current?.classList.remove("clicking");
    };

    const onMouseLeave = () => {
      if (cursorRef.current) cursorRef.current.style.opacity = "0";
    };

    const onMouseEnter = () => {
      if (cursorRef.current) cursorRef.current.style.opacity = "1";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseover", onMouseOver);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mouseup", onMouseUp);
    document.documentElement.addEventListener("mouseleave", onMouseLeave);
    document.documentElement.addEventListener("mouseenter", onMouseEnter);

    rafRef.current = requestAnimationFrame(updatePosition);

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseup", onMouseUp);
      document.documentElement.removeEventListener("mouseleave", onMouseLeave);
      document.documentElement.removeEventListener("mouseenter", onMouseEnter);
      cancelAnimationFrame(rafRef.current);
    };
  }, [updatePosition]);

  return <div ref={cursorRef} className="cursor-follower" />;
}
