// The live globe's own document. It is rendered inside a shadow root (see controller.js), so these
// ids and class names cannot collide with the app's, and the app's styles cannot leak in.
export const MARKUP = /* html */ `
<div class="gw">
  <canvas id="gl" aria-hidden="true"></canvas>
  <div id="fx" aria-hidden="true"></div>

  <div id="app">
    <header>
      <a class="brand" href="/dashboard" title="Voltar ao dashboard">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15.5c2.2 0 3.4-2 5-4.5s2.9-4.5 5.5-4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="18.4" cy="6.5" r="2.3" fill="#ffd27a"/></svg>
        <span>REVFLOW</span><em>Globo ao vivo</em>
      </a>
      <div class="top">
        <span id="live" class="pill off"><i></i><b>A LIGAR</b></span>
        <span id="clock">--:--:--</span>
        <button id="btn-names" class="ib" type="button" title="Esconder ou mostrar as lojas, os números e os países (N)" aria-label="Esconder ou mostrar as lojas, os números e os países">
          <svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" stroke-width="2"/><path class="slash" d="m4 4 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        <button id="btn-replay" class="ib" type="button" title="Repetir um dia em acelerado (D escolhe o dia, R repete o de hoje)" aria-label="Repetir um dia" aria-haspopup="dialog" aria-expanded="false">
          <svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.6-5.9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 4v4.5h4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="m10.5 9 5 3-5 3Z" fill="currentColor"/></svg>
        </button>
        <button id="btn-sound" class="ib" type="button" title="Som (S)" aria-label="Som">
          <svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5Z" fill="currentColor"/><path class="on" d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path class="mute" d="m16 9.5 5 5m0-5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        <button id="btn-full" class="ib" type="button" title="Ecrã inteiro (F)" aria-label="Ecrã inteiro">
          <svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </header>

    <section class="left">
      <div class="hero">
        <p class="label">Faturação, <b id="hero-store">Todas as lojas</b> <span id="hero-day">hoje</span></p>
        <div class="odo" aria-live="off"><span class="cur" id="cur"></span><span id="odo"></span></div>
      </div>
      <div class="kpis">
        <div class="card"><span>Encomendas</span><b id="k-orders">0</b></div>
        <div class="card"><span>ROAS</span><b id="k-roas">–</b></div>
        <div class="card"><span>Gasto em anúncios</span><b id="k-ads">0</b><small id="k-ads-sub">&nbsp;</small></div>
        <div class="card"><span>Ticket médio</span><b id="k-aov">–</b><small id="k-last">&nbsp;</small></div>
      </div>
      <div class="card week">
        <div class="week-head"><b>Últimos 7 dias</b><span id="week-avg"></span></div>
        <div id="week" class="bars"></div>
      </div>
      <div class="card pace">
        <div class="pace-head"><b>Ritmo</b><span id="pace-pct">–</span></div>
        <div class="pace-legend"><i class="l-today"></i><span id="pace-today">hoje</span><i class="l-prev"></i><span id="pace-prev">ontem</span></div>
        <canvas id="pace"></canvas>
      </div>
    </section>

    <div id="slot"></div>

    <nav id="chips" aria-label="Lojas"></nav>

    <section class="right card">
      <div class="orders-head"><b>Encomendas</b><span id="flags"></span></div>
      <ul id="orders"></ul>
      <p id="empty" hidden>Ainda sem encomendas hoje.<br>Assim que entrar uma, cai aqui.</p>
    </section>
  </div>

  <div id="days" class="card" role="dialog" aria-label="Repetir um dia" hidden>
    <b class="days-title">Repetir um dia</b>
    <button id="day-live" class="day back" type="button" hidden><span>Voltar ao direto</span><em>Esc</em></button>
    <div id="day-list"></div>
    <label class="day-other"><span>Outro dia</span><input id="day-pick" type="date" min="2015-01-01"></label>
  </div>

  <div id="banner" hidden><small></small><b></b></div>
  <p id="notice" hidden></p>
</div>`;
