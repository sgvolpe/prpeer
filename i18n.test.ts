import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curLang, defaultLang, normLang, setDefaultLang, t, withLang } from './i18n.ts';
import { messages } from './locales.ts';

test('t: current language, then Spanish, then the key itself', () => {
  assert.equal(t('lang.name'), 'español');
  assert.equal(withLang('en', () => t('lang.name')), 'English');
  messages.es['test.onlyEs'] = 'solo es'; // a key missing in English falls back to the Spanish base
  try {
    assert.equal(withLang('en', () => t('test.onlyEs')), 'solo es');
    assert.equal(withLang('en', () => t('test.missing')), 'test.missing');
  } finally { delete messages.es['test.onlyEs']; }
});

test('t: {name} interpolation (unknown placeholders are left as they are) and one|other plural', () => {
  assert.equal(t('err.needsClone', { repo: 'o/r' }), 'no hay un clon local de o/r');
  assert.equal(t('err.needsClone'), 'no hay un clon local de {repo}');
  assert.equal(t('ai.ctx.files', { n: 1 }), '1 archivo');
  assert.equal(t('ai.ctx.files', { n: 0 }), '0 archivos');
  assert.equal(t('ai.ctx.files', { n: 2 }), '2 archivos');
  assert.equal(withLang('en', () => t('ai.ctx.files', { n: 1 })), '1 file');
  assert.equal(withLang('en', () => t('ai.ctx.files', { n: 5 })), '5 files');
  assert.equal(t('ai.ctx.pr', { title: 'a|b', base: 'm', head: 'h', files: 'x', add: 0, del: 0 }).includes('PR: a|b'), true); // a '|' inside an interpolated value is not a plural separator
});

test('normLang / setDefaultLang: unknown values fall back to the default', () => {
  assert.equal(normLang('en'), 'en');
  assert.equal(normLang('fr'), 'es');
  assert.equal(normLang(undefined), 'es');
  setDefaultLang('en');
  try {
    assert.equal(defaultLang(), 'en');
    assert.equal(curLang(), 'en');
    assert.equal(normLang('fr'), 'en');
    assert.equal(t('lang.name'), 'English');
    assert.equal(withLang('es', () => t('lang.name')), 'español');
  } finally { setDefaultLang(); }
  assert.equal(defaultLang(), 'es');
  setDefaultLang('xx');
  assert.equal(defaultLang(), 'es');
});

test('withLang: concurrent async calls do not leak their language into each other', async () => {
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const job = (lang: string, ms: number) => withLang(lang, async () => { await sleep(ms); const a = t('lang.name'); await sleep(ms); return [a, t('lang.name'), curLang()]; });
  const [en, es] = await Promise.all([job('en', 5), job('es', 3)]);
  assert.deepEqual(en, ['English', 'English', 'en']);
  assert.deepEqual(es, ['español', 'español', 'es']);
  async function* gen() { await sleep(2); yield t('lang.name'); await sleep(2); yield t('lang.name'); }
  const out = await Promise.all(['en', 'es'].map(l => withLang(l, async () => { const r: string[] = []; for await (const x of gen()) r.push(x); return r; })));
  assert.deepEqual(out, [['English', 'English'], ['español', 'español']]); // also inside async generators (streamed answers)
});
