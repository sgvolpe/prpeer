// ⚙ Ajustes: one settings dialog shared by every page (home, PR map…). Connections, where local repos are read from,
// appearance, local data and usage. Everything from the API or the user's disk is built with textContent, never innerHTML.
// The page opens it with prpeerSettings.open(tab) and may set prpeerSettings.onChange(kind) to refresh itself
// (kind: 'conn' | 'repos' | 'cache').
(() => {
  const $ = s => document.querySelector(s);
  const POST = { method: 'POST', headers: { 'x-prpeer': '1', 'content-type': 'application/json' } };
  async function api(path, opts) {
    const r = await fetch(path, opts), j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'HTTP ' + r.status), { code: j.code });
    return j;
  }
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) k.startsWith('on') ? e[k] = v : k == 'class' ? e.className = v : e.setAttribute(k, v);
    e.append(...kids.flat().filter(x => x != null && x !== false)); return e;
  }
  const note = (cls, ...kids) => h('div', { class: 'note ' + cls }, ...kids);
  const sel = (opts, val, on) => h('select', { onchange: e => on(e.target.value) }, ...opts.map(([v, l]) => h('option', { value: v, ...(v == val ? { selected: '' } : {}) }, l)));
  const S = globalThis.prpeerSettings = { open: openSet, onChange: null };
  const changed = k => { try { S.onChange?.(k); } catch {} };

  const dlg = h('dialog', { id: 'conn' },
    h('div', { class: 'chead' }, h('b', {}, $t('set.title')), h('div', { class: 'tabs', id: 'stabs', role: 'tablist' }),
      h('button', { class: 'tab', title: $t('common.close'), onclick: () => dlg.close() }, '✕')),
    h('div', { id: 'connBody' }));
  document.body.append(dlg);

  // ---- Connections: connect (token/key) or disconnect. Secrets only travel from the field to the server; they never come back.
  const fromLbl = f => ['env', 'gh', 'saved', 'cli'].includes(f) ? $t('conn.from.' + f) : f; // `from` is a server-side code
  async function drawConn(msg) {
    const body = $('#connBody');
    let srcs, llm, ints;
    try { [srcs, llm, ints] = await Promise.all([api('/api/sources'), api('/api/llm'), api('/api/integrations')]); } catch (e) { body.replaceChildren(note('err', e.message)); return; }
    const gh = srcs.find(s => s.id == 'github');
    const call = async (path, target, secret, extra) => { try { await api(path, { ...POST, body: JSON.stringify({ target, secret, ...extra }) }); await drawConn(); changed('conn'); } catch (e) { await drawConn(e.message); } };
    const status = s => s.off ? h('span', { class: 'st off' }, $t('conn.st.off')) : s.ready ? h('span', { class: 'st ok' }, $t('conn.st.ok')) : h('span', { class: 'st' }, $t('conn.st.none'));
    const row = (target, label, s, placeholder) => {
      const inp = placeholder ? h('input', { type: 'password', placeholder, autocomplete: 'off', spellcheck: 'false' }) : null;
      const acts = [];
      if (inp) acts.push(inp, h('button', { class: 'go', onclick: () => inp.value.trim() && call('/api/connect', target, inp.value.trim()) }, $t('conn.connect')));
      if (s.off) acts.push(h('button', { class: 'tab', onclick: () => call('/api/connect', target) }, $t('conn.reactivate')));
      else if (s.ready) acts.push(h('button', { class: 'tab', onclick: () => call('/api/disconnect', target) }, $t('conn.disconnect')));
      return h('div', { class: 'cn' }, h('div', { class: 'top' }, h('b', {}, label), status(s)),
        h('div', { class: 'mut' }, s.from ? $t(s.off ? 'conn.wouldUse' : 'conn.uses2', { x: fromLbl(s.from) }) : (s.ready && s.needsKey ? $t('conn.noKey') : s.hint || '')),
        acts.length ? h('div', { class: 'acts' }, ...acts) : null);
    };
    // integrations with several fields (Jira: site, email and token); sent together and the token never comes back
    const irow = it => {
      const ins = it.fields.map(f => h('input', { type: f.secret ? 'password' : 'text', placeholder: f.ph, autocomplete: 'off', spellcheck: 'false', 'data-k': f.k }));
      const val = k => ins.find(i => i.dataset.k == k).value.trim();
      const acts = [...ins, h('button', { class: 'go', onclick: () => call('/api/connect', it.id, val('secret'), { url: val('url'), email: val('email') }) }, $t('conn.connect'))];
      if (it.off) acts.push(h('button', { class: 'tab', onclick: () => call('/api/connect', it.id) }, $t('conn.reactivate')));
      else if (it.ready) acts.push(h('button', { class: 'tab', onclick: () => call('/api/disconnect', it.id) }, $t('conn.disconnect')));
      return h('div', { class: 'cn' }, h('div', { class: 'top' }, h('b', {}, it.label), status(it)), h('div', { class: 'mut' }, it.from ? $t(it.off ? 'conn.wouldUse' : 'conn.uses2', { x: fromLbl(it.from) }) : it.hint || ''), h('div', { class: 'acts', style: 'flex-wrap:wrap' }, ...acts));
    };
    body.replaceChildren(...[
      msg ? note('err', msg) : null,
      row('github', 'GitHub', gh, $t('conn.ghPh')),
      ...ints.map(irow),
      ...llm.providers.map(p => row('p:' + p.id, p.label, p, p.needsKey ? $t('conn.keyPh') : null)),
      h('details', { class: 'note mut' }, h('summary', {}, $t('conn.guide.title')), ...['github', 'jira', 'anthropic', 'cli', 'other'].map(k => h('p', {}, $t('conn.guide.' + k)))),
      h('div', { class: 'note mut' }, $t('conn.note'))].filter(Boolean));
  }

  const SET_TABS = ['conn', 'ai', 'repos', 'look', 'data', 'usage'];
  let setTab = 'conn';
  const fmtBytes = b => b < 1e6 ? Math.round(b / 1e3) + ' KB' : b < 1e9 ? (b / 1e6).toFixed(1) + ' MB' : (b / 1e9).toFixed(2) + ' GB';
  const field = (label, hint, ...ctl) => h('div', { class: 'cn' }, h('div', { class: 'top' }, h('b', {}, label)), hint ? h('div', { class: 'mut' }, hint) : null, h('div', { class: 'acts', style: 'flex-wrap:wrap' }, ...ctl));
  function drawSetTabs() {
    $('#stabs').replaceChildren(...SET_TABS.map(k => h('button', { class: 'tab' + (setTab == k ? ' on' : ''), role: 'tab', 'aria-selected': String(setTab == k), onclick: () => openSet(k) }, $t('set.tab.' + k))));
  }
  function openSet(k) {
    setTab = SET_TABS.includes(k) ? k : setTab; drawSetTabs();
    history.replaceState(null, '', '#ajustes-' + setTab); // bookmarkable: a refresh reopens this tab
    $('#connBody').replaceChildren(note('mut', $t('common.loading')));
    if (!dlg.open) dlg.showModal();
    ({ conn: drawConn, ai: drawAI, repos: drawRepoDirs, look: drawLook, data: drawData, usage: drawUsage })[setTab]();
  }
  const saveSet = async (patch, redraw) => { try { await api('/api/settings', { ...POST, body: JSON.stringify(patch) }); await redraw(); changed('repos'); } catch (e) { await redraw(e.message); } };

  // ---- IA: provider, model and effort for the assistant. Kept in this browser (localStorage prpeer:llm); default effort: low.
  async function drawAI() {
    const body = $('#connBody'); let L;
    try { L = await api('/api/llm'); } catch (e) { body.replaceChildren(note('err', $t('llm.unavailable', { msg: e.message }))); return; }
    let c = {}; try { c = JSON.parse(localStorage['prpeer:llm'] || '{}'); } catch {}
    const p = L.providers.find(x => x.id == c.provider) || L.providers[0];
    const defModel = q => (L.default.provider == q.id && L.default.model) || q.models[0] || '';
    const defEffort = q => q.efforts.includes('low') ? 'low' : '';
    c = { provider: p.id, model: c.model || defModel(p), effort: c.effort ?? defEffort(p) };
    const save = patch => { Object.assign(c, patch); try { localStorage['prpeer:llm'] = JSON.stringify(c); } catch {} changed('llm'); drawAI(); };
    body.replaceChildren(...[
      field($t('llm.provider'), null, sel(L.providers.map(x => [x.id, x.label]), p.id, v => { const q = L.providers.find(x => x.id == v); save({ provider: v, model: defModel(q), effort: defEffort(q) }); })),
      field($t('llm.model'), $t('llm.modelTip'), h('input', { list: 'setmodels', value: c.model, placeholder: $t('llm.model'), spellcheck: 'false', onchange: e => save({ model: e.target.value.trim() }) }), h('datalist', { id: 'setmodels' }, ...p.models.map(m => h('option', { value: m })))),
      field($t('llm.effort'), null, sel([['', $t('llm.effortAuto')], ...p.efforts.map(e => [e, e])], c.effort, v => save({ effort: v }))),
      p.keyEnv || !p.ready ? note('err', $t('llm.unset', { k: p.keyEnv || $t('llm.key') }) + (p.type == 'anthropic' ? $t('llm.antProfile') : '')) : null].filter(Boolean));
  }

  async function drawRepoDirs(msg) {
    const body = $('#connBody'); let s;
    try { s = await api('/api/settings'); } catch (e) { body.replaceChildren(note('err', e.message)); return; }
    const dirs = s.repoDirs.map(d => d.dir);
    const add = h('input', { placeholder: $t('set.repos.addPh'), spellcheck: 'false', onkeydown: e => { if (e.key == 'Enter') addBtn.click(); } });
    const addBtn = h('button', { class: 'go', onclick: () => { const v = add.value.trim(); if (v && !dirs.includes(v)) saveSet({ repoDirs: [...dirs, v] }, drawRepoDirs); } }, $t('set.repos.add'));
    body.replaceChildren(...[
      msg ? note('err', msg) : null,
      h('div', { class: 'note mut' }, $t(s.custom ? 'set.repos.custom' : s.fromConfig ? 'set.repos.fromConfig' : 'set.repos.default'), ' ', $t('set.repos.found', { n: s.found })),
      ...s.repoDirs.map(d => h('div', { class: 'cn' }, h('div', { class: 'top' }, h('code', {}, d.dir),
        h('span', { class: 'st' + (d.exists ? (d.repos ? ' ok' : '') : ' off') }, d.exists ? $t('set.repos.n', { n: d.repos }) : $t('set.repos.missing')),
        h('button', { class: 'tab', title: $t('common.remove'), onclick: () => saveSet({ repoDirs: dirs.filter(x => x != d.dir) }, drawRepoDirs) }, '✕')))),
      h('div', { class: 'cn' }, h('div', { class: 'acts' }, add, addBtn), h('div', { class: 'mut', style: 'margin-top:6px' }, $t('set.repos.addHint'))),
      s.custom ? h('div', { class: 'cn' }, h('button', { class: 'tab', onclick: () => saveSet({ repoDirs: null }, drawRepoDirs) }, $t('set.repos.reset'))) : null].filter(Boolean));
  }

  function drawLook() {
    const T = globalThis.prpeerTheme, body = $('#connBody');
    const ta = h('textarea', { spellcheck: 'false', placeholder: ':root{ --bg:#111 }', style: 'width:100%;height:220px;font:12px ui-monospace,Consolas,monospace;background:#090909;color:var(--tx);border:1px solid var(--bd);border-radius:8px;padding:8px' });
    ta.value = T ? T.css || T.DEF : ''; ta.oninput = () => { if (T) T.css = ta.value; };
    body.replaceChildren(
      field($t('set.look.theme'), null, sel([['dark', $t('set.look.dark')], ['light', $t('set.look.light')]], T ? T.theme : 'dark', v => { if (T) T.theme = v; })),
      field($t('set.look.lang'), $t('set.look.langHint'), sel(i18n.langs.map(l => [l, l == 'es' ? 'Español' : 'English']), i18n.lang, v => i18n.setLang(v))),
      h('div', { class: 'cn' }, h('div', { class: 'top' }, h('b', {}, $t('theme.css'))), h('div', { class: 'mut', style: 'margin-bottom:8px' }, $t('set.look.cssHint')), ta,
        h('div', { class: 'acts' }, h('button', { class: 'tab', onclick: () => { if (T) T.css = ''; ta.value = T ? T.DEF : ''; } }, $t('set.look.cssReset')))));
  }

  async function drawData(msg, info) {
    const body = $('#connBody'); let s;
    try { s = await api('/api/settings'); } catch (e) { body.replaceChildren(note('err', e.message)); return; }
    const num = (k, [lo, hi]) => {
      const i = h('input', { type: 'number', min: lo, max: hi, step: 1, value: s[k], style: 'flex:0 0 110px' });
      return [i, h('button', { class: 'go', onclick: () => { const v = Number(i.value); if (Number.isInteger(v) && v >= lo && v <= hi) saveSet({ [k]: v }, drawData); else drawData($t('set.data.range', { lo, hi })); } }, $t('set.save'))];
    };
    const total = s.cache.reduce((a, c) => a + c.bytes, 0);
    const clear = async repo => {
      if (!confirm(repo ? $t('set.data.confirmOne', { repo }) : $t('set.data.confirmAll', { n: s.cache.length, size: fmtBytes(total) }))) return;
      try { const r = await api('/api/cache/clear', { ...POST, body: JSON.stringify(repo ? { repo } : {}) }); await drawData(null, $t('set.data.cleared', { n: r.removed }) + (r.kept ? ' ' + $t('set.data.kept', { n: r.kept }) : '')); changed('cache'); }
      catch (e) { drawData(e.message); }
    };
    const prefKeys = () => { try { return Object.keys(localStorage).filter(k => /^prpeer[:-]/.test(k)); } catch { return []; } };
    body.replaceChildren(...[
      msg ? note('err', msg) : null,
      info ? note('mut', info) : null,
      field($t('set.data.sessions'), $t('set.data.sessionsHint', { n: s.sessions }), ...num('maxSessions', s.limits.maxSessions)),
      field($t('set.data.graph'), $t('set.data.graphHint'), ...num('graphLimit', s.limits.graphLimit)),
      h('div', { class: 'cn' }, h('div', { class: 'top' }, h('b', {}, $t('set.data.cache')), h('span', { class: 'st' }, fmtBytes(total))),
        h('div', { class: 'mut' }, $t('set.data.cacheHint'), ' ', h('code', {}, s.cacheDir)),
        ...s.cache.map(c => h('div', { class: 'acts' }, h('span', { style: 'flex:1' }, c.id), h('small', { class: 'mut' }, fmtBytes(c.bytes)),
          c.inUse ? h('span', { class: 'st off', title: $t('set.data.inUseTip') }, $t('set.data.inUse')) : h('button', { class: 'tab', onclick: () => clear(c.id) }, $t('set.data.delete')))),
        s.cache.length ? h('div', { class: 'acts' }, h('button', { class: 'tab', onclick: () => clear() }, $t('set.data.deleteAll'))) : h('div', { class: 'mut', style: 'margin-top:6px' }, $t('set.data.empty'))),
      h('div', { class: 'cn' }, h('div', { class: 'top' }, h('b', {}, $t('set.data.prefs'))), h('div', { class: 'mut' }, $t('set.data.prefsHint')),
        h('div', { class: 'acts' }, h('button', { class: 'tab', onclick: () => { const ks = prefKeys(); if (!ks.length || !confirm($t('set.data.prefsConfirm', { n: ks.length }))) return; for (const k of ks) try { localStorage.removeItem(k); } catch {} location.reload(); } }, $t('set.data.prefsClear', { n: prefKeys().length }))))].filter(Boolean));
  }

  const fmtTok = n => n < 1e3 ? String(n) : n < 1e6 ? (n / 1e3).toFixed(1) + 'k' : (n / 1e6).toFixed(2) + 'M', fmtUsd = c => '$' + (c < 0.01 && c > 0 ? c.toFixed(4) : c.toFixed(2));
  async function drawUsage() {
    const body = $('#connBody'); let u;
    try { u = await api('/api/usage'); } catch (e) { body.replaceChildren(note('err', e.message)); return; }
    if (!u.total.n) { body.replaceChildren(note('mut', $t('usage.empty'))); return; }
    const prName = new Map(u.prs.map(p => [p.pr, p.title]));
    const seg = (key, opts) => h('div', { class: 'stp' }, ...opts.map(([v, l]) => h('button', { class: uf[key] == v ? 'on' : '', onclick: () => { uf[key] = v; draw(); } }, l)));
    const pick = (key, label, vals, name = v => v) => sel([['', label], ...[...new Set(vals)].sort().map(v => [v, name(v)])], uf[key], v => { uf[key] = v; draw(); });
    // free-text filter: matches date, PR, task, model or provider; one input kept across redraws so typing keeps focus
    const qIn = h('input', { type: 'search', placeholder: $t('usage.f.search'), 'aria-label': $t('usage.f.search'), value: uf.q, style: 'flex:1 1 160px', oninput: () => { uf.q = qIn.value; const c = qIn.selectionStart; draw(); qIn.focus(); qIn.setSelectionRange(c, c); } });
    const draw = () => {
      const words = uf.q.toLowerCase().split(/s+/).filter(Boolean), hay = r => [new Date(r.ts).toLocaleString(), r.pr, prName.get(r.pr) || r.title, r.task, r.model, r.provider].join(' ').toLowerCase();
      const since = uf.days ? Date.now() - uf.days * 864e5 : 0;
      const rs = u.recent.filter(r => Date.parse(r.ts) >= since && (!uf.pr || r.pr == uf.pr) && (!uf.model || r.model == uf.model) && (!uf.task || r.task == uf.task) && (!uf.q || words.every(w => hay(r).includes(w))));
      const tin = r => r.in + r.cr + r.cw;
      const T = { n: rs.length, in: rs.reduce((a, r) => a + tin(r), 0), out: rs.reduce((a, r) => a + r.out, 0), cost: rs.reduce((a, r) => a + (r.cost ?? 0), 0), unpriced: rs.filter(r => r.cost == null).length };
      // chart: ponytail-gain style block bars (█ filled, · track), grouped by the chosen dimension, longest = 100%
      const keyOf = { day: r => r.ts.slice(0, 10), model: r => r.model, task: r => r.task, pr: r => prName.get(r.pr) || r.pr }[uf.by];
      const groups = new Map();
      for (const r of rs) { const k = keyOf(r), g = groups.get(k) || { cost: 0, tok: 0 }; g.cost += r.cost ?? 0; g.tok += tin(r) + r.out; groups.set(k, g); }
      const byCost = T.cost > 0, val = g => byCost ? g.cost : g.tok;
      const bars = [...groups].sort((a, b) => uf.by == 'day' ? b[0].localeCompare(a[0]) : val(b[1]) - val(a[1])).slice(0, 14);
      const max = Math.max(...bars.map(([, g]) => val(g)), 1e-9), W = 24;
      const chart = h('pre', { class: 'ubars' }, ...bars.map(([k, g]) => { const n = Math.max(val(g) > 0 ? 1 : 0, Math.round(val(g) / max * W));
        return h('div', { title: k }, h('span', { class: 'k' }, k), h('span', { class: 'b' }, '█'.repeat(n)), h('span', { class: 't' }, '·'.repeat(W - n)), h('span', { class: 'v' }, byCost ? fmtUsd(g.cost) : fmtTok(g.tok) + ' tok')); }));
      // history: one point per calendar day from the first filtered request (at least 7 days back, so one day still draws a line) to today, empty days at 0
      const days = [], week = Date.parse(new Date().toISOString().slice(0, 10)) - 6 * 864e5;
      if (rs.length) for (let d = new Date(Math.min(week, Date.parse(rs.reduce((a, r) => r.ts < a ? r.ts : a, rs[0].ts).slice(0, 10)))); d <= new Date(); d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
      // history: one line per series (total, or split by task / repo / model; top 6 + "others"), drag to zoom, double-click to reset
      const line = () => {
        const fmtV = v => byCost ? fmtUsd(v) : fmtTok(v) + ' tok', vOf = r => byCost ? r.cost ?? 0 : tin(r) + r.out;
        const keyS = { task: r => r.task, repo: r => r.pr.split('#')[0], model: r => r.model }[uf.split] || (() => $t('usage.total'));
        const tot = new Map(); for (const r of rs) tot.set(keyS(r), (tot.get(keyS(r)) || 0) + vOf(r));
        const ranked = [...tot].sort((a, b) => b[1] - a[1]).map(e => e[0]), keep = new Set(ranked.slice(0, 6)), other = $t('usage.other');
        const names = ranked.length > 6 ? [...keep, other] : ranked, nameOf = r => keep.has(keyS(r)) ? keyS(r) : other;
        const data = new Map(names.map(n => [n, new Map()]));
        for (const r of rs) { const m = data.get(nameOf(r)), d = r.ts.slice(0, 10); m.set(d, (m.get(d) || 0) + vOf(r)); }
        let vis = uf.zoom ? days.filter(d => d >= uf.zoom[0] && d <= uf.zoom[1]) : days;
        if (vis.length < 2) { uf.zoom = null; vis = days; }
        const hid = n => uf.hide.has(uf.split + ':' + n), shown = names.filter(n => !hid(n)), col = n => COLORS[names.indexOf(n) % COLORS.length];
        const top = Math.max(1e-9, ...shown.flatMap(n => vis.map(d => data.get(n).get(d) || 0)));
        const VW = 640, VH = 190, L = 52, R = 8, T = 8, B = 22;
        const x = i => L + (vis.length < 2 ? (VW - L - R) / 2 : i * (VW - L - R) / (vis.length - 1)), y = v => VH - B - v / top * (VH - B - T);
        const NS = 'http://www.w3.org/2000/svg', s = (tag, a, txt) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; return e; };
        const svg = s('svg', { viewBox: `0 0 ${VW} ${VH}`, class: 'uline', role: 'img', 'aria-label': $t('usage.history') });
        for (const f of [0, 0.5, 1]) svg.append(s('line', { x1: L, x2: VW - R, y1: y(top * f), y2: y(top * f), class: 'g' }), s('text', { x: L - 6, y: y(top * f) + 4, class: 'ax', 'text-anchor': 'end' }, fmtV(top * f)));
        for (const i of [0, Math.floor((vis.length - 1) / 2), vis.length - 1]) svg.append(s('text', { x: x(i), y: VH - 6, class: 'ax', 'text-anchor': i == 0 ? 'start' : i == vis.length - 1 ? 'end' : 'middle' }, vis[i].slice(5)));
        for (const n of shown) {
          const pts = vis.map((d, i) => x(i).toFixed(1) + ',' + y(data.get(n).get(d) || 0).toFixed(1)).join(' ');
          if (shown.length == 1) svg.append(s('polygon', { points: `${x(0)},${y(0)} ${pts} ${x(vis.length - 1)},${y(0)}`, class: 'a', style: `fill:${col(n)}` }));
          svg.append(s('polyline', { points: pts, class: 'l', style: `stroke:${col(n)}` }));
          if (vis.length <= 45) vis.forEach((d, i) => { const v = data.get(n).get(d); if (v) svg.append(s('circle', { cx: x(i), cy: y(v), r: 3, class: 'pt', style: `fill:${col(n)}` })); });
        }
        const cross = s('line', { y1: T, y2: VH - B, class: 'cx', visibility: 'hidden' }), brush = s('rect', { y: T, height: VH - B - T, class: 'br', visibility: 'hidden' });
        svg.append(cross, brush);
        const tip = h('div', { class: 'utip', hidden: '' }), wrap = h('div', { class: 'uwrap' }, svg, tip);
        const vbX = e => { const b = svg.getBoundingClientRect(); return Math.min(VW - R, Math.max(L, (e.clientX - b.left) / b.width * VW)); };
        const idx = vx => Math.round((vx - L) / (VW - L - R) * (vis.length - 1));
        let x0 = null;
        svg.onpointerdown = e => { x0 = vbX(e); svg.setPointerCapture(e.pointerId); };
        svg.onpointermove = e => {
          const vx = vbX(e), i = idx(vx);
          if (x0 != null) { brush.setAttribute('x', Math.min(x0, vx)); brush.setAttribute('width', Math.abs(vx - x0)); brush.setAttribute('visibility', 'visible'); }
          cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
          tip.replaceChildren(h('b', {}, vis[i]), ...shown.map(n => h('div', {}, h('i', { style: `background:${col(n)}` }), n + '  ', h('span', {}, fmtV(data.get(n).get(vis[i]) || 0)))));
          tip.hidden = false; const left = x(i) / VW * 100; tip.style.left = left > 60 ? '' : left + 2 + '%'; tip.style.right = left > 60 ? (100 - left) + 2 + '%' : '';
        };
        svg.onpointerup = e => {
          const vx = vbX(e), a = idx(Math.min(x0, vx)), b = idx(Math.max(x0, vx)); x0 = null; brush.setAttribute('visibility', 'hidden');
          if (b - a >= 1) { uf.zoom = [vis[a], vis[b]]; draw(); }
        };
        svg.onpointerleave = () => { if (x0 == null) { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; } };
        svg.ondblclick = () => { uf.zoom = null; draw(); };
        const legend = names.length > 1 ? h('div', { class: 'uleg' }, ...names.map(n => h('button', { class: hid(n) ? 'off' : '', title: fmtV(tot.get(n) ?? [...tot].filter(([k]) => !keep.has(k)).reduce((a, e) => a + e[1], 0)),
          onclick: () => { const k = uf.split + ':' + n; uf.hide.has(k) ? uf.hide.delete(k) : uf.hide.add(k); draw(); } }, h('i', { style: `background:${col(n)}` }), n))) : null;
        return h('div', { class: 'cn' },
          h('div', { class: 'top' }, h('b', {}, $t('usage.history')),
            uf.zoom ? h('button', { class: 'tab', onclick: () => { uf.zoom = null; draw(); } }, $t('usage.zoomReset')) : null,
            seg('split', [['', $t('usage.split.none')], ['task', $t('usage.by.task')], ['repo', 'Repo'], ['model', $t('usage.by.model')]])),
          wrap, legend, h('div', { class: 'mut', style: 'font-size:11px;margin-top:6px' }, $t('usage.zoomHint')));
      };
      const td = (x, cls) => h('td', cls ? { class: cls } : {}, x);
      const LIM = 200;
      body.replaceChildren(
        h('div', { class: 'cn ufil' },
          seg('days', [[7, '7d'], [30, '30d'], [90, '90d'], [0, $t('usage.f.all')]]),
          pick('pr', $t('usage.f.pr'), u.recent.map(r => r.pr), v => prName.get(v) || v),
          pick('model', $t('usage.f.model'), u.recent.map(r => r.model)),
          pick('task', $t('usage.f.task'), u.recent.map(r => r.task)), qIn),
        h('div', { class: 'cn' }, h('div', { class: 'top' }, h('b', {}, $t('usage.total')), h('span', { class: 'st ok' }, fmtUsd(T.cost))),
          h('div', { class: 'mut' }, $t('usage.totalHint', { n: T.n, i: fmtTok(T.in), o: fmtTok(T.out) }) + (T.unpriced ? ' ' + $t('usage.unpriced', { n: T.unpriced }) : ''))),
        ...(rs.length ? [line()] : []), // replaceChildren would print a bare null
        h('div', { class: 'cn' }, h('div', { class: 'top' }, h('b', {}, $t(byCost ? 'usage.chartCost' : 'usage.chartTok')),
          seg('by', [['day', $t('usage.by.day')], ['model', $t('usage.by.model')], ['task', $t('usage.by.task')], ['pr', 'PR']])),
          rs.length ? chart : h('div', { class: 'mut' }, $t('usage.none'))),
        h('div', { class: 'cn' }, h('div', { class: 'top' }, h('b', {}, $t('usage.recent'))),
          h('div', { class: 'utbl' }, h('table', {},
            h('thead', {}, h('tr', {}, h('th', {}, $t('usage.col.date')), h('th', {}, $t('usage.col.pr')), h('th', {}, $t('usage.col.task')), h('th', {}, $t('usage.col.model')),
              h('th', { class: 'n' }, $t('usage.col.in')), h('th', { class: 'n' }, $t('usage.col.out')), h('th', { class: 'n' }, $t('usage.col.cost')))),
            h('tbody', {}, ...rs.slice(0, LIM).map(r => h('tr', {}, td(new Date(r.ts).toLocaleString()), h('td', { class: 'ell', title: r.title }, prName.get(r.pr) || r.title), td(r.task), td(r.model),
              td(fmtTok(tin(r)), 'n'), td(fmtTok(r.out), 'n'), td(r.cost == null ? '—' : fmtUsd(r.cost), 'n')))))),
          rs.length > LIM ? h('div', { class: 'mut', style: 'margin-top:6px' }, $t('usage.more', { n: LIM, t: rs.length })) : null));
    };
    draw();
  }
  const uf = { days: 30, pr: '', model: '', task: '', q: '', by: 'day', split: '', zoom: null, hide: new Set() }; // AI usage filters, kept while the dialog is open
  const COLORS = ['var(--chg)', 'var(--lnk)', 'var(--add)', 'var(--del)', '#c08cff', 'var(--warn)', 'var(--mut)'];

  // any page: a [data-settings] button opens the menu; #conexiones / #ajustes in the URL open it on load
  for (const b of document.querySelectorAll('[data-settings]')) b.onclick = e => { e.stopPropagation(); openSet(setTab); };
  dlg.addEventListener('close', () => { if (location.hash.startsWith('#ajustes')) history.replaceState(null, '', location.pathname + location.search); });
  const m = location.hash.match(/^#ajustes-(\w+)$/);
  if (m) openSet(m[1]);
  else if (location.hash == '#conexiones') openSet('conn');
  else if (location.hash == '#ajustes') openSet('repos');
})();
