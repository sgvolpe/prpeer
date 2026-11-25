// Light/dark theme and the user's own CSS: stored in localStorage and applied on every page.
(() => {
  const K = 'prpeer-css', TK = 'prpeer-theme', R = document.documentElement;
  const rd = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const wr = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  // usage stats for the home footer, every page: time with the tab visible and page opens per day. shortcut: only this browser, move to the server for cross-device stats
  { let d = {}; try { d = JSON.parse(rd('prpeer-days') || '{}'); } catch {} const day = new Date().toISOString().slice(0, 10); d[day] = (d[day] || 0) + 1; wr('prpeer-days', JSON.stringify(d));
    setInterval(() => { if (!document.hidden) wr('prpeer-time', String((Number(rd('prpeer-time')) || 0) + 30)); }, 30000); }
  // light: its own palette lives in ui.css (:root[data-theme=light]); nothing is inverted any more.
  const LIGHT = '';
  // POLISH: additive visual touch-ups (see UI-CAMBIOS.md); to undo, empty this constant.
  const POLISH = 'html{-webkit-font-smoothing:antialiased;color-scheme:dark}:root[data-theme=light]{color-scheme:light}' +
    ':focus-visible{outline:2px solid var(--lnk,#4aa3ff);outline-offset:2px}' +
    'button,.tab,.go,.row,select,input{transition:background-color .15s,border-color .15s,color .15s,opacity .15s}' +
    'button:not(:disabled):hover,.tab:hover{border-color:var(--lnk,#4aa3ff);filter:brightness(1.15)}' +
    'button:active:not(:disabled){transform:translateY(1px)}' +
    'input:focus,select:focus,textarea:focus{border-color:var(--lnk,#4aa3ff)!important;outline:none}' +
    '::selection{background:#4aa3ff55}' +
    '*{scrollbar-width:thin;scrollbar-color:#3a4658 transparent}' +
    '@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}';
  R.dataset.theme = rd(TK) || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  // shortcut: copy of the :root variables from home.html/index.html, keep in sync if they change there.
  const DEF = ':root{\n  --bg:#0f1115;\n  --pan:#161a21;\n  --bd:#262c36;\n  --tx:#d7dce4;\n  --mut:#7d8796;\n  --chg:#f0a030;\n  --lnk:#4aa3ff;\n  --add:#3fb950;\n  --del:#f85149\n}\n';
  const st = document.createElement('style');
  const css = v => st.textContent = LIGHT + POLISH + v;
  css(rd(K));
  document.head.append(st);
  // theme, language and CSS are edited in the ⚙ Ajustes menu (settings.js) through this
  globalThis.prpeerTheme = { DEF, get css() { return rd(K); }, set css(v) { css(v); wr(K, v); },
    get theme() { return R.dataset.theme; }, set theme(v) { R.dataset.theme = v; wr(TK, v); } };
})();
