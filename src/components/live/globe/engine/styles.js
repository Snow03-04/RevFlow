// Styles of the live globe. They live in a shadow root (see controller.js): nothing here reaches the
// rest of the app and the app's Tailwind classes do not reach in.
export const STYLES = /* css */ `.gw {
  --ink: #eef3f8; --dim: #8b95a4; --faint: #586170; --line: rgba(255, 255, 255, 0.08);
  --card: rgba(12, 15, 21, 0.62); --blue: #a9d9f9; --gold: #ffd27a; --up: #7fe3ab; --down: #ff9c93;
  --left: clamp(330px, 27vw, 540px); --right: clamp(310px, 23.5vw, 440px);
}
*, *::before, *::after { box-sizing: border-box; }
:host { all: initial; display: block; font-family: inherit; }
.gw { position: fixed; inset: 0; z-index: 40; overflow: hidden; color: var(--ink); background: #000 radial-gradient(1300px 900px at 56% 46%, #0a111d 0%, #05070c 46%, #000 100%);
  font-family: var(--font-sans, Inter), "Segoe UI", system-ui, -apple-system, sans-serif; font-size: 16px; line-height: normal; font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased; }
.gw.idle, .gw.idle * { cursor: none !important; }
p, ul { margin: 0; padding: 0; }
button { font: inherit; color: inherit; }
[hidden] { display: none !important; }

#gl { position: fixed; inset: 0; width: 100vw; height: 100vh; height: 100dvh; z-index: 0; touch-action: none; cursor: grab; }
#gl:active { cursor: grabbing; }
#fx { position: fixed; inset: 0; z-index: 3; pointer-events: none; overflow: hidden; }

#app { position: relative; z-index: 2; height: 100vh; height: 100dvh; display: grid; pointer-events: none;
  grid-template-columns: var(--left) minmax(0, 1fr) var(--right); grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 14px 22px; padding: 22px 28px 24px; }
#app > * { pointer-events: auto; }
#slot { grid-column: 2; grid-row: 2; pointer-events: none !important; min-height: 0; }

/* ------------------------------------------------ topo */
header { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; min-height: 38px; pointer-events: none !important; }
header > * { pointer-events: auto; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: 0.2em; font-size: 14px; color: var(--ink); text-decoration: none; }
.brand svg { width: 26px; height: 26px; padding: 3px; border-radius: 9px; color: #fff; background: linear-gradient(135deg, #3b82f6, #1d4ed8); }
.brand em { font-style: normal; font-weight: 500; letter-spacing: 0.02em; font-size: 13px; color: var(--dim); padding-left: 10px; border-left: 1px solid var(--line); }
.brand:hover em { color: var(--ink); }
.top { display: flex; align-items: center; gap: 12px; }
.pill { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 13px; border-radius: 99px; border: 1px solid rgba(255, 255, 255, 0.2);
  font-size: 12px; letter-spacing: 0.08em; background: rgba(10, 12, 16, 0.5); }
.pill i { width: 8px; height: 8px; border-radius: 50%; background: #5d6672; }
.pill.on i { background: #41e08a; box-shadow: 0 0 0 0 rgba(65, 224, 138, 0.7); animation: beat 1.8s ease-out infinite; }
.pill.replay { border-color: rgba(255, 210, 122, 0.55); color: var(--gold); }
.pill.replay i { background: var(--gold); }
@keyframes beat { 0% { box-shadow: 0 0 0 0 rgba(65, 224, 138, 0.65); } 100% { box-shadow: 0 0 0 9px rgba(65, 224, 138, 0); } }
#clock { font-size: 15px; color: var(--dim); min-width: 74px; text-align: center; letter-spacing: 0.02em; }
.ib { width: 34px; height: 34px; padding: 7px; border-radius: 10px; border: 1px solid transparent; background: transparent; color: var(--dim); cursor: pointer; transition: color 0.2s, background 0.2s, border-color 0.2s; }
.ib:hover, .ib:focus-visible { color: var(--ink); background: rgba(255, 255, 255, 0.07); border-color: var(--line); outline: none; }
.ib svg { width: 100%; height: 100%; display: block; }
.ib.active { color: var(--gold); }
#btn-sound .on { display: none; } #btn-sound.active .on { display: initial; } #btn-sound.active .mute { display: none; }
#btn-sound.active { color: var(--blue); }
#btn-sound.waiting { color: var(--gold); animation: nudge 2.4s ease-in-out infinite; }
@keyframes nudge { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }

/* ------------------------------------------------ nomes das lojas: desfocados, leem-se com o rato por cima (tecla N mostra todos) */
.sn { display: inline-block; filter: blur(0.42em); transition: filter 0.25s ease; font-style: normal; }
.chip:hover .sn, .row:hover .sn, .label:hover .sn, .gw.names .sn { filter: none; }
.label { pointer-events: auto; width: max-content; max-width: 100%; }

/* ------------------------------------------------ números e países: o olho também os desfoca (estado "tudo escondido"); cada um lê-se com o rato por cima */
.fig { display: inline-block; font-style: normal; }
.odo, .kpis b, .chip b, .chip em, .amt, .fig, .pop b, .flag, .where { transition: filter 0.25s ease; }
.gw.nofig :is(.kpis b, .chip b, .chip em, .amt, .fig, .pop b, .where) { filter: blur(0.42em); }
.gw.nofig .flag { filter: blur(5px); }
.gw.nofig .odo { filter: blur(0.19em); pointer-events: auto; }
.gw.nofig :is(.odo:hover, .kpis .card:hover b, .chip:hover b, .chip:hover em, .row:hover .amt, .row:hover .fig, .row:hover .flag, .row:hover .where, .day:hover .fig, .week:hover .fig, .pace:hover .fig, #flags:hover .fig, #flags:hover .flag) { filter: none; }

/* Settings privacy: hide the real glyphs and charts, then blur a neutral mask.
   Neither hover, focus, touch nor the globe's eye can reveal the figures.
   All rules are scoped to this setting; the normal view above is unchanged. */
.gw.private-money .left { display: none; }
.gw.private-money :is(.odo, .kpis b, .chip b, .chip em, .amt, .fig, .pop b, #pace-pct, #week, #pace),
.gw.private-money :is(.odo, .kpis b, .chip b, .chip em, .amt, .fig, .pop b, #pace-pct, #week, #pace) * {
  visibility: hidden !important; user-select: none !important; pointer-events: none !important;
  filter: none !important; transition: none !important;
}
.gw.private-money :is(.odo, .kpis b, .chip b, .chip em, .amt, .fig, .pop b, #pace-pct, #week) { position: relative; }
.gw.private-money :is(.odo, .kpis b, .chip b, .chip em, .amt, .fig, .pop b, #pace-pct)::after {
  content: "••••"; visibility: visible; position: absolute; left: 0; top: 0;
  color: var(--blue); font-style: normal; letter-spacing: .08em;
  filter: blur(.18em); pointer-events: none; text-shadow: none;
}
.gw.private-money #pace-pct .fig::after { content: none; }
.gw.private-money .pace { position: relative; }
.gw.private-money #week::after, .gw.private-money .pace::after {
  content: ""; visibility: visible; position: absolute; left: 16px; right: 16px; bottom: 12px;
  height: 65%; background: linear-gradient(145deg, transparent, rgba(169,217,249,.12), transparent);
  filter: blur(12px); pointer-events: none;
}

/* ------------------------------------------------ cartões */
.card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; backdrop-filter: blur(16px) saturate(1.2); -webkit-backdrop-filter: blur(16px) saturate(1.2); }

/* ------------------------------------------------ coluna esquerda */
.left { grid-column: 1; grid-row: 2 / 4; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.hero { padding: 6px 0 4px; pointer-events: none; }
.label { margin: 0 0 6px; font-size: clamp(15px, 1.2vw, 23px); color: var(--dim); }
.label b { color: var(--ink); font-weight: 600; }
.odo { display: flex; align-items: baseline; white-space: nowrap; font-size: clamp(74px, 8.7vw, 178px); font-weight: 650; line-height: 1; letter-spacing: -0.035em;
  color: var(--blue); }
.odo .cur { font-size: 0.6em; font-weight: 500; color: #e6edf5; margin-right: 0.07em; transform: translateY(-0.2em); text-shadow: none; }
#odo { display: inline-flex; filter: drop-shadow(0 0 26px rgba(120, 190, 255, 0.3)); }
.d { display: inline-block; height: 1em; overflow: hidden; }
.col { display: flex; flex-direction: column; will-change: transform; }
.col span { display: block; height: 1em; line-height: 1em; text-align: center; }
.d.mid .col { filter: blur(1.2px); }
.d.fast .col { filter: blur(3.5px); }
.sep { display: inline-block; width: 0.17em; }

.kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.kpis .card { padding: 13px 16px 12px; display: flex; flex-direction: column; min-width: 0; }
.kpis span { font-size: 12.5px; color: var(--dim); }
.kpis b { font-size: clamp(27px, 2.35vw, 46px); font-weight: 650; letter-spacing: -0.02em; line-height: 1.12; color: #dcefff; }
.kpis small { font-size: 11.5px; color: var(--faint); min-height: 15px; }
.bump { animation: bump 0.9s ease-out; }
@keyframes bump { 0% { color: #fff; text-shadow: 0 0 22px rgba(160, 215, 255, 0.95); } 100% { text-shadow: 0 0 0 transparent; } }

.week { flex: 1 1 0; min-height: 0; max-height: 168px; padding: 12px 16px 9px; display: flex; flex-direction: column; overflow: hidden; }
.week-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 12.5px; color: var(--dim); }
.week-head b { color: var(--ink); font-weight: 650; font-size: 14px; }
.bars { flex: 1; min-height: 0; display: flex; align-items: flex-end; gap: 7px; padding-top: 8px; }
.bar { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; min-width: 0; }
.bar i { width: 100%; border-radius: 5px 5px 2px 2px; background: rgba(255, 255, 255, 0.16); min-height: 2px; transition: height 0.8s cubic-bezier(0.2, 0.9, 0.2, 1); }
.bar.today i { background: linear-gradient(var(--c, #a9d9f9), color-mix(in srgb, var(--c, #a9d9f9) 35%, transparent)); box-shadow: 0 0 16px color-mix(in srgb, var(--c, #a9d9f9) 45%, transparent); }
.bar span { font-size: 10.5px; color: var(--faint); line-height: 1; }
.bar.today span { color: var(--ink); }
.pace { padding: 14px 16px 10px; display: flex; flex-direction: column; min-height: 0; }
.pace-head { display: flex; align-items: baseline; gap: 10px; font-size: 14px; }
.pace-head b { font-weight: 650; font-size: 15px; }
.pace-head span { color: var(--dim); }
.pace-head span.up strong { color: var(--up); } .pace-head span.down strong { color: var(--down); }
.pace-head strong { font-weight: 650; }
.pace-legend { display: flex; align-items: center; gap: 7px; margin: 6px 0 2px; font-size: 11.5px; color: var(--faint); }
.pace-legend i { display: inline-block; width: 16px; height: 0; border-top: 2px solid #fff; }
.pace-legend i.l-prev { border-top: 2px dotted rgba(255, 255, 255, 0.45); margin-left: 8px; }
#pace { width: 100%; height: clamp(110px, 19vh, 230px); display: block; }

/* ------------------------------------------------ lojas (filtro) */
#chips { grid-column: 2; grid-row: 3; display: flex; flex-wrap: nowrap; justify-content: safe center; gap: 5px; margin: 0 -14px; overflow-x: auto; scrollbar-width: none; }
#chips::-webkit-scrollbar { display: none; }
.chip { flex: none; display: inline-flex; align-items: center; gap: 5px; height: 32px; padding: 0 9px; border-radius: 99px; cursor: pointer; white-space: nowrap;
  border: 1px solid var(--line); background: var(--card); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); font-size: 12px; color: var(--dim);
  transition: border-color 0.25s, background 0.25s, color 0.25s, transform 0.25s; }
.chip:hover { color: var(--ink); transform: translateY(-1px); }
.chip i { width: 7px; height: 7px; border-radius: 50%; background: var(--c, #fff); box-shadow: 0 0 10px var(--c, #fff); }
.chip b { color: var(--ink); font-weight: 650; }
.chip em { font-style: normal; color: var(--faint); font-size: 11px; }
.chip.on { color: var(--ink); border-color: color-mix(in srgb, var(--c, #a9d9f9) 65%, transparent); background: color-mix(in srgb, var(--c, #a9d9f9) 15%, rgba(12, 15, 21, 0.75)); }
.chip.zero { opacity: 0.6; }

/* ------------------------------------------------ encomendas */
.right { grid-column: 3; grid-row: 2 / 4; display: flex; flex-direction: column; min-height: 0; padding: 14px 8px 0; overflow: hidden; }
.orders-head { display: flex; align-items: center; justify-content: space-between; padding: 0 8px 8px; font-size: 14px; }
.orders-head b { font-weight: 650; }
#flags { display: flex; gap: 10px; color: var(--dim); font-size: 12px; }
#flags span { display: inline-flex; align-items: center; gap: 5px; }
.flag { width: 17px; height: 12.75px; border-radius: 2.5px; object-fit: cover; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12); flex: none; }
#orders { list-style: none; margin: 0; padding: 0 0 26px; overflow-y: auto; flex: 1; min-height: 0; scrollbar-width: none;
  -webkit-mask-image: linear-gradient(#000 calc(100% - 70px), transparent); mask-image: linear-gradient(#000 calc(100% - 70px), transparent); }
#orders::-webkit-scrollbar { display: none; }
.row { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; column-gap: 11px; align-items: center; padding: 8px 8px; border-radius: 12px; position: relative; }
.badge { grid-row: 1 / 3; width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center; font-size: 13px; font-weight: 700; color: var(--c);
  background: color-mix(in srgb, var(--c) 18%, #0b0e13); border: 1px solid color-mix(in srgb, var(--c) 42%, transparent); }
.l1 { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 14px; }
.l1 .num { font-weight: 650; flex: none; }
.l1 .where { color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.l1 .ago { color: var(--faint); font-size: 12px; flex: none; }
.l1 .tag { font-size: 10px; letter-spacing: 0.08em; color: var(--gold); border: 1px solid rgba(255, 210, 122, 0.5); border-radius: 5px; padding: 0 5px; flex: none; }
.l2 { grid-column: 2; font-size: 12px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amt { grid-column: 3; grid-row: 1 / 3; font-size: 16px; font-weight: 650; }
.row.fresh { animation: rowIn 0.75s cubic-bezier(0.2, 0.9, 0.2, 1) both, rowGlow 8s ease-out both; }
@keyframes rowIn { 0% { opacity: 0; transform: translateX(34px) scale(0.96); max-height: 0; padding-block: 0; } 55% { max-height: 64px; padding-block: 8px; } 100% { opacity: 1; transform: none; max-height: 64px; } }
@keyframes rowGlow { 0%, 22% { background: rgba(255, 210, 122, 0.2); box-shadow: inset 0 0 0 1px rgba(255, 210, 122, 0.5), 0 0 26px rgba(255, 200, 100, 0.14); } 100% { background: transparent; box-shadow: inset 0 0 0 1px transparent; } }
.row.out { animation: rowOut 0.5s ease-in both; }
@keyframes rowOut { to { opacity: 0; transform: translateX(20px); max-height: 0; padding-block: 0; } }
#empty { margin: auto; padding: 0 24px 60px; text-align: center; color: var(--faint); font-size: 14px; line-height: 1.6; }

/* ------------------------------------------------ "+€128" no globo */
.pop { position: absolute; left: 0; top: 0; text-align: center; white-space: nowrap; opacity: 0; will-change: transform, opacity; }
.pop b { display: block; font-size: clamp(24px, 2.4vw, 46px); font-weight: 700; letter-spacing: -0.02em; line-height: 1.05; color: #fff;
  text-shadow: 0 0 22px var(--c), 0 0 6px var(--c), 0 2px 12px #000; }
.pop span { display: inline-block; margin-top: 5px; font-size: 12.5px; color: #dbe4ee; padding: 3px 10px; border-radius: 99px; background: rgba(8, 10, 14, 0.72);
  border: 1px solid color-mix(in srgb, var(--c) 55%, transparent); }
.pop.test span::before { content: "ENSAIO · "; color: var(--gold); letter-spacing: 0.06em; }

/* ------------------------------------------------ marco */
#banner { position: fixed; z-index: 5; left: 50%; top: 84px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 12px 30px 14px; border-radius: 18px; text-align: center; pointer-events: none; background: rgba(14, 12, 6, 0.78); border: 1px solid rgba(255, 210, 122, 0.55);
  box-shadow: 0 0 60px rgba(255, 200, 100, 0.22); backdrop-filter: blur(12px); animation: bannerIn 5.2s cubic-bezier(0.2, 0.9, 0.2, 1) both; }
#banner small { font-size: 11px; letter-spacing: 0.22em; color: var(--gold); }
#banner b { font-size: clamp(22px, 2.2vw, 36px); font-weight: 650; letter-spacing: -0.01em; }
@keyframes bannerIn { 0% { opacity: 0; transform: translate(-50%, -24px) scale(0.9); } 9% { opacity: 1; transform: translate(-50%, 0) scale(1.04); } 14% { transform: translate(-50%, 0) scale(1); } 86% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; transform: translate(-50%, -14px); } }

/* ------------------------------------------------ modo leve: 3D sem placa gráfica (tudo desenhado no processador) */
.gw.lite .card, .gw.lite .chip, .gw.lite #banner { backdrop-filter: none; -webkit-backdrop-filter: none; }
.gw.lite .card, .gw.lite .chip { background: rgba(11, 14, 19, 0.88); }
.gw.lite #odo { filter: none; }

/* ------------------------------------------------ ecrãs mais baixos */
@media (min-width: 1021px) and (max-height: 900px) { .week { display: none; } .pace { margin-top: auto; } }
@media (min-width: 1021px) and (max-height: 820px) {
  .kpis b { font-size: clamp(24px, 2vw, 36px); }
  .odo { font-size: clamp(64px, 7.6vw, 140px); }
  #pace { height: clamp(90px, 15vh, 160px); }
  .kpis .card { padding: 10px 14px 9px; }
}

/* ------------------------------------------------ telemóvel e janelas estreitas */
@media (max-width: 1020px) {
  .gw { overflow: auto; overflow-x: hidden; }
  #app { display: flex; flex-direction: column; height: auto; min-height: 100dvh; padding: 14px 16px 28px; padding-top: max(14px, env(safe-area-inset-top)); gap: 12px; }
  .left { display: contents; }
  header { order: 0; }
  .hero { order: 1; padding-top: 2px; }
  #slot { order: 2; height: min(96vw, 58vh); margin: -6px 0; }
  #chips { order: 3; }
  .kpis { order: 4; }
  .right { order: 5; max-height: 62vh; min-height: 220px; }
  .pace { order: 6; margin-top: 0; }
  .week { order: 7; flex: none; height: 150px; max-height: none; }
  .odo { font-size: clamp(66px, 21vw, 150px); }
  #pace { height: 170px; }
  #clock { display: none; }
  #banner { top: 64px; width: max-content; max-width: 92vw; }
  .brand { font-size: 13px; letter-spacing: 0.2em; }
}
@media (prefers-reduced-motion: reduce) { .row.fresh { animation: rowGlow 8s ease-out both; } .pill.on i { animation: none; } }
@media (max-width: 520px) {
  #btn-full { display: none; }
  .top { gap: 6px; }
  .brand { font-size: 12px; letter-spacing: 0.14em; gap: 8px; }
  .brand svg { width: 26px; }
  .pill { padding: 0 10px; }
}

/* ------------------------------------------------ RevFlow */
.chip .n { max-width: 16ch; overflow: hidden; text-overflow: ellipsis; }
.odo.after .cur { order: 2; margin: 0 0 0 0.12em; }
#btn-names .slash { display: none; }
#btn-names.active { color: var(--blue); }
#btn-names.all { color: var(--gold); }
#btn-names:not(.active) .slash { display: initial; }
/* repetir um dia: o menu do botão de repetição */
#days { position: fixed; z-index: 6; top: 66px; right: 28px; width: min(326px, calc(100vw - 32px)); padding: 13px 8px 8px; display: flex; flex-direction: column;
  background: rgba(12, 15, 21, 0.92); box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55); animation: daysIn 0.18s ease-out both; }
@keyframes daysIn { from { opacity: 0; transform: translateY(-6px); } }
.days-title { padding: 0 8px 8px; font-size: 14px; font-weight: 650; }
#day-list { display: flex; flex-direction: column; }
.day { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(66px, auto); align-items: baseline; column-gap: 10px; width: 100%; padding: 8px; border: 0; border-radius: 10px;
  background: transparent; text-align: left; font-size: 13.5px; cursor: pointer; transition: background 0.2s; }
.day:hover:enabled, .day:focus-visible { background: rgba(255, 255, 255, 0.07); outline: none; }
.day span:first-child::first-letter { text-transform: uppercase; }
.day em { font-style: normal; font-size: 12px; color: var(--faint); }
.day b { font-weight: 650; text-align: right; }
.day:disabled { opacity: 0.38; cursor: default; }
.day.on { background: color-mix(in srgb, var(--gold) 14%, transparent); }
.day.back { color: var(--gold); margin-bottom: 4px; grid-template-columns: minmax(0, 1fr) auto; }
.day-other { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 6px; padding: 10px 8px 4px; border-top: 1px solid var(--line); font-size: 13.5px; color: var(--dim); }
#day-pick { color-scheme: dark; font: inherit; font-size: 13px; color: var(--ink); background: rgba(255, 255, 255, 0.06); border: 1px solid var(--line); border-radius: 9px; padding: 5px 8px; }
#btn-replay.waiting { color: var(--gold); animation: nudge 1.1s ease-in-out infinite; }
.week .bar { cursor: pointer; }
.week .bar:hover i { background: rgba(255, 255, 255, 0.3); }
.week .bar.today:hover i { filter: brightness(1.25); }
.gw.lite #days { background: rgba(11, 14, 19, 0.96); }
@media (max-width: 1020px) { #days { top: 58px; right: 16px; } }
#notice { position: fixed; z-index: 6; left: 50%; bottom: 26px; transform: translateX(-50%); margin: 0; padding: 9px 16px; border-radius: 12px; font-size: 13px;
  color: var(--ink); background: rgba(40, 14, 14, 0.86); border: 1px solid rgba(255, 156, 147, 0.45); }
a:focus-visible, button:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
@media (max-width: 1020px) { .brand em { display: none; } #chips { justify-content: flex-start; margin: 0; } }
`;
