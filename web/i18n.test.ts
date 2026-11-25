import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

await import('./locales.js');
const L = (globalThis as unknown as { LOCALES: Record<'es' | 'en', Record<string, string>> }).LOCALES;
const here = import.meta.dirname;
const src = (f: string) => readFileSync(join(here, f), 'utf8');
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

test('es and en have the same keys, and the same {vars} in every plural form', () => {
  assert.deepEqual(Object.keys(L.es), Object.keys(L.en));
  for (const k of Object.keys(L.es)) {
    const [a, b] = [L.es[k].split('|'), L.en[k].split('|')];
    assert.equal(a.length, b.length, `${k}: different number of plural forms`);
    a.forEach((p, i) => assert.equal(vars(p), vars(b[i]), `${k}: placeholders differ`));
    assert.ok(L.en[k] !== '' && L.es[k] !== '', `${k}: empty value`);
  }
});

// keys the UI builds at run time ('mood.' + name, 'rv.' + id…): listed here because a scan of literals can't see them
const DYNAMIC = [
  ...['added', 'deleted', 'renamed', 'modified'].map(s => 'file.' + s),
  ...['calm', 'attention', 'risky'].map(s => 'mood.' + s), ...[0, 1, 2].map(i => 'ctx.lvl.' + i), ...[0, 1, 2].map(i => 'map.lvl.' + i),
  ...['coherence', 'comments', 'security', 'tests', 'breaking'].flatMap(s => ['rv.' + s, 'rv.' + s + '.tip']),
  ...['secret', 'signal'].map(s => 'scan.level.' + s), ...['env', 'gh', 'saved', 'cli'].map(s => 'conn.from.' + s),
  ...['open', 'merged', 'closed'].map(s => 'home.state.' + s),
  ...['conn', 'ai', 'repos', 'look', 'data', 'usage'].map(s => 'set.tab.' + s), ...['github', 'jira', 'anthropic', 'cli', 'other'].map(s => 'conn.guide.' + s),
  ...['c', 'l', 'o'].map(s => 'uses.' + s), ...['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].map(s => 'nt.ev.' + s),
  ...['new', 'removed', 'format', 'signature'].flatMap(s => ['tag.' + s, 'tag.' + s + '.tip']),
  ...['signature', 'removed', 'endpoint', 'env', 'migration', 'deps', 'config'].map(s => 'surf.' + s),
];

test('every key the web files use exists in the dictionaries', () => {
  const prefixes = new Set(Object.keys(L.es).map(k => k.split('.')[0]));
  const used = new Set(DYNAMIC);
  for (const f of ['app.js', 'home.js', 'theme.js', 'settings.js', 'map/MapView.tsx'])
    for (const m of src(f).matchAll(/'([a-z0-9]+(?:\.[A-Za-z0-9]+)+)'/g)) if (prefixes.has(m[1].split('.')[0])) used.add(m[1]);
  for (const f of ['index.html', 'home.html'])
    for (const m of src(f).matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g)) used.add(m[1]);
  const missing = [...used].filter(k => !(k in L.es));
  assert.deepEqual(missing, []);
});

test('no dictionary key is dead: each one is referenced by the web files', () => {
  const all = ['app.js', 'home.js', 'theme.js', 'settings.js', 'map/MapView.tsx', 'index.html', 'home.html'].map(src).join('\n');
  const dyn = new Set(DYNAMIC);
  assert.deepEqual(Object.keys(L.es).filter(k => !dyn.has(k) && !all.includes(`'${k}'`) && !all.includes(`"${k}"`)), []);
});

// the engine reads localStorage at load: re-import it with a fake one to get English
const load = async (lang?: string) => {
  (globalThis as { localStorage?: unknown }).localStorage = lang ? { getItem: () => lang, setItem: () => {} } : undefined;
  await import(`./i18n.js?${lang}-${Math.random()}`);
  return (globalThis as unknown as { i18n: { t: (k: string, v?: Record<string, unknown>) => string; lang: string } }).i18n;
};

test('t(): Spanish by default, English when chosen; missing keys fall back to es and then to the key', async () => {
  let i = await load();
  assert.equal(i.lang, 'es');
  assert.equal(i.t('common.close'), 'Cerrar');
  i = await load('en');
  assert.equal(i.lang, 'en');
  assert.equal(i.t('common.close'), 'Close');
  assert.equal(i.t('no.such.key'), 'no.such.key');
  const es = L.es['common.close'];
  delete L.en['common.close'];
  assert.equal(i.t('common.close'), es);
  L.en['common.close'] = 'Close';
});

test('t(): {vars} and one|other plurals (n == 1 picks the first form)', async () => {
  const i = await load('en');
  assert.equal(i.t('wt.title', { head: 'abc12345' }), 'Worktree · abc12345');
  assert.equal(i.t('tree.matches', { n: 1 }), '1 match');
  assert.equal(i.t('tree.matches', { n: 3 }), '3 matches');
  assert.equal(i.t('tree.matches', { n: 0 }), '0 matches');
  assert.equal(i.t('conn.wouldUse', { x: 'gh' }), 'Would have used: gh');
  assert.equal(i.t('conn.wouldUse'), 'Would have used: {x}', 'a missing var stays visible instead of printing "undefined"');
  const es = await load();
  assert.equal(es.t('tree.matches', { n: 1 }), '1 coincidencia');
  assert.equal(es.t('tree.matches', { n: 2 }), '2 coincidencias');
});
