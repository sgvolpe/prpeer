import { test } from 'node:test';
import assert from 'node:assert/strict';
import './web/query.js';

const { matchQuery, parseTerms } = (globalThis as unknown as { pathQuery: { matchQuery(q: string, p: string): boolean; parseTerms(q: string): string[] } }).pathQuery;
const files = ['docs/README.md', 'src/app.py', 'src/app.pyc', 'src/Billing/fees.py', 'tests/test_fees.py', 'web/x.test.js', 'web/x.js', 'infra/main.tf', 'Dockerfile', 'notes.mdx'];
const hits = (q: string) => files.filter(f => matchQuery(q, f));

test('parseTerms: spaces and commas, no empty terms', () => {
  assert.deepEqual(parseTerms('  .md ,*.sh   test,'), ['.md', '*.sh', 'test']);
  assert.deepEqual(parseTerms(''), []);
});

test('plain text: substring of the path, case-insensitive', () => {
  assert.deepEqual(hits('billing'), ['src/Billing/fees.py']);
  assert.deepEqual(hits('test'), ['tests/test_fees.py', 'web/x.test.js']);
  assert.deepEqual(hits('docker'), ['Dockerfile']);
});

test('.ext: extension or name segment, without confusing .py with .pyc or .md with .mdx', () => {
  assert.deepEqual(hits('.py'), ['src/app.py', 'src/Billing/fees.py', 'tests/test_fees.py']);
  assert.deepEqual(hits('.md'), ['docs/README.md']);
  assert.deepEqual(hits('.test'), ['web/x.test.js']);
});

test('wildcards: on the name or the full path', () => {
  assert.deepEqual(hits('*.md'), ['docs/README.md']);
  assert.deepEqual(hits('tests/*'), ['tests/test_fees.py']);
  assert.deepEqual(hits('test_*.py'), ['tests/test_fees.py']);
  assert.deepEqual(hits('app.py?'), ['src/app.pyc']);
  assert.deepEqual(hits('*.t(f)'), []); // regex characters are taken literally
});

test('several terms: any one matches; empty matches nothing', () => {
  assert.deepEqual(hits('.md, .tf'), ['docs/README.md', 'infra/main.tf']);
  assert.deepEqual(hits('*.md Dockerfile'), ['docs/README.md', 'Dockerfile']);
  assert.deepEqual(hits('   '), []);
});
