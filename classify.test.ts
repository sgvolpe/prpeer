import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairFunctionTests, surfaceOf, tagSection } from './classify.ts';
import type { Section, SecLine } from './sections.ts';

const sec = (name: string, lines: SecLine[], extra: Partial<Section> = {}): Section => ({
  name, kind: 'function', doc: null, add: lines.filter(l => l.k === '+').length, del: lines.filter(l => l.k === '-').length,
  first: 1, last: 9, lines, ...extra,
});
const add = (t: string, n: number): SecLine => ({ k: '+', t, n });
const del = (t: string, o: number): SecLine => ({ k: '-', t, o });

test('tagSection: new, removed, format-only and signature changes', () => {
  assert.deepEqual(tagSection(sec('f', [add('def f():', 1), add('  return 1', 2)], { start: 1, end: 2 })), ['new']);
  assert.deepEqual(tagSection(sec('f', [del('def f():', 1), del('  return 1', 2)])), ['removed']);
  assert.deepEqual(tagSection(sec('f', [del('x = f(a,b)', 3), add('x = f(a, b)', 3)])), ['format']);
  assert.deepEqual(tagSection(sec('Svc.refund', [del('  def refund(self, o):', 4), add('  def refund(self, o, reason):', 4)], { start: 4, end: 9 })), ['signature']);
  assert.deepEqual(tagSection(sec('refund', [del('  x = 1', 5), add('  x = 2', 5)])), []); // a body change is just a change
  assert.deepEqual(tagSection(sec('(module)', [del('import a', 1), add('import b', 1)], { kind: 'module' })), []);
});

test('surfaceOf: public signatures, endpoints, env vars, migrations and dependencies; not tests nor private functions', () => {
  const s = surfaceOf([
    { path: 'api/routes.py', status: 'modified', sections: [sec('create', [add("@router.post('/refunds')", 10), add('KEY = os.environ["PAY_KEY"]', 11)])] },
    { path: 'svc.py', status: 'modified', sections: [sec('pay', [del('def pay(a):', 1), add('def pay(a, b):', 1)]), sec('_helper', [del('def _helper(a):', 5), add('def _helper(a, b):', 5)])] },
    { path: 'db/migrations/0007.py', status: 'added', sections: [] },
    { path: 'requirements.txt', status: 'modified', sections: [] },
    { path: 'tests/test_svc.py', status: 'modified', sections: [sec('test_pay', [del('def test_pay(a):', 1), add('def test_pay(a, b):', 1)])] },
  ]);
  assert.deepEqual(s.map(x => [x.kind, x.path, x.line ?? null]), [
    ['endpoint', 'api/routes.py', 10], ['env', 'api/routes.py', 11], ['signature', 'svc.py', 1],
    ['migration', 'db/migrations/0007.py', null], ['deps', 'requirements.txt', null],
  ]);
});

test('pairFunctionTests: each function gets the test lines that mention it; untested ones get an empty list; common names are skipped', () => {
  const files = [
    { path: 'svc.py', status: 'modified', sections: [sec('Svc.refund', [add('x', 1)]), sec('ship_order', [add('y', 9)]), sec('get', [add('z', 20)]), sec('(module)', [add('import a', 1)], { kind: 'module' })] },
    { path: 'tests/test_svc.py', status: 'modified', sections: [sec('test_refund', [add('refund(o)', 3)])] },
  ] as Parameters<typeof pairFunctionTests>[0];
  let asked: string[] = [];
  pairFunctionTests(files, names => { asked = names; return 'tests/test_svc.py:3:    refund(o)\r\nsvc.py:2:def refund(self):\ntests/test_svc.py:8:  assert refund(o) and refund(p)\n'; });
  assert.deepEqual(asked, ['refund', 'ship_order']); // get: too common; module: not a function; the test itself: not paired
  const [refund, ship, get] = files[0].sections as { tests?: unknown[] }[];
  assert.deepEqual(refund.tests, [{ path: 'tests/test_svc.py', line: 3 }, { path: 'tests/test_svc.py', line: 8 }]);
  assert.deepEqual(ship.tests, []);
  assert.equal(get.tests, undefined);
});
