import { useEffect, useRef } from "react";
import { cssVar } from "../hooks/useTheme";
import * as THREE from "three";

interface Props {
  status?: "ready" | "loading" | "success" | "blocked" | "error";
  className?: string;
}

// Simplex noise GLSL implementation from Stitch Syntactic Deep design
const vertexShader = `
  varying vec2 vUv;
  varying float vDistortion;
  uniform float uTime;
  uniform float uDistortionScale;
  
  // Simplex noise function
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
      const vec2  C = vec2(1.0/6.0, 1.0/3.0);
      const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
      vec3 i  = floor(v + dot(v, C.yyy));
      vec3 x0 =   v - i + dot(i, C.xxx);
      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min( g.xyz, l.zxy );
      vec3 i2 = max( g.xyz, l.zxy );
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;
      i = mod289(i); 
      vec4 p = permute( permute( permute( 
                i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
              + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
              + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
      float n_ = 0.142857142857;
      vec3  ns = n_ * D.wyz - D.xzx;
      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_ );
      vec4 x = x_ *ns.x + ns.yyyy;
      vec4 y = y_ *ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);
      vec4 b0 = vec4( x.xy, y.xy );
      vec4 b1 = vec4( x.zw, y.zw );
      vec4 s0 = floor(b0)*2.0 + 1.0;
      vec4 s1 = floor(b1)*2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));
      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
      vec3 p0 = vec3(a0.xy,h.x);
      vec3 p1 = vec3(a0.zw,h.y);
      vec3 p2 = vec3(a1.xy,h.z);
      vec3 p3 = vec3(a1.zw,h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
      p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
  }

  void main() {
      vUv = uv;
      vDistortion = snoise(normal + uTime * 0.5) * uDistortionScale;
      vec3 newPosition = position + normal * vDistortion;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
  }
`;

const fragmentShader = `
  varying vec2 vUv;
  varying float vDistortion;
  uniform float uTime;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  
  void main() {
      float noise = vDistortion * 2.5 + 0.5;
      vec3 finalColor = mix(uColor1, uColor2, vUv.y + sin(uTime * 0.25) * 0.25);
      finalColor = mix(finalColor, uColor3, clamp(noise, 0.0, 1.0) * 0.6);
      gl_FragColor = vec4(finalColor, 0.92);
  }
`;

// Brand colours come from the theme tokens (re-read on "themechange"), so the
// orb stays on-palette in both themes. "R G B" tokens -> "rgb(r, g, b)".
const tokenColor = (name: string) => {
  const v = cssVar(name);
  return v.startsWith("#") ? v : `rgb(${v.split(/\s+/).join(", ")})`;
};
const RIM: Record<NonNullable<Props["status"]>, string> = {
  ready: "--accent-pale-rgb",
  loading: "--accent-bright-rgb",
  success: "--success-rgb",
  blocked: "--danger-rgb",
  error: "--danger-rgb",
};

export function AiOrb({ status = "ready", className = "" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let width = container.clientWidth || 220;
    let height = container.clientHeight || 220;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 1000);
    camera.position.z = 2.4;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return;
    }

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const uniforms = {
      uTime: { value: 0 },
      uDistortionScale: { value: 0.38 },
      uColor1: { value: new THREE.Color() },
      uColor2: { value: new THREE.Color() },
      uColor3: { value: new THREE.Color() },
    };
    const paint = () => {
      uniforms.uColor1.value.setStyle(tokenColor("--accent"));
      uniforms.uColor2.value.setStyle(tokenColor("--accent-bright"));
      uniforms.uColor3.value.setStyle(tokenColor(RIM[statusRef.current]));
    };
    paint();

    const geometry = new THREE.IcosahedronGeometry(1.05, 48);
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
    });

    const orb = new THREE.Mesh(geometry, material);
    scene.add(orb);



    // Render only while visible: the workspace stays mounted (hidden) behind
    // other screens, and an always-on WebGL loop costs CPU/GPU for nothing.
    let animationFrameId = 0;
    let onScreen = true;
    let lastStatus = statusRef.current;
    const clock = new THREE.Clock();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const frame = () => {
      const delta = Math.min(clock.getDelta(), 0.1); // no jump after a pause
      const currentStatus = statusRef.current;
      if (currentStatus !== lastStatus) {
        lastStatus = currentStatus;
        paint();
      }
      const loading = currentStatus === "loading";
      uniforms.uTime.value += delta * (loading ? 2.4 : 0.85);
      uniforms.uDistortionScale.value = loading ? 0.55 : currentStatus === "blocked" ? 0.32 : 0.38;
      orb.rotation.y += delta * (loading ? 0.8 : 0.25);
      orb.rotation.x += delta * (loading ? 0.3 : 0.1);
      renderer.render(scene, camera);
    };
    const loop = () => {
      frame();
      animationFrameId = requestAnimationFrame(loop);
    };
    const sync = () => {
      cancelAnimationFrame(animationFrameId);
      if (reduced) return frame(); // one still frame, no motion
      if (onScreen && !document.hidden) {
        clock.getDelta();
        animationFrameId = requestAnimationFrame(loop);
      }
    };
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      sync();
    });
    io.observe(container);
    document.addEventListener("visibilitychange", sync);
    const onTheme = () => {
      paint();
      if (reduced) frame();
    };
    window.addEventListener("themechange", onTheme);
    sync();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 220;
      const h = container.clientHeight || 220;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("themechange", onTheme);
      window.removeEventListener("resize", handleResize);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  const getStatusLabel = () => {
    switch (status) {
      case "loading":
        return "GENERATING & CHECKING SQL";
      case "blocked":
        return "GUARDRAIL ENGAGED";
      case "error":
        return "SYSTEM ERROR";
      case "success":
        return "QUERY EXECUTED";
      default:
        return "AI ENGINE READY";
    }
  };

  const getIndicatorDotClass = () => {
    switch (status) {
      case "loading":
        return "bg-[var(--accent-bright)] animate-ping";
      case "blocked":
        return "bg-[var(--warning)] animate-pulse";
      case "error":
        return "bg-[var(--danger)]";
      case "success":
        return "bg-[var(--success)]";
      default:
        return "bg-[var(--accent)] animate-pulse";
    }
  };

  return (
    <div
      className={`glass-card relative flex flex-col items-center justify-center overflow-hidden rounded-2xl p-4 ${className}`}
    >
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
        <div className={`h-2 w-2 rounded-full ${getIndicatorDotClass()}`} />
        <span className="font-mono text-[10px] font-semibold tracking-wider text-[var(--text-secondary)]">
          {getStatusLabel()}
        </span>
      </div>
      <div ref={containerRef} className="h-[170px] w-[170px] cursor-grab active:cursor-grabbing" />
    </div>
  );
}
