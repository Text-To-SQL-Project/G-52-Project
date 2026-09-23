import { useRef, useCallback } from "react";
import { gsap } from "gsap";

/**
 * Full-screen wipe transition for route changes.
 * Call `trigger()` before changing the screen, then change after the wipe covers.
 */
export function useScreenTransition() {
  const wipeRef = useRef<HTMLDivElement>(null);

  const trigger = useCallback((onMidpoint: () => void) => {
    const el = wipeRef.current;
    if (!el) {
      onMidpoint();
      return;
    }

    const tl = gsap.timeline();

    // Wipe in from bottom
    tl.fromTo(
      el,
      { yPercent: 100, display: "block" },
      { yPercent: 0, duration: 0.35, ease: "expo.inOut" }
    );

    // Midpoint — change the screen
    tl.call(onMidpoint);
    tl.to({}, { duration: 0.05 });

    // Wipe out to top
    tl.to(el, {
      yPercent: -100,
      duration: 0.35,
      ease: "expo.inOut",
      onComplete: () => {
        gsap.set(el, { display: "none", yPercent: 100 });
      },
    });

    return tl;
  }, []);

  const WipeOverlay = (
    <div
      ref={wipeRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        background: "var(--bg-void)",
        display: "none",
        transform: "translateY(100%)",
        pointerEvents: "none",
      }}
    >
      {/* Accent line at the leading edge */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "2px",
          background: "var(--accent)",
          boxShadow: "0 0 20px var(--accent-glow), 0 0 60px var(--accent-glow)",
        }}
      />
    </div>
  );

  return { trigger, WipeOverlay };
}
