// Client i18n engine. Spanish is the base language, English the second one. Publishes globalThis.i18n and the short alias $t.
// Dictionaries live in locales.js (globalThis.LOCALES). The first language is the server default (<html lang>), overridden by the
// user's choice in localStorage. Switching language reloads the page: the UI is rendered once, synchronously, at load.
//   $t('key', { name: 'x' })   {name} interpolation
//   $t('key', { n: 3 })        value 'one|other': picks the first part when n == 1, the second otherwise (and still fills {n})
// Static markup: data-i18n (text), data-i18n-title, data-i18n-placeholder, data-i18n-aria (aria-label).
// Every same-origin fetch carries x-prpeer-lang so the server answers (errors, AI prompts) in the chosen language.
(() => {
  const K = 'prpeer:lang', LANGS = ['es', 'en'], doc = globalThis.document;
  const read = () => { try { return localStorage.getItem(K) || ''; } catch { return ''; } };
  const def = LANGS.includes(doc?.documentElement.lang) ? doc.documentElement.lang : 'es';
  let lang = LANGS.includes(read()) ? read() : def;
  const t = (key, vars) => {
    const L = globalThis.LOCALES;
    let s = L[lang]?.[key] ?? L.es[key] ?? key;
    if (typeof vars?.n === 'number' && s.includes('|')) s = s.split('|')[vars.n === 1 ? 0 : 1];
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
  };
  const apply = (root = doc) => {
    for (const [attr, set] of [['data-i18n', (e, v) => (e.textContent = v)], ['data-i18n-title', (e, v) => (e.title = v)],
      ['data-i18n-placeholder', (e, v) => (e.placeholder = v)], ['data-i18n-aria', (e, v) => e.setAttribute('aria-label', v)]])
      for (const e of root.querySelectorAll(`[${attr}]`)) set(e, t(e.getAttribute(attr)));
  };
  const setLang = l => {
    if (!LANGS.includes(l) || l === lang) return;
    try { localStorage.setItem(K, l); } catch { /* no storage: the choice lasts until reload */ }
    lang = l;
    location.reload();
  };
  globalThis.i18n = { t, apply, setLang, langs: LANGS, get lang() { return lang; } };
  globalThis.$t = t;
  if (doc) {
    doc.documentElement.lang = lang;
    apply();
    const f0 = globalThis.fetch;
    globalThis.fetch = (u, o = {}) => { const h = new Headers(o.headers); h.set('x-prpeer-lang', lang); return f0(u, { ...o, headers: h }); };
  }
})();
