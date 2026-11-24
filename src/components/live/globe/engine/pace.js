// Pace chart: today's cumulative revenue (solid, up to now) against yesterday's (thin, whole day).
const DAY = 86400;
const STEP = 900; // 15 min

/** Cumulative total in 15-minute steps. `pts` = [[second of day, amount], ...]. */
export function cumulative(pts, until = DAY) {
  const n = Math.floor(Math.min(until, DAY) / STEP) + 1;
  const out = new Float64Array(n);
  for (const [s, v] of pts) { const i = Math.min(n - 1, Math.ceil(s / STEP)); if (s <= until) out[i] += v; }
  for (let i = 1; i < n; i++) out[i] += out[i - 1];
  return out;
}
export const totalAt = (pts, sec) => pts.reduce((a, [s, v]) => (s <= sec ? a + v : a), 0);

export function drawPace(canvas, { today, prev, nowSec, tip, color = "#ffffff" }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const padL = 2, padR = 10, padT = 10, padB = 20;
  const cw = w - padL - padR, ch = h - padT - padB;
  const pc = cumulative(prev);
  const tc = cumulative(today, nowSec);
  const tipV = tip ?? tc[tc.length - 1];
  const max = Math.max(pc[pc.length - 1], tipV, 1) * 1.12;
  const X = (sec) => padL + (sec / DAY) * cw;
  const Y = (v) => padT + ch - (v / max) * ch;

  // axis: hours
  g.font = `500 10px ${getComputedStyle(canvas).fontFamily || "system-ui, sans-serif"}`;
  g.fillStyle = "rgba(255,255,255,0.32)";
  g.textBaseline = "alphabetic";
  for (const hh of [0, 6, 12, 18, 24]) {
    const x = X(hh * 3600);
    g.textAlign = hh === 0 ? "left" : hh === 24 ? "right" : "center";
    g.fillText(String(hh).padStart(2, "0") + ":00", x, h - 4);
    g.fillStyle = "rgba(255,255,255,0.05)";
    g.fillRect(Math.round(x), padT, 1, ch);
    g.fillStyle = "rgba(255,255,255,0.32)";
  }

  // a smooth curve through the midpoints (it never overshoots the values)
  const path = (arr, lastX, lastY) => {
    g.beginPath();
    g.moveTo(X(0), Y(arr[0]));
    for (let i = 1; i < arr.length; i++) {
      const x0 = X((i - 1) * STEP), y0 = Y(arr[i - 1]), x1 = X(i * STEP), y1 = Y(arr[i]);
      g.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    if (lastX != null) g.lineTo(lastX, lastY);
    else g.lineTo(X((arr.length - 1) * STEP), Y(arr[arr.length - 1]));
  };

  // yesterday
  g.lineWidth = 1.25; g.strokeStyle = "rgba(255,255,255,0.26)"; g.setLineDash([3, 4]);
  path(pc); g.stroke(); g.setLineDash([]);

  // today
  const ex = X(Math.min(nowSec, DAY)), ey = Y(tipV);
  path(tc, ex, ey);
  g.lineTo(ex, padT + ch); g.lineTo(X(0), padT + ch); g.closePath();
  const fill = g.createLinearGradient(0, padT, 0, padT + ch);
  fill.addColorStop(0, "rgba(160,210,250,0.20)"); fill.addColorStop(1, "rgba(160,210,250,0)");
  g.fillStyle = fill; g.fill();
  g.lineWidth = 2.25; g.strokeStyle = color; g.lineJoin = "round"; g.lineCap = "round";
  g.shadowColor = "rgba(150,205,255,0.7)"; g.shadowBlur = 10;
  path(tc, ex, ey); g.stroke();
  g.shadowBlur = 0;

  // tip
  const halo = g.createRadialGradient(ex, ey, 0, ex, ey, 13);
  halo.addColorStop(0, "rgba(170,215,255,0.55)"); halo.addColorStop(1, "rgba(170,215,255,0)");
  g.fillStyle = halo; g.beginPath(); g.arc(ex, ey, 13, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#fff"; g.beginPath(); g.arc(ex, ey, 3.6, 0, Math.PI * 2); g.fill();
}
