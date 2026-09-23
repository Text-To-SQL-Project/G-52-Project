import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

/**
 * Preloader / intro sequence. The orb is mounted behind this overlay.
 * After fonts and the first paint are ready, we run a timeline:
 *   1. Brand text splits and reveals
 *   2. The progress bar sweeps
 *   3. The overlay wipes away, revealing the orb as the hero moment
 */
export function Preloader({ onComplete }: { onComplete: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(true);

  useEffect(() => {
    const tl = gsap.timeline({
      onComplete: () => {
        setShow(false);
        onComplete();
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
  }, [onComplete]);

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
