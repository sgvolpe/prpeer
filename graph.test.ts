import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, pairTests, resolveImports } from './graph.ts';

const all = new Set(['lam/main.py', 'lam/products/quotes.py', 'lam/products/__init__.py', 'lam/utils.py', 'lam/tests/test_main.py', 'other/utils.py']);

test('resolves absolutes from the closest root, relatives and submodules', () => {
  const r = (f: string, i: { module: string; names?: string[]; level?: number }) => resolveImports(f, [{ names: [], level: 0, ...i }], all);
  assert.deepEqual(r('lam/main.py', { module: 'products.quotes' }), ['lam/products/quotes.py']);
  assert.deepEqual(r('lam/products/quotes.py', { module: 'utils' }), ['lam/utils.py']); // no other/utils.py
  assert.deepEqual(r('lam/products/quotes.py', { module: '', names: ['__init__'], level: 1 }), ['lam/products/__init__.py']);
  assert.deepEqual(r('lam/main.py', { module: 'products', names: ['quotes'] }).sort(), ['lam/products/__init__.py', 'lam/products/quotes.py']);
  assert.deepEqual(r('lam/main.py', { module: 'os' }), []);
});

test('graph: unchanged neighbors are linked, tests are marked and capped per file', () => {
  const imports = {
    'lam/main.py': [{ module: 'products.quotes', names: [], level: 0 }, { module: 'utils', names: [], level: 0 }],
    'lam/tests/test_main.py': [{ module: 'main', names: [], level: 0 }],
    'lam/utils.py': [], 'lam/products/quotes.py': [], 'lam/products/__init__.py': [], 'other/utils.py': [],
  };
  const targets = Object.fromEntries(Object.entries(imports).map(([f, i]) => [f, resolveImports(f, i, all)]));
  const g = buildGraph(['lam/main.py'], targets);
  assert.deepEqual(g.links.map(l => [l.from, l.to, l.kind]).sort(), [['lam/main.py', 'lam/products/quotes.py', 'import'], ['lam/main.py', 'lam/utils.py', 'import'], ['lam/tests/test_main.py', 'lam/main.py', 'test']]);
  assert.deepEqual(g.linked.map(x => x.path), ['lam/products/quotes.py', 'lam/tests/test_main.py', 'lam/utils.py']);
  const capped = buildGraph(['lam/main.py'], targets, 1);
  assert.equal(capped.linked.length, 1);
  assert.equal(capped.omitted['lam/main.py'], 2);
  assert.equal(capped.linked[0].path, 'lam/products/quotes.py'); // non-test first, alphabetical order
});

test('pairTests: pairs by name, prefers the closest, does not guess on ties nor override imports', () => {
  const files = ['web/js/url_filters.js', 'js_tests/url_filters.test.js', 'a/x.py', 'a/tests/test_x.py', 'b/x.py', 'a/y.py', 'b/y.py', 'z/y_test.py', 'solo.js', 'solo.spec.ts'];
  const targets: Record<string, string[]> = { 'solo.spec.ts': ['solo.js'] };
  pairTests(files, targets);
  assert.deepEqual(targets['js_tests/url_filters.test.js'], ['web/js/url_filters.js']);
  assert.deepEqual(targets['a/tests/test_x.py'], ['a/x.py']); // a/x.py and b/x.py: the one sharing a folder wins
  assert.equal(targets['z/y_test.py'], undefined); // a/y.py and b/y.py equidistant: no guess
  assert.deepEqual(targets['solo.spec.ts'], ['solo.js']); // it already had the import: not duplicated
});
