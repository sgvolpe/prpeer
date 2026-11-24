import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDiff } from './diff.ts';
import { buildSections } from './sections.ts';

const syms = [
  { name: 'A', kind: 'class', start: 1, end: 10, doc: 'doc A' },
  { name: 'A.m', kind: 'method', start: 3, end: 6, doc: null },
  { name: 'f', kind: 'fn', start: 12, end: 15, doc: null },
];

test('a new file is split by function, nested code goes to the innermost', () => {
  const lines = Array.from({ length: 15 }, (_, i) => `+l${i + 1}`).join('\n');
  const [f] = parseDiff(`diff --git a/x.py b/x.py\nnew file mode 100644\n@@ -0,0 +1,15 @@\n${lines}\n`);
  const s = buildSections(f, syms);
  const by = Object.fromEntries(s.map(x => [x.name, x.add]));
  assert.deepEqual(by, { A: 6, 'A.m': 4, '(module)': 1, f: 4 });
  assert.equal(s[0].doc, 'doc A');
});

test('deleted and modified lines fall in the function where they happen; without syms it uses the @@ header', () => {
  const [f] = parseDiff(`diff --git a/x.py b/x.py\n@@ -4,2 +4,1 @@ def m\n-a\n-b\n+c\n@@ -13 +12,0 @@ def f\n-z\n`);
  const s = buildSections(f, syms);
  assert.deepEqual(s.map(x => [x.name, x.add, x.del]), [['A.m', 1, 2], ['f', 0, 1]]);
  assert.deepEqual(s[0].lines.map(l => [l.k, l.o, l.n]), [['-', 4, undefined], ['-', 5, undefined], ['+', undefined, 4]]);
  assert.deepEqual(buildSections(f).map(x => x.name), ['def m', 'def f']);
});

test('pysections.py extracts symbols and docstrings', t => {
  const py = ['python3', 'python'].find(c => { try { execFileSync(c, ['-c', '1'], { stdio: 'ignore' }); return true; } catch { return false; } });
  if (!py) return t.skip('no python');
  const p = join(mkdtempSync(join(tmpdir(), 'pys-')), 'm.py');
  writeFileSync(p, '"""mod"""\n@dec\nclass C:\n    """cls"""\n    def m(self):\n        def inner(): pass\n');
  const r = JSON.parse(execFileSync(py, [join(import.meta.dirname, 'pysections.py'), p], { encoding: 'utf8' }))[p];
  assert.equal(r.doc, 'mod');
  assert.deepEqual(r.symbols.map((s: any) => [s.name, s.kind, s.start]), [['C', 'class', 2], ['C.m', 'method', 5], ['C.m.inner', 'fn', 6]]);
  assert.equal(r.symbols[0].doc, 'cls');
});
