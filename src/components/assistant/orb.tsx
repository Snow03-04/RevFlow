"use client";

import { useEffect, useRef } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const COLORS: Record<OrbState, [number, number, number]> = {
  idle: [120, 175, 255],
  listening: [110, 225, 255],
  thinking: [180, 140, 255],
  speaking: [120, 205, 255],
};

/**
 * A reactive particle sphere (Canvas 2D, no deps). Rotates continuously and
 * pulses/brightens with `level` (0–1, e.g. mic amplitude). `state` tunes the
 * colour and rotation speed. JARVIS-style.
 */
export function Orb({
  state = "idle",
  level = 0,
  className,
}: {
  state?: OrbState;
  level?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  const stateRef = useRef<OrbState>(state);
  levelRef.current = level;
  stateRef.current = state;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const N = 1200;
    const pts: { x: number; y: number; z: number }[] = [];
    const inc = Math.PI * (3 - Math.sqrt(5)); // golden angle
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * inc;
      pts.push({ x: Math.cos(phi) * r, y, z: Math.sin(phi) * r });
    }

    let dpr = 1;
    function resize() {
      if (!canvas || !ctx) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let t = 0;
    let smooth = 0;

    function frame() {
      if (!canvas || !ctx) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const st = stateRef.current;
      smooth += (levelRef.current - smooth) * 0.12;

      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const base = Math.min(w, h) * 0.36;
      const pulse =
        1 + smooth * 0.16 + Math.sin(t * 0.05) * (st === "idle" ? 0.008 : 0.02);
      const R = base * pulse;

      const speed =
        st === "thinking" ? 0.013 : st === "listening" ? 0.0065 : st === "speaking" ? 0.009 : 0.0035;
      t += 1;
      const ax = t * speed;
      const ay = t * speed * 0.55;
      const cosx = Math.cos(ax),
        sinx = Math.sin(ax),
        cosy = Math.cos(ay),
        siny = Math.sin(ay);
      const [r0, g0, b0] = COLORS[st];

      for (const p of pts) {
        const x1 = p.x * cosy - p.z * siny;
        const z1 = p.x * siny + p.z * cosy;
        const y1 = p.y * cosx - z1 * sinx;
        const z2 = p.y * sinx + z1 * cosx;
        const depth = (z2 + 1) / 2; // 0 (far) .. 1 (near)
        const sx = cx + x1 * R;
        const sy = cy + y1 * R;
        const size = 0.5 + depth * 1.7;
        const alpha = (0.08 + depth * 0.62) * (0.72 + smooth * 0.7);
        ctx.beginPath();
        ctx.fillStyle = `rgba(${r0},${g0},${b0},${alpha})`;
        ctx.arc(sx, sy, size, 0, Math.PI * 2);
        ctx.fill();
      }

      // Soft central glow.
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25);
      grad.addColorStop(0, `rgba(${r0},${g0},${b0},${0.1 + smooth * 0.14})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      raf = requestAnimationFrame(frame);
    }
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className={className} />;
}
