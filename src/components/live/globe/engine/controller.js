// Live globe controller: turns the account's state (today's orders, yesterday's pace, ad spend)
// and its Realtime messages into the globe, the rolling revenue counter and the order list.
//
// Framework-free on purpose: it owns a shadow root, so the 3D canvas, its animation loop and its
// styles are isolated from the React app around it. `mountGlobe` returns the function that tears
// everything down again.
import { createGlobe } from "./scene";
import { Odometer, tween } from "./odometer";
import { drawPace, totalAt } from "./pace";
import { Sound } from "./sound";
import { MARKUP } from "./markup";
import { STYLES } from "./styles";
import codes from "./world-codes.json";

const GW = 1080, GH = 540, NB = " ";
// Ad spend, and a safety net for a missed push. Each read is a server function call, and new orders
// already arrive by push, so an open globe asks rarely.
const STATE_EVERY = 600_000;
const SYMBOL = { EUR: "€", USD: "$", GBP: "£", CAD: "$", AUD: "$", CZK: "Kč", PLN: "zł", HUF: "Ft", SEK: "kr", DKK: "kr", NOK: "kr", RON: "lei", CHF: "CHF" };
const AFTER = new Set(["CZK", "PLN", "HUF", "SEK", "DKK", "NOK", "RON", "CHF"]);
// Where an order without coordinates is drawn: the middle of its country.
const CENTER = { FI: [62.2, 25.7], CZ: [49.8, 15.5], SK: [48.7, 19.5], FR: [46.6, 2.5], PL: [52, 19.4], DE: [51, 10.3], AT: [47.6, 14.1], BE: [50.6, 4.6], NL: [52.2, 5.5],
  LU: [49.8, 6.1], CH: [46.8, 8.2], IT: [42.8, 12.5], ES: [40.2, -3.6], PT: [39.6, -8], GB: [53, -1.8], IE: [53.2, -8], DK: [56, 9.6], SE: [60.5, 15.5], NO: [61, 9],
  EE: [58.7, 25.5], LV: [56.9, 24.9], LT: [55.3, 24], HU: [47.2, 19.4], RO: [45.9, 25], BG: [42.7, 25.3], HR: [45.4, 16.2], SI: [46.1, 14.8], GR: [39.2, 22.3],
  US: [39.5, -98.5], CA: [56, -100], AU: [-25, 134], BR: [-10, -52], MX: [23.5, -102] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const group = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NB);
const dec2 = (v) => v.toFixed(2).replace(".", ",");
const sym = (c) => SYMBOL[c] || c || "";
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const regions = (() => { try { return new Intl.DisplayNames(["pt-PT"], { type: "region" }); } catch { return null; } })();
const country = (cc) => { try { return (cc && regions?.of(cc)) || cc || ""; } catch { return cc || ""; } };
const ago = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 8) return "agora mesmo";
  if (s < 60) return `há ${s}${NB}s`;
  if (s < 3600) return `há ${Math.floor(s / 60)}${NB}min`;
  return `há ${Math.floor(s / 3600)}${NB}h`;
};
const stubGlobe = { strike: () => sleep(500), setMarkers() {}, addMarker() {}, removeMarker() {}, setHeat() {}, celebrate() {}, setHome() {}, destroy() {}, software: false };

/**
 * @param {HTMLElement} host element that receives the shadow root
 * @param {{ loadState: () => Promise<any>, subscribe: (topic: string, onMessage: (m: any) => void, onStatus: (live: boolean) => void) => () => void, initialStore?: string | null }} io
 * @returns {() => void} dispose
 */
export function mountGlobe(host, { loadState, subscribe, initialStore }) {
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${STYLES}</style>${MARKUP}`;
  const $ = (s) => root.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const wrap = $(".gw");

  let dead = false;
  const cleanups = [];
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };
  const every = (fn, ms) => { const id = setInterval(fn, ms); cleanups.push(() => clearInterval(id)); };

  // ---------------------------------------------------------------- formats (currency and timezone come with the state)
  let cur = "EUR", hmsFmt = null, dayFmt = null;
  const setZone = (timeZone) => {
    const zone = (() => { try { new Intl.DateTimeFormat("en-GB", { timeZone }); return timeZone; } catch { return "UTC"; } })();
    hmsFmt = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  };
  setZone("UTC");
  const money0 = (v, c = cur) => (AFTER.has(c) ? `${group(v)}${NB}${sym(c)}` : `${sym(c)}${group(v)}`);
  const money2 = (v, c) => (AFTER.has(c) ? `${group(v)}${NB}${sym(c)}` : `${sym(c)}${v.toFixed(2).replace(".", ",")}`);
  const secOfDay = (ms) => { const [h, m, s] = hmsFmt.format(new Date(ms)).split(":").map(Number); return h * 3600 + m * 60 + s; };

  // ---------------------------------------------------------------- state
  const S = {
    stores: [], byKey: {}, orders: new Map(), shown: new Set(), prev: [], ads: { at: 0, updated: 0, today: {} }, week: {},
    filter: initialStore || localStorage.getItem("revflow.globe.store") || "all", mode: "live", vnow: null, skew: 0, day: "", ready: false, live: false, passed: "", topic: "",
  };
  const now = () => Date.now() + S.skew;
  const viewNow = () => S.vnow ?? now();
  const inFilter = (o) => S.filter === "all" || o.store === S.filter;
  const accent = () => (S.filter === "all" ? "#a9d9f9" : S.byKey[S.filter]?.color || "#a9d9f9");

  let grid = null;
  function centerOf(cc) {
    if (CENTER[cc]) return CENTER[cc];
    const idx = codes.indexOf(cc);
    if (idx > 0 && grid) {
      let x = 0, y = 0, z = 0;
      for (let gy = 0; gy < GH; gy += 2) {
        const lat = (90 - ((gy + 0.5) / GH) * 180) * (Math.PI / 180), c = Math.cos(lat);
        for (let gx = 0; gx < GW; gx += 2) if (grid[gy * GW + gx] === idx) { const lng = (((gx + 0.5) / GW) * 360 - 180) * (Math.PI / 180); x += c * c * Math.sin(lng); y += c * Math.sin(lat); z += c * c * Math.cos(lng); }
      }
      if (x || y || z) { const r = Math.hypot(x, y, z); return (CENTER[cc] = [Math.asin(y / r) * (180 / Math.PI), Math.atan2(x, z) * (180 / Math.PI)]); }
    }
    return (CENTER[cc] = [48, 10]);
  }
  function geo(o) {
    if (o.lat != null && o.lng != null) return [o.lat, o.lng];
    const [la, lo] = centerOf(o.cc || S.byKey[o.store]?.home || "DE"), h = hash(o.id);
    return [la + ((h % 1000) / 1000 - 0.5) * 1.5, lo + (((h >>> 10) % 1000) / 1000 - 0.5) * 2.4];
  }

  const sound = new Sound();
  const odo = new Odometer($("#odo"));
  let globe = stubGlobe;

  // ---------------------------------------------------------------- sums
  function compute() {
    const list = [...S.orders.values()].filter((o) => S.shown.has(o.id) && inFilter(o));
    const rev = list.reduce((a, o) => a + o.amount, 0);
    const keys = S.filter === "all" ? S.stores.map((s) => s.key) : [S.filter];
    const ads = keys.reduce((a, k) => a + (S.ads.today?.[k]?.amount || 0), 0);
    const sec = secOfDay(viewNow());
    const si = S.stores.findIndex((s) => s.key === S.filter);
    const prev = S.prev.filter((p) => S.filter === "all" || p[2] === si);
    const prevNow = totalAt(prev, sec), prevTotal = prev.reduce((a, p) => a + p[1], 0);
    const byStore = {}, byCc = {};
    for (const o of S.orders.values()) {
      if (!S.shown.has(o.id)) continue;
      const b = (byStore[o.store] ??= { rev: 0, n: 0 }); b.rev += o.amount; b.n++;
      if (inFilter(o)) byCc[o.cc || "?"] = (byCc[o.cc || "?"] || 0) + 1;
    }
    return { list, rev, keys, n: list.length, ads, roas: ads > 0 ? rev / ads : null, aov: list.length ? rev / list.length : null, sec, prev, prevNow, prevTotal, byStore, byCc,
      last: list.reduce((a, o) => Math.max(a, o.ts), 0) };
  }

  // ---------------------------------------------------------------- drawing
  const paceTip = { v: 0, raf: 0 };
  const drawChart = (c, tip) => drawPace($("#pace"), { today: c.list.map((o) => [secOfDay(o.ts), o.amount]), prev: c.prev, nowSec: c.sec, tip, color: "#ffffff" });

  function refresh({ instant = false } = {}) {
    if (!S.ready || dead) return;
    const c = compute(), keys = c.keys;
    const st = S.byKey[S.filter];
    $("#hero-store").textContent = st ? st.name : "Todas as lojas";
    $("#hero-store").classList.toggle("sn", !!st);
    odo.set(c.rev, { instant });
    tween($("#k-orders"), c.n, (v) => group(v));
    tween($("#k-ads"), c.ads, (v) => money0(v));
    const roas = $("#k-roas");
    if (c.roas == null) { roas.textContent = "–"; roas._v = undefined; } else tween(roas, c.roas, dec2);
    const aov = $("#k-aov");
    if (c.aov == null) { aov.textContent = "–"; aov._v = undefined; } else tween(aov, c.aov, (v) => money0(v));
    paintSubs(c);

    // pace against yesterday
    const pct = $("#pace-pct");
    pct.className = "";
    if (!c.prev.length) pct.textContent = "sem dados de ontem";
    else if (c.prevNow <= 0) pct.textContent = c.rev > 0 ? "ontem a esta hora ainda estava a zero" : "ontem a esta hora também a zero";
    else {
      const p = Math.round((c.rev / c.prevNow - 1) * 100);
      pct.className = p >= 0 ? "up" : "down";
      pct.textContent = "";
      pct.append(el("strong", "fig", `${p >= 0 ? "+" : "−"}${Math.abs(p)}${NB}%`), " vs. ontem a esta hora");
    }
    const prevEnd = $("#pace-prev");
    prevEnd.textContent = c.prev.length ? "ontem acabou em " : "ontem";
    if (c.prev.length) prevEnd.append(el("span", "fig", money0(c.prevTotal)));
    cancelAnimationFrame(paceTip.raf);
    if (instant || document.hidden || Math.abs(paceTip.v - c.rev) < 0.5) { paceTip.v = c.rev; drawChart(c, c.rev); }
    else {
      const from = paceTip.v, t0 = performance.now();
      const tick = (t) => { if (dead) return; const u = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - u, 3); paceTip.v = from + (c.rev - from) * e; drawChart(c, paceTip.v); if (u < 1) paceTip.raf = requestAnimationFrame(tick); };
      paceTip.raf = requestAnimationFrame(tick);
    }

    // stores
    const all = { rev: 0, n: 0 };
    for (const b of Object.values(c.byStore)) { all.rev += b.rev; all.n += b.n; }
    for (const chip of $("#chips").children) {
      const k = chip.dataset.k, b = k === "all" ? all : c.byStore[k] || { rev: 0, n: 0 };
      chip.classList.toggle("on", k === S.filter);
      chip.classList.toggle("zero", !b.n);
      tween(chip.querySelector("b"), b.rev, (v) => money0(v), { ms: 700 });
      chip.querySelector("em").textContent = String(b.n);
    }

    // the last seven days (six stored days + today so far)
    const wk = $("#week");
    const days = [];
    for (let i = 6; i >= 1; i--) {
      const d = new Date(S.day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - i);
      const ymd = d.toISOString().slice(0, 10), per = S.week[ymd] || {};
      days.push({ ymd, amount: keys.reduce((a, k) => a + (per[k]?.amount || 0), 0), n: keys.reduce((a, k) => a + (per[k]?.n || 0), 0), label: "DSTQQSS"[d.getUTCDay()] });
    }
    days.push({ ymd: S.day, amount: c.rev, n: c.n, label: "hoje", today: true });
    const top7 = Math.max(1, ...days.map((d) => d.amount));
    if (wk.children.length !== days.length) { wk.textContent = ""; for (const d of days) { const b = el("div", "bar" + (d.today ? " today" : "")); b.append(el("i"), el("span", "", d.label)); wk.append(b); } }
    days.forEach((d, i) => { const b = wk.children[i]; b.style.setProperty("--c", accent()); b.firstChild.style.height = `${Math.max(2, (d.amount / top7) * 100)}%`; b.lastChild.textContent = d.label; b.title = `${d.ymd.slice(8)}/${d.ymd.slice(5, 7)} · ${money0(d.amount)} · ${d.n} encomendas`; });
    const past = days.filter((d) => !d.today && (d.amount > 0 || d.n > 0));
    const avg = $("#week-avg");
    avg.textContent = "";
    if (past.length) avg.append("média ", el("span", "fig", money0(past.reduce((a, d) => a + d.amount, 0) / past.length)), "/dia");

    // countries
    const flags = $("#flags");
    flags.textContent = "";
    const top = Object.entries(c.byCc).filter(([cc]) => cc !== "?").sort((a, b) => b[1] - a[1]);
    for (const [cc, n] of top.slice(0, 5)) { const s = el("span"); s.title = country(cc); s.append(flagImg(cc), el("span", "fig", String(n))); flags.append(s); }
    const max = top[0]?.[1] || 1;
    globe.setHeat(Object.fromEntries(top.map(([cc, n]) => [cc, 0.4 + 0.6 * (n / max)])), accent());
    const empty = $("#empty");
    empty.hidden = c.n > 0 || $("#orders").children.length > 0;
    if (!empty.hidden && !S.stores.length) empty.textContent = "Ainda não tens nenhuma loja ligada. Liga uma em Connections e as encomendas caem aqui.";
  }
  function paintSubs(c = compute()) {
    const a = S.ads;
    $("#k-ads-sub").textContent = a.updated ? `atualizado ${ago(now() - a.updated)}` : " ";
    $("#k-last").textContent = c.last ? `última ${ago(viewNow() - c.last)}` : " ";
  }

  function flagImg(cc) {
    const i = el("img", "flag");
    i.alt = ""; i.loading = "lazy"; i.decoding = "async";
    i.src = `/globe/flags/${String(cc || "xx").toLowerCase()}.svg`;
    i.onerror = () => { i.style.visibility = "hidden"; };
    return i;
  }
  const shortNum = (o) => { const m = /(\d+)\s*$/.exec(o.num || ""); return m ? "#" + m[1] : o.num || "#"; };
  const rowOf = (id) => $("#orders").querySelector(`[data-id="${CSS.escape(id)}"]`);

  function rowEl(o, { fresh = false, test = false, upsell = false } = {}) {
    const st = S.byKey[o.store];
    const li = el("li", "row" + (fresh ? " fresh" : ""));
    li.dataset.id = o.id;
    li.style.setProperty("--c", st.color);
    const badge = el("span", "badge");
    badge.append(el("span", "sn", st.name.trim()[0]?.toUpperCase() || "•"));
    const l1 = el("div", "l1");
    l1.append(el("b", "num", shortNum(o)));
    if (test) l1.append(el("span", "tag", "ENSAIO"));
    if (upsell) l1.append(el("span", "tag", "UPSELL"));
    l1.append(flagImg(o.cc), el("span", "where", o.city || country(o.cc)));
    const a = el("span", "ago", ago(viewNow() - o.ts));
    a.dataset.ts = o.ts;
    l1.append(a);
    const l2 = el("div", "l2");
    l2.append(o.title ? document.createTextNode(o.title + (o.more ? ` +${o.more}` : "")) : el("span", "sn", st.name));
    if (o.cur && o.cur !== cur) l2.append(" · ", el("span", "fig", money2(o.total, o.cur)));
    li.append(badge, l1, l2, el("span", "amt", money0(o.amount)));
    return li;
  }
  function renderList() {
    const ul = $("#orders");
    ul.textContent = "";
    const list = [...S.orders.values()].filter((o) => S.shown.has(o.id) && inFilter(o)).sort((a, b) => b.ts - a.ts).slice(0, 60);
    for (const o of list) ul.append(rowEl(o));
  }
  function addRow(o, opts) {
    const ul = $("#orders");
    rowOf(o.id)?.remove();
    const li = rowEl(o, opts);
    ul.prepend(li);
    ul.scrollTop = 0;
    while (ul.children.length > 60) ul.lastChild.remove();
    $("#empty").hidden = true;
    return li;
  }
  function dropRow(id) {
    const li = rowOf(id);
    if (!li) return;
    li.classList.add("out");
    setTimeout(() => li.remove(), 520);
  }

  const markerOf = (o) => { const [lat, lng] = geo(o); return { id: o.id, lat, lng, color: S.byKey[o.store].color, eur: o.amount, dim: !inFilter(o) }; };
  function syncMarkers(opts) {
    const list = [...S.orders.values()].filter((o) => S.shown.has(o.id));
    globe.setMarkers(list.map(markerOf), opts);
    const mine = list.filter(inFilter).map(geo);
    if (mine.length) {
      const la = mine.reduce((a, p) => a + p[0], 0) / mine.length, lo = mine.reduce((a, p) => a + p[1], 0) / mine.length;
      globe.setHome(clamp(la - 15, -30, 46), lo);
    } else if (S.byKey[S.filter]?.home) { const h = centerOf(S.byKey[S.filter].home); globe.setHome(clamp(h[0] - 15, -30, 46), h[1]); }
    else globe.setHome(34, 14);
  }

  function buildChips() {
    const nav = $("#chips");
    nav.textContent = "";
    S.stores.forEach((s, i) => { s.index = i; });
    for (const s of [{ key: "all", name: "Todas", color: "#a9d9f9" }, ...S.stores]) {
      const b = el("button", "chip");
      b.type = "button"; b.dataset.k = s.key; b.style.setProperty("--c", s.color);
      b.title = s.key === "all" ? "Todas as lojas (0)" : s.index < 9 ? `Só esta loja (${s.index + 1})` : "Só esta loja";
      b.append(el("i"), el("span", s.key === "all" ? "n" : "n sn", s.name), el("b", "", money0(0)), el("em", "", "0"));
      b.onclick = () => setFilter(s.key);
      nav.append(b);
    }
  }
  function setFilter(k) {
    if (k !== "all" && !S.byKey[k]) k = "all";
    if (S.mode === "replay") stopReplay();
    S.filter = k;
    localStorage.setItem("revflow.globe.store", k);
    renderList(); syncMarkers(); refresh();
  }

  function setLive() {
    const p = $("#live");
    p.className = "pill " + (S.mode === "replay" ? "replay" : S.live ? "on" : "off");
    p.querySelector("b").textContent = S.mode === "replay" ? "REPETIÇÃO" : S.live ? "AO VIVO" : "A LIGAR";
    p.title = S.live ? "As encomendas novas aparecem aqui no momento em que a Shopify as comunica." : "A ligar ao canal em direto…";
    $("#btn-replay").classList.toggle("active", S.mode === "replay");
  }
  let bannerTimer = 0;
  function banner(small, big, { fig = false } = {}) {
    const b = $("#banner");
    b.hidden = true; void b.offsetWidth;
    b.querySelector("small").textContent = small; b.querySelector("b").textContent = big;
    b.querySelector("b").classList.toggle("fig", fig);
    b.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { b.hidden = true; }, 5300);
  }
  function notice(text) { const n = $("#notice"); n.textContent = text || ""; n.hidden = !text; }

  // ---------------------------------------------------------------- a new order
  const queue = [];
  let pumping = false;
  function enqueue(o, opts = {}) { queue.push({ o, opts }); pump(); }
  async function pump() {
    if (pumping) return;
    pumping = true;
    while (queue.length && S.mode === "live" && !dead) {
      const { o, opts } = queue.shift();
      celebrate(o, opts);
      await sleep(queue.length > 3 ? 280 : 800);
    }
    pumping = false;
  }

  function milestone(before, after) {
    const step = after < 1000 ? 250 : after < 5000 ? 500 : after < 20000 ? 1000 : 5000;
    const c = compute();
    if (S.passed !== S.day + S.filter && c.prevTotal > 0 && before <= c.prevTotal && after > c.prevTotal) {
      S.passed = S.day + S.filter;
      banner("ONTEM JÁ FICOU PARA TRÁS", `${money0(after)} hoje · ontem ${money0(c.prevTotal)}`, { fig: true });
      globe.celebrate("#ffd27a"); sound.fanfare();
    } else if (Math.floor(after / step) > Math.floor(before / step)) {
      banner("MARCO DE HOJE", `${money0(Math.floor(after / step) * step)} ultrapassados`, { fig: true });
      globe.celebrate(accent()); sound.fanfare();
    }
  }

  async function celebrate(o, { test = false, replay = false } = {}) {
    const st = S.byKey[o.store];
    if (!st) return;
    const vis = inFilter(o);
    const land = () => {
      if (dead || !S.orders.has(o.id)) return; // cancelled meanwhile
      const before = compute().rev;
      S.shown.add(o.id);
      if (vis && !rowOf(o.id)) addRow(o, { test });
      refresh();
      if (vis) { const aov = compute().aov || o.amount || 1; sound.sale(clamp(o.amount / (aov * 3), 0, 1)); if (!test && !replay) milestone(before, before + o.amount); }
    };
    if (document.hidden) { if (vis) addRow(o, { test }); globe.addMarker(markerOf(o)); land(); }
    else {
      if (vis) addRow(o, { fresh: true, test });
      sound.whoosh();
      const [lat, lng] = geo(o);
      // The comet's flight is animation time. A window that is covered or throttled draws a frame
      // a second, so the sale is counted after four seconds at most, wherever the comet is.
      await Promise.race([
        globe.strike({ id: o.id, lat, lng, color: st.color, eur: o.amount, dim: !vis },
          { label: { amount: "+" + money0(o.amount), where: o.city || country(o.cc), store: st.name, test }, duration: replay ? 0.95 : 1.25 }),
        sleep(4000),
      ]);
      land();
    }
    if (test) setTimeout(() => removeOrder(o.id), 15000);
  }
  /** The same order with a new amount. Grown by a post-purchase upsell: a second comet brings the difference. */
  function revalue(old, next) {
    const delta = next.amount - old.amount;
    if (delta > 0.5 && S.shown.has(old.id) && S.mode === "live") { upsell(old, next, delta); return; }
    Object.assign(old, next);
    if (Math.abs(delta) > 0.005 && S.shown.has(old.id)) { rowOf(old.id)?.replaceWith(rowEl(old)); globe.addMarker(markerOf(old)); refresh(); }
  }
  async function upsell(o, next, delta) {
    const st = S.byKey[o.store], vis = inFilter(o);
    const apply = () => {
      if (dead || !S.orders.has(o.id)) return;
      const before = compute().rev;
      Object.assign(o, next);
      rowOf(o.id)?.replaceWith(rowEl(o, { fresh: true, upsell: true }));
      globe.addMarker(markerOf(o));
      refresh();
      if (vis) { const aov = compute().aov || delta || 1; sound.sale(clamp(delta / (aov * 3), 0, 1)); milestone(before, before + delta); }
    };
    if (document.hidden || !vis) return apply();
    sound.whoosh(0.9);
    const [lat, lng] = geo(o);
    // Counted at impact, and after four seconds at most if the window is drawing slowly.
    await Promise.race([
      globe.strike({ id: o.id, lat, lng, color: st.color, eur: next.amount, dim: false },
        { label: { amount: "+" + money0(delta), where: `upsell · ${o.city || country(o.cc)}`, store: st.name }, duration: 1.05 }),
      sleep(4000),
    ]);
    apply();
  }
  function removeOrder(id) {
    if (dead || !S.orders.delete(id)) return;
    S.shown.delete(id);
    globe.removeMarker(id);
    dropRow(id);
    refresh();
  }

  // ---------------------------------------------------------------- replaying today
  let replayCtl = null;
  function stopReplay() { if (replayCtl) replayCtl.stop = true; }
  async function replay() {
    if (S.mode === "replay") return stopReplay();
    if (!S.ready) return;
    const list = [...S.orders.values()].filter((o) => inFilter(o) && !o.id.startsWith("test:")).sort((a, b) => a.ts - b.ts);
    if (!list.length) return banner("REPETIÇÃO", "Ainda não há encomendas hoje");
    const ctl = (replayCtl = { stop: false });
    S.mode = "replay"; setLive();
    for (const o of list) S.shown.delete(o.id);
    $("#orders").textContent = "";
    syncMarkers();
    const end = now(), start = Math.min(list[0].ts - 20 * 60000, end - 3600000);
    S.vnow = start;
    refresh();
    await sleep(900);
    const total = clamp(5 + list.length * 1.15, 9, 44) * 1000;
    // each order's launch time: proportional to its real time, with a minimum gap
    const gap = clamp(44000 / list.length, 110, 420), at = [];
    for (let i = 0; i < list.length; i++) at.push(Math.max(((list[i].ts - start) / (end - start)) * total, i ? at[i - 1] + gap : 0));
    const finish = Math.max(total, at[at.length - 1] + 600);
    const t0 = performance.now();
    let next = 0, lastPaint = 0;
    while (!ctl.stop && !dead) {
      const e = performance.now() - t0;
      while (next < list.length && at[next] <= e) celebrate(list[next++], { replay: true });
      // virtual clock: interpolate between launches so the time on screen matches the orders
      let v;
      if (next === 0) v = start + (list[0].ts - start) * (e / Math.max(at[0], 1));
      else if (next >= list.length) v = list[list.length - 1].ts + (end - list[list.length - 1].ts) * clamp((e - at[at.length - 1]) / Math.max(finish - at[at.length - 1], 1), 0, 1);
      else v = list[next - 1].ts + (list[next].ts - list[next - 1].ts) * ((e - at[next - 1]) / Math.max(at[next] - at[next - 1], 1));
      S.vnow = clamp(v, start, end);
      paintClock();
      if (e - lastPaint > 120) { lastPaint = e; drawChart(compute(), paceTip.v); }
      if (e > finish + 1900) break;
      await new Promise((r) => (document.hidden ? setTimeout(r, 50) : requestAnimationFrame(r)));
    }
    if (dead) return;
    S.mode = "live"; S.vnow = null; replayCtl = null;
    for (const o of S.orders.values()) if (!queue.some((q) => q.o.id === o.id)) S.shown.add(o.id);
    setLive(); renderList(); syncMarkers(); refresh(); paintClock();
    pump();
  }

  // ---------------------------------------------------------------- server
  function initState(d) {
    cur = d.currency || "EUR";
    setZone(d.timeZone || "UTC");
    $("#cur").textContent = sym(cur);
    $(".odo").classList.toggle("after", AFTER.has(cur));
    S.stores = d.stores; S.byKey = Object.fromEntries(d.stores.map((s) => [s.key, s]));
    if (S.filter !== "all" && !S.byKey[S.filter]) S.filter = "all";
    S.orders = new Map(d.orders.map((o) => [o.id, o]));
    S.shown = new Set(S.orders.keys());
    S.day = d.day; S.prev = d.prev; S.ads = d.ads; S.week = d.week || {}; S.ready = true;
    buildChips(); renderList(); syncMarkers({ fresh: true }); refresh();
  }
  let loading = null;
  function load() {
    loading ??= (async () => {
      try {
        const d = await loadState();
        if (dead) return;
        notice("");
        S.skew = d.now - Date.now();
        if (!S.ready || d.day !== S.day) initState(d);
        else {
          // read again (reconnected, or the periodic check): merge what changed meanwhile
          S.prev = d.prev; S.ads = d.ads; S.week = d.week || {};
          S.stores.forEach((s) => { const fresh = d.stores.find((x) => x.key === s.key); if (fresh) Object.assign(s, { name: fresh.name, home: fresh.home }); });
          const ids = new Set(d.orders.map((o) => o.id));
          for (const id of [...S.orders.keys()]) if (!ids.has(id) && !id.startsWith("test:") && now() - S.orders.get(id).ts > 90_000) removeOrder(id);
          const fresh = [];
          for (const o of d.orders) {
            const old = S.orders.get(o.id);
            if (old) { Object.assign(old, o); continue; }
            if (!S.byKey[o.store]) continue;
            S.orders.set(o.id, o);
            if (now() - o.ts < 30 * 60000) fresh.push(o); else S.shown.add(o.id);
          }
          if (S.mode === "live") { renderList(); syncMarkers(); refresh(); }
          for (const o of fresh) enqueue(o);
        }
        if (d.topic && d.topic !== S.topic) connect(d.topic);
      } catch (error) {
        if (!dead && error?.message !== "unauthorized") notice(S.ready ? "" : "Não foi possível ler as encomendas. A tentar outra vez…");
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function onMessage(m) {
    if (dead || !S.ready || !m) return;
    if (m.t === "order" && m.o?.id) {
      const old = S.orders.get(m.o.id);
      if (old) { revalue(old, m.o); return; }
      if (!S.byKey[m.o.store]) { load(); return; } // a store connected after this view opened
      if (m.o.ts && dayFmt.format(new Date(m.o.ts)) !== S.day) return;
      S.orders.set(m.o.id, m.o);
      enqueue(m.o, { test: !!m.test });
    } else if (m.t === "update" && m.o?.id) {
      const old = S.orders.get(m.o.id);
      if (old) revalue(old, m.o); // an order this view never saw arrives with the next state read
    } else if (m.t === "cancel" && m.id) removeOrder(m.id);
  }

  let unsubscribe = null;
  function connect(topic) {
    unsubscribe?.();
    S.topic = topic;
    let joins = 0;
    unsubscribe = subscribe(topic, onMessage, (live) => {
      if (dead) return;
      const rejoined = live && !S.live && ++joins > 1;
      S.live = live; setLive();
      if (rejoined && S.ready) load(); // anything that arrived while the channel was down
    });
  }

  // ---------------------------------------------------------------- clock and relative times
  function paintClock() { $("#clock").textContent = hmsFmt.format(new Date(viewNow())); }
  let lastChart = 0, lastState = Date.now();
  every(() => {
    if (!S.ready) return;
    paintClock();
    const v = viewNow();
    for (const a of root.querySelectorAll("#orders .ago")) a.textContent = ago(v - Number(a.dataset.ts));
    paintSubs();
    if (S.mode !== "live") return;
    const dayChanged = dayFmt.format(new Date(now())) !== S.day; // midnight: a new day
    if (dayChanged || (!document.hidden && Date.now() - lastState > STATE_EVERY)) { lastState = Date.now(); load(); }
    else if (Date.now() - lastChart > 30000) { lastChart = Date.now(); refresh(); }
  }, 1000);

  // ---------------------------------------------------------------- buttons and keys
  function paintSound() {
    const b = $("#btn-sound");
    b.classList.toggle("active", sound.on);
    b.classList.toggle("waiting", sound.waiting);
    b.title = !sound.on ? "Som desligado (S)" : sound.waiting ? "Som ligado: clica uma vez na página para o browser deixar tocar" : "Som ligado (S)";
  }
  function toggleSound() { sound.toggle(); setTimeout(paintSound, 150); }
  // The eye. "stores" blurs the store names (how the page opens), "all" blurs the revenue and every
  // other figure as well, "none" shows everything. Whatever is blurred reads under the pointer.
  const PRIVACY = ["stores", "all", "none"];
  let privacy = "stores";
  function paintNames() {
    const b = $("#btn-names");
    wrap.classList.toggle("names", privacy === "none");
    wrap.classList.toggle("nofig", privacy === "all");
    b.classList.toggle("active", privacy === "none");
    b.classList.toggle("all", privacy === "all");
    b.title = privacy === "stores" ? "Lojas escondidas. Clica para esconder também a faturação, os números e os países (N)"
      : privacy === "all" ? "Lojas, números e países escondidos. Clica para mostrar tudo (N)"
      : "Tudo à vista. Clica para esconder as lojas (N)";
  }
  function toggleNames() {
    privacy = PRIVACY[(PRIVACY.indexOf(privacy) + 1) % PRIVACY.length];
    try { localStorage.setItem("revflow.globe.privacy", privacy); } catch { /* it still applies until the page closes */ }
    paintNames();
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else { await document.documentElement.requestFullscreen(); navigator.wakeLock?.request("screen").catch(() => null); }
    } catch { /* the browser refused */ }
  }
  /** A made-up order on this screen only, to show the animation. It leaves after 15 s and is never counted. */
  function rehearse() {
    if (!S.ready || S.mode !== "live" || !S.stores.length) return;
    const pool = S.filter === "all" ? S.stores : [S.byKey[S.filter]];
    const s = pool[Math.floor(Math.random() * pool.length)];
    const [la, lo] = centerOf(s.home || "DE");
    const c = compute(), amount = Math.round((c.aov || 60) * (0.6 + Math.random() * 1.2));
    const o = { id: "test:" + Date.now() + Math.random(), store: s.key, num: "#TESTE", ts: now(), total: amount, cur, amount, city: "", cc: s.home || "",
      lat: la + (Math.random() - 0.5) * 3, lng: lo + (Math.random() - 0.5) * 5, title: "Encomenda de ensaio", more: 0 };
    S.orders.set(o.id, o);
    enqueue(o, { test: true });
  }

  $("#btn-sound").onclick = toggleSound;
  $("#btn-replay").onclick = () => replay();
  $("#btn-full").onclick = fullscreen;
  $("#btn-names").onclick = toggleNames;
  try {
    const saved = localStorage.getItem("revflow.globe.privacy");
    // "revflow.globe.names" is the choice from before the eye had a third state.
    privacy = PRIVACY.includes(saved) ? saved : localStorage.getItem("revflow.globe.names") === "1" ? "none" : "stores";
  } catch { /* storage is blocked: open as usual */ }
  paintSound(); paintNames(); setLive(); paintClock();
  const armSound = () => { if (sound.on && sound.waiting) { sound.arm(); setTimeout(paintSound, 200); } };
  on(window, "pointerdown", armSound, { passive: true });
  on(window, "keydown", (e) => {
    const t = e.target;
    if (e.ctrlKey || e.metaKey || e.altKey || (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
    armSound();
    const k = e.key.toLowerCase();
    if (k === "r") replay(); else if (k === "s") toggleSound(); else if (k === "f") fullscreen(); else if (k === "n") toggleNames(); else if (k === "t") rehearse();
    else if (/^[0-9]$/.test(k) && S.ready) setFilter(k === "0" ? "all" : S.stores[Number(k) - 1]?.key || "all");
  });
  let idleTimer = 0;
  const wake = () => { wrap.classList.remove("idle"); clearTimeout(idleTimer); idleTimer = setTimeout(() => wrap.classList.add("idle"), 5000); };
  on(window, "pointermove", wake, { passive: true });
  on(window, "resize", () => S.ready && refresh({ instant: true }));
  on(document, "visibilitychange", () => { if (!document.hidden && S.ready && S.mode === "live") { lastState = Date.now(); load(); } });
  wake();

  // ---------------------------------------------------------------- start
  (async () => {
    try {
      grid = new Uint8Array(await (await fetch("/globe/world.bin")).arrayBuffer());
      if (dead) return;
      globe = createGlobe({ canvas: $("#gl"), slot: $("#slot"), fx: $("#fx"), grid, gridW: GW, gridH: GH, codes });
      // Without a GPU the blur behind the cards costs half the frames: drop it.
      const lite = () => wrap.classList.add("lite");
      if (globe.software) lite(); else globe.onSlow = lite;
    } catch {
      $("#gl").style.display = "none"; // no WebGL: the numbers and the list still work
    }
    if (!dead) load();
  })();

  return function dispose() {
    dead = true;
    stopReplay();
    clearTimeout(bannerTimer); clearTimeout(idleTimer);
    cancelAnimationFrame(paceTip.raf);
    for (const fn of cleanups) fn();
    unsubscribe?.();
    globe.destroy();
    sound.close();
    root.innerHTML = "";
  };
}
