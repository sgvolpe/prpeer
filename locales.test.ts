import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messages } from './locales.ts';

const vars = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort();

test('es and en have exactly the same keys', () => {
  const es = Object.keys(messages.es).sort(), en = Object.keys(messages.en).sort();
  assert.deepEqual(es.filter(k => !(k in messages.en)), [], 'missing in en');
  assert.deepEqual(en.filter(k => !(k in messages.es)), [], 'missing in es');
});

test('every key has the same {placeholders} and the same plural shape in both languages', () => {
  for (const k of Object.keys(messages.es)) {
    assert.deepEqual(vars(messages.en[k]), vars(messages.es[k]), `placeholders of ${k}`);
    assert.equal(messages.en[k].includes('|'), messages.es[k].includes('|'), `plural shape of ${k}`);
    assert.ok(messages.es[k] !== '' && messages.en[k] !== '', `empty value in ${k}`);
  }
});

test('the English text of the "provider is disconnected" error contains "disconnected" (the client matches it)', () => {
  assert.match(messages.es['llm.off'], /desconectado/);
  assert.match(messages.en['llm.off'], /disconnected/);
});
