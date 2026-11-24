import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { analyzeTs, isTsFile, parseTsconfig, resolveSpec, specsOf } from './tslang.ts';
import { analyze } from './analyze.ts';
import { isTest } from './graph.ts';

const SAMPLE = `#!/usr/bin/env node
/**
 * Payment utilities.
 */

import { a } from './a.js';
import type { T } from "./types";
export * from './re-export';
const lazy = () => import('./lazy');
const old = require('./old');

/** Adds two numbers. */
export function add(a: number, b: number) {
  function inner() { return 1; }
  return a + b + inner();
}

export const Comp = ({ x }: { x: number }) => {
  return <div>{x}</div>;
};

/** Una clase. */
@dec()
export class Repo extends Base {
  static count = 0;
  constructor(private db: Db) { super(); }
  /** Busca. */
  async find(id: string) { return this.db.get(id); }
  get size() { return 1; }
  handler = () => { return 2; };
}

export interface Opts { a: number }
export type Id = string | number;
export enum Mode { A, B }
export default function () { return 0; }
`;

test('analyzeTs: functions, classes, methods, types, nested ones, JSDoc, module docstring and total', () => {
  const r = analyzeTs('x.tsx', SAMPLE);
  const got = r.symbols.map(s => [s.name, s.kind, s.start, s.end]);
  assert.deepEqual(got, [
    ['lazy', 'fn', 9, 9], ['add', 'fn', 12, 16], ['add.inner', 'fn', 14, 14], ['Comp', 'fn', 18, 20],
    ['Repo', 'class', 22, 31], ['Repo.constructor', 'method', 26, 26], ['Repo.find', 'method', 27, 28], ['Repo.size', 'method', 29, 29], ['Repo.handler', 'method', 30, 30],
    ['Opts', 'interface', 33, 33], ['Id', 'type', 34, 34], ['Mode', 'enum', 35, 35], ['default', 'fn', 36, 36],
  ]);
  const doc = (n: string) => r.symbols.find(s => s.name === n)!.doc;
  assert.equal(doc('add'), 'Adds two numbers.');
  assert.equal(doc('Repo'), 'Una clase.');
  assert.equal(doc('Repo.find'), 'Busca.');
  assert.equal(doc('Comp'), null);
  assert.equal(r.doc, 'Payment utilities.'); // /** */ at the top, separated from the code
  assert.equal(r.total, 36);
});

test('analyzeTs: the JSDoc attached to the first function is NOT the module docstring; plain JS too', () => {
  assert.equal(analyzeTs('a.ts', '/** of f */\nexport function f() {}\n').doc, null);
  assert.equal(analyzeTs('a.ts', '/** @file module */\nexport function f() {}\n').doc, '@file module');
  const js = analyzeTs('a.js', 'const f = function () {};\nmodule.exports = { f };\nclass A { m() {} }\n');
  assert.deepEqual(js.symbols.map(s => s.name), ['f', 'A', 'A.m']);
  assert.doesNotThrow(() => analyzeTs('rota.ts', 'function ( {{{ class'), 'sintaxis rota: no explota');
});

test('specsOf: import, import type, export from, require and dynamic import()', () => {
  assert.deepEqual(specsOf(SAMPLE), ['./a.js', './types', './re-export', './lazy', './old']);
});

test('resolveSpec: relatives, extensions, index, ./a.js -> a.ts, packages ignored', () => {
  const all = new Set(['src/a.ts', 'src/b.tsx', 'src/util/index.ts', 'src/c.js', 'lib/d.mts', 'src/x.ts']);
  const r = (s: string, from = 'src/x.ts') => resolveSpec(from, s, all);
  assert.equal(r('./a.js'), 'src/a.ts');
  assert.equal(r('./b'), 'src/b.tsx');
  assert.equal(r('./util'), 'src/util/index.ts');
  assert.equal(r('./c'), 'src/c.js');
  assert.equal(r('../lib/d.mjs'), 'lib/d.mts');
  assert.equal(r('react'), undefined);
  assert.equal(r('./nope'), undefined);
  assert.equal(r('./x'), undefined); // does not import itself
});

test('resolveSpec: tsconfig aliases (paths and baseUrl, with comments in the JSON)', () => {
  const all = new Set(['src/a.ts', 'src/util/index.ts']);
  const cfg = parseTsconfig('tsconfig.json', '{ // comment\n "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], "util": ["src/util/index.ts"] } } }')!;
  assert.equal(resolveSpec('app/m.ts', '@/a', all, cfg), 'src/a.ts');
  assert.equal(resolveSpec('app/m.ts', 'util', all, cfg), 'src/util/index.ts');
  assert.equal(resolveSpec('app/m.ts', 'src/a', all, cfg), 'src/a.ts'); // baseUrl
  assert.equal(resolveSpec('app/m.ts', '@/zzz', all, cfg), undefined);
  assert.equal(parseTsconfig('x/tsconfig.json', '{}'), null);
});

test('isTsFile / isTest for JS and TS', () => {
  assert.ok(isTsFile('a/b.tsx') && isTsFile('a.mjs') && !isTsFile('a.d.ts') && !isTsFile('a.py'));
  for (const p of ['a.test.ts', 'src/x.spec.jsx', '__tests__/a.js', 'test/a.ts', 'tests/x.js']) assert.ok(isTest(p), p);
  assert.equal(isTest('src/contest.ts'), false);
});

const g = (dir: string, ...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('analyze on a TS repo: per-function sections and graph with relatives, aliases and tests', () => {
  const d = mkdtempSync(join(tmpdir(), 'ts-repo-'));
  const w = (p: string, t: string) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), t); };
  g(d, 'init', '-q', '-b', 'main');
  w('tsconfig.json', '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }');
  w('src/a.ts', '/** Computes the fee. */\nexport function f(x: number) {\n  return x * 2;\n}\n\nexport function g() {\n  return 1;\n}\n');
  w('src/b.ts', "import { f } from './a.js';\nexport const y = f(1);\n");
  w('src/c.ts', "import { g } from '@/a';\nexport const z = g();\n");
  w('test/a.test.ts', "import { f } from '../src/a';\ntest('f', () => f(1));\n");
  w('src/otro.ts', 'export const nada = 1;\n');
  g(d, 'add', '.'); g(d, 'commit', '-qm', 'base');
  g(d, 'checkout', '-q', '-b', 'feat');
  w('src/a.ts', '/** Computes the fee. */\nexport function f(x: number) {\n  return x * 3;\n}\n\nexport function g() {\n  return 1;\n}\n');
  g(d, 'commit', '-qam', 'feat');
  const a = analyze({ repo: d, title: 't', baseRef: 'main', head: 'feat' });
  try {
    const f = a.payload.files.find(x => x.path === 'src/a.ts')!;
    assert.deepEqual(f.sections.map(s => [s.name, s.kind, s.add, s.del, s.doc]), [['f', 'fn', 1, 1, 'Computes the fee.']]);
    assert.equal(f.total, 8);
    const edges = a.payload.links.map(l => `${l.kind} ${l.from} -> ${l.to}`).sort();
    assert.deepEqual(edges, ['import src/b.ts -> src/a.ts', 'import src/c.ts -> src/a.ts', 'test test/a.test.ts -> src/a.ts']);
    assert.deepEqual(a.payload.linked.map(l => l.path), ['src/b.ts', 'src/c.ts', 'test/a.test.ts']);
    assert.ok(!a.payload.linked.some(l => l.path === 'src/otro.ts'));
  } finally { a.cleanup(); }
  assert.equal(existsSync(a.dir), false);
});
