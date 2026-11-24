// Rolling counter, like an odometer: the units turn continuously and each place above only
// advances when the one below comes round. Fast reels are blurred.
export class Odometer {
  constructor(el) {
    this.el = el;
    this.shown = 0; this.from = 0; this.to = 0; this.t0 = 0; this.dur = 0; this.raf = 0;
    this.cols = []; // right to left (0 = units)
    this.build(1);
    this.paint(0, 0);
  }

  build(n) {
    this.el.textContent = "";
    this.cols = [];
    for (let k = n - 1; k >= 0; k--) {
      const d = document.createElement("span");
      d.className = "d";
      const col = document.createElement("span");
      col.className = "col";
      for (let i = 0; i <= 10; i++) { const s = document.createElement("span"); s.textContent = String(i % 10); col.append(s); }
      d.append(col);
      this.el.append(d);
      let sep = null;
      if (k % 3 === 0 && k > 0) { sep = document.createElement("span"); sep.className = "sep"; this.el.append(sep); }
      this.cols[k] = { d, col, sep, pos: -1 };
    }
  }

  paint(v, speed) {
    const n = Math.max(1, String(Math.floor(Math.max(v, this.to) + 1e-6)).length);
    if (n !== this.cols.length) this.build(n);
    for (let k = 0; k < this.cols.length; k++) {
      const pow = 10 ** k;
      const digit = Math.floor(v / pow) % 10;
      let frac;
      if (k === 0) frac = v - Math.floor(v);
      else { const lower = (v % pow) / pow, start = 1 - 1 / pow; frac = lower > start ? (lower - start) * pow : 0; }
      const c = this.cols[k];
      const pos = digit + frac;
      if (pos !== c.pos) { c.col.style.transform = `translateY(${(-pos * 100) / 11}%)`; c.pos = pos; }
      const s = speed / pow; // places per second on this reel
      const cls = s > 16 ? "d fast" : s > 5 ? "d mid" : "d";
      if (c.d.className !== cls) c.d.className = cls;
      // leading zeros are not shown
      const lead = k > 0 && v < pow;
      if (c.d.hidden !== lead) { c.d.hidden = lead; if (c.sep) c.sep.hidden = lead; }
    }
  }

  set(value, { instant = false } = {}) {
    value = Math.max(0, Math.round(value));
    if (value === this.to && !instant) return;
    cancelAnimationFrame(this.raf);
    this.to = value;
    if (instant || document.hidden) { this.shown = value; this.paint(value, 0); return; }
    this.from = this.shown;
    const delta = Math.abs(value - this.from);
    this.dur = Math.min(2600, 900 + Math.log10(delta + 1) * 420);
    this.t0 = performance.now();
    const tick = (now) => {
      const u = Math.min(1, (now - this.t0) / this.dur);
      const e = 1 - Math.pow(1 - u, 3.2);
      const de = (3.2 * Math.pow(1 - u, 2.2)) / (this.dur / 1000); // derivative, per second
      this.shown = this.from + (this.to - this.from) * e;
      this.paint(this.shown, Math.abs(this.to - this.from) * de);
      if (u < 1) this.raf = requestAnimationFrame(tick);
      else { this.shown = this.to; this.paint(this.to, 0); }
    };
    this.raf = requestAnimationFrame(tick);
  }
}

/** A small number that counts to its new value and glows as it changes. */
export function tween(el, to, fmt, { ms = 900 } = {}) {
  const from = el._v ?? to;
  el._v = to;
  cancelAnimationFrame(el._raf);
  if (from === to || document.hidden || !Number.isFinite(from) || !Number.isFinite(to)) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
  const tick = (now) => {
    const u = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - u, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (u < 1) el._raf = requestAnimationFrame(tick); else el.textContent = fmt(to);
  };
  el._raf = requestAnimationFrame(tick);
}
