import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRPEER_HOME = mkdtempSync(join(tmpdir(), 'prpeer-usage-'));
const { costOf, record, readAll, totals } = await import('./usage.ts');

test('cost: list price, cache read and write, unknown model, provider-reported cost', () => {
  assert.equal(costOf('claude-opus-5-5', { in: 1e6, out: 1e6, cr: 1e6, cw: 1e6 }), 4 + 20 + 0.2 + 5);
  assert.equal(costOf('llama3', { in: 5, out: 5, cr: 0, cw: 0 }), null);
  assert.equal(costOf('llama3', { in: 5, out: 5, cr: 0, cw: 0, cost: 0.5 }), 0.5);
});

test('record skips empty usage and totals add up', () => {
  const base = { cr: 0, cw: 0, pr: 'a/b#1', title: 't', task: 'chat', provider: 'x', model: 'claude-haiku-5-5' };
  record({ ...base, in: 0, out: 0 });
  record({ ...base, in: 1000, out: 500 });
  record({ ...base, in: 10, out: 10, model: 'llama3' });
  assert.deepEqual(totals(readAll()), { n: 2, in: 1010, out: 510, cost: 0.00035, unpriced: 1 });
});
