import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

/**
 * Preloader / intro sequence. The orb is mounted behind this overlay.
 * After fonts and the first paint are ready, we run a timeline:
 *   1. Brand text splits and reveals
 *   2. The progress bar sweeps
 *   3. The overlay wipes away, revealing the orb as the hero moment
 */
// Once per browser session: a splash on every reload just delays the app.
const SEEN_KEY = "preloader_seen";
const skip = () => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  try { return sessionStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
};

export function Preloader({ onComplete }: { onComplete: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(() => !skip());
  // Latest callback in a ref: App passes a new inline function each render,
  // and depending on it used to kill and restart the timeline on every App
  // re-render, leaving the (opacity 0) app invisible far past the intro.
  const done = useRef(onComplete);
  useEffect(() => { done.current = onComplete; }, [onComplete]);

  useEffect(() => {
    if (!show) {
      done.current(); // skipped: reveal the app immediately
      return;
    }
    const tl = gsap.timeline({
      onComplete: () => {
        try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* storage blocked */ }
        setShow(false);
        done.current();
      },
    });

    // Staggered text reveal
    tl.fromTo(
      textRef.current,
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, duration: 0.6, ease: "expo.out" }
    );

    // Progress bar sweep
    tl.fromTo(
      barRef.current,
      { scaleX: 0 },
      { scaleX: 1, duration: 0.8, ease: "power2.inOut" },
      "-=0.2"
    );

    // Hold briefly
    tl.to({}, { duration: 0.3 });

    // Wipe out
    tl.to(overlayRef.current, {
      yPercent: -100,
      duration: 0.6,
      ease: "expo.inOut",
    });

    return () => {
      tl.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once: `show` only starts true/false
  }, []);

  if (!show) return null;

  return (
    <div ref={overlayRef} className="preloader">
      <div ref={textRef} className="preloader-text" style={{ opacity: 0 }}>
        SQL<span style={{ color: "var(--accent)" }}>.</span>AI
      </div>
      <div className="preloader-bar">
        <div
          ref={barRef}
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--accent)",
            transformOrigin: "left center",
            transform: "scaleX(0)",
          }}
        />
      </div>
    </div>
  );
}
