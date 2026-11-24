import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MOOD, resolveMood } from './mood.ts';
import { fileLines, slimPayload } from './slim.ts';

test('mood: defaults, layers override in order and do not mutate the defaults', () => {
  assert.deepEqual(resolveMood(), DEFAULT_MOOD);
  const m = resolveMood({ src: 'config', cfg: { riskWords: ['payout'], thresholds: [1, 2] } }, { src: 'repo', cfg: { riskWords: ['bank'], churnPer: 100 } });
  assert.deepEqual(m.riskWords, ['bank']); // the repo wins
  assert.deepEqual(m.thresholds, [1, 2]); // what the repo does not touch stays from the previous layer
  assert.equal(m.churnPer, 100);
  assert.ok(DEFAULT_MOOD.riskWords.includes('auth') && DEFAULT_MOOD.churnPer === 150);
  assert.deepEqual(resolveMood({ src: 'x', cfg: { riskPaths: [{ match: 'billing/', weight: 1.5 }] } }).riskPaths, [{ match: 'billing/', weight: 1.5 }]);
});

test('mood: validates with messages that name the file and the key', () => {
  const bad = (cfg: unknown, re: RegExp) => assert.throws(() => resolveMood({ src: '.prpeer.json', cfg }), re);
  bad({ riskWordz: [] }, /\.prpeer\.json: mood\.riskWordz does not exist/);
  bad({ riskWords: ['('] }, /mood\.riskWords\[0\] is not a valid regex/);
  bad({ riskWords: ['a'.repeat(201)] }, /up to 200 characters/);
  bad({ churnPer: 0 }, /churnPer/);
  bad({ riskWeight: 'x' }, /riskWeight must be a number/);
  bad({ thresholds: [3, 2] }, /thresholds/);
  bad({ riskPaths: [{ match: 'x' }] }, /weight must be a number/);
  bad([], /must be an object/);
});

const sec = (name: string, n: number) => ({ name, kind: 'fn', doc: null, add: n, del: 0, first: 1, last: n, lines: Array.from({ length: n }, (_, i) => ({ k: '+' as const, t: `l${i}`, n: i + 1 })) });
const P = {
  title: 't', base: { ref: 'main' }, head: 'h', links: [], linked: [], readmes: {}, changelog: null,
  files: [{ path: 'a.py', status: 'added', add: 30, del: 0, binary: false, doc: null, hunks: [{ x: 1 }], sections: [sec('f', 20), sec('g', 10)] }],
};

test('slim: no lines or hunks and with a preview of the biggest section; fileLines returns them complete and in order', () => {
  const s = slimPayload(P);
  assert.equal(JSON.stringify(s).includes('"hunks"'), false);
  assert.equal((s.files[0].sections[0] as unknown as { lines?: unknown }).lines, undefined);
  assert.equal(s.files[0].preview, '+ l0\n+ l1\n+ l2\n+ l3\n+ l4\n+ l5'); // section f (20) is bigger than g (10)
  assert.ok(JSON.stringify(s).length < JSON.stringify(P).length);
  const l = fileLines(P, 'a.py')!;
  assert.deepEqual(l.map(x => x.length), [20, 10]);
  assert.equal(fileLines(P, '../etc/passwd'), null); // only paths that are files of the PR
});
