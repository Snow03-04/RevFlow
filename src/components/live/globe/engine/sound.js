// Sounds of the live globe, synthesised:
//   sale   -> a cash-register "ka-ching": drawer click, small bell, coins settling
//             (replaced by public/globe/venda.mp3 when that file exists)
//   comet  -> a short, quiet whoosh
//   record -> the bell as an arpeggio
// Browsers only allow audio after a click or key press on the page: `arm()` handles that.
const BELL = [1, 2.76, 5.4, 8.93]; // partials of a small bell (deliberately not harmonic: that is the metal)
const KEY = "revflow.globe.sound";

export class Sound {
  constructor() {
    this.on = localStorage.getItem(KEY) !== "0"; // on unless switched off
    this.ctx = null; this.noise = null; this.custom = null;
  }

  arm() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.8;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      this.out.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.loadCustom();
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return true;
  }
  /** An audio file for the sale, if the deployment ships one. Without it the synthesised ka-ching plays. */
  async loadCustom() {
    try {
      const response = await fetch("/globe/venda.mp3");
      if (!response.ok || !/audio|octet/.test(response.headers.get("content-type") || "")) return;
      this.custom = await this.ctx.decodeAudioData(await response.arrayBuffer());
    } catch { /* no file, or not audio: keep the synthesised sound */ }
  }
  toggle() {
    this.on = !this.on;
    localStorage.setItem(KEY, this.on ? "1" : "0");
    if (this.on && this.arm()) setTimeout(() => this.sale(60), 60);
    return this.on;
  }
  get ready() { return this.on && this.ctx && this.ctx.state === "running"; }
  /** On, but still waiting for the first click on the page. */
  get waiting() { return this.on && (!this.ctx || this.ctx.state !== "running"); }
  close() { try { this.ctx?.close(); } catch { /* already closed */ } this.ctx = null; }

  noiseHit(at, { freq, q = 1.5, gain, dur, type = "bandpass" }) {
    const c = this.ctx, t = c.currentTime + at;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const a = c.createGain();
    a.gain.setValueAtTime(gain, t); a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(a).connect(this.out);
    src.start(t, Math.random()); src.stop(t + dur + 0.02);
  }
  bell(freq, at, gain = 0.2, len = 1.2) {
    const c = this.ctx, t = c.currentTime + at;
    BELL.forEach((mult, i) => {
      const o = c.createOscillator(), a = c.createGain();
      o.type = "sine"; o.frequency.value = freq * mult * (1 + (i ? 0.002 : 0));
      const g = gain / (1 + i * 1.5), l = len / (1 + i * 0.9);
      a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(g, t + 0.004);
      a.gain.exponentialRampToValueAtTime(0.0001, t + l);
      o.connect(a).connect(this.out);
      o.start(t); o.stop(t + l + 0.05);
    });
  }

  /** A sale: ka-ching. Bigger orders get more coins and a second bell. `size` is 0..1. */
  sale(size = 0.3) {
    if (!this.ready) return;
    if (this.custom) { const source = this.ctx.createBufferSource(); source.buffer = this.custom; source.connect(this.out); source.start(); return; }
    this.noiseHit(0, { freq: 2400, q: 2.2, gain: 0.5, dur: 0.045 });
    this.noiseHit(0.004, { freq: 190, q: 1, gain: 0.55, dur: 0.11, type: "lowpass" });
    this.noiseHit(0.055, { freq: 3600, q: 3, gain: 0.3, dur: 0.035 });
    this.bell(2093, 0.085, 0.2, 1.35);
    this.bell(2637, 0.1, 0.12, 1.1);
    if (size >= 0.5) this.bell(3136, 0.21, 0.11, 1.2);
    const coins = size >= 0.75 ? 7 : size >= 0.4 ? 5 : 3;
    for (let i = 0; i < coins; i++) this.noiseHit(0.16 + i * 0.055 + Math.random() * 0.03, { freq: 6200 + Math.random() * 2600, q: 9, gain: 0.16 * (1 - i / (coins + 2)), dur: 0.06 });
  }

  whoosh(dur = 1.2) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.2;
    f.frequency.setValueAtTime(240, t); f.frequency.exponentialRampToValueAtTime(1800, t + dur);
    const a = c.createGain();
    a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(0.045, t + dur * 0.8); a.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(f).connect(a).connect(this.out);
    src.start(t); src.stop(t + dur + 0.05);
  }

  fanfare() {
    if (!this.ready) return;
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => this.bell(f, 0.35 + i * 0.1, 0.16, 1.8));
  }
}
