import { posix } from 'node:path';

export type Imp = { module: string; names: string[]; level: number };
export type Link = { from: string; to: string; kind: 'import' | 'test' };
const j = posix.join;

// Repo files that each import of `file` points to. Absolute roots are unknown:
// try from the file's folder upwards and the closest one wins (each lambda has its own root).
export function resolveImports(file: string, imps: Imp[], all: Set<string>): string[] {
  const out = new Set<string>();
  for (const i of imps) {
    const parts = i.module ? i.module.split('.') : [];
    const roots: string[] = [];
    let d = posix.dirname(file);
    if (i.level > 0) { for (let k = 1; k < i.level; k++) d = posix.dirname(d); roots.push(d); }
    else for (;;) { roots.push(d); if (d === '.' || d === '/') break; d = posix.dirname(d); }
    for (const r of roots) {
      const base = j(r, ...parts);
      const hits: string[] = [];
      if (parts.length) for (const c of [base + '.py', j(base, '__init__.py')]) if (all.has(c)) hits.push(c);
      for (const n of i.names) for (const c of [j(base, n) + '.py', j(base, n, '__init__.py')]) if (all.has(c)) hits.push(c);
      if (hits.length) { for (const h of hits) if (h !== file) out.add(h); break; }
    }
  }
  return [...out];
}

export const isTest = (p: string) => /(^|\/)(tests?|__tests__|spec)\//.test(p) || /(^|\/)(test_[^/]*|[^/]*_test|conftest)\.py$/.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);

// Test pairing: a test that loads its code without importing it (vm, fs, browser scripts) is still matched by name:
// url_filters.test.js / test_url_filters.py / url_filters_test.py -> url_filters.js|py. The closest candidate in the tree wins; ties are not guessed.
const testStem = (p: string) => {
  const b = posix.basename(p);
  return /^test_(.+)\.py$/.exec(b)?.[1] ?? /^(.+)_test\.py$/.exec(b)?.[1] ?? /^(.+)\.(?:test|spec)\.[cm]?[jt]sx?$/.exec(b)?.[1];
};
export function pairTests(files: string[], targets: Record<string, string[]>) {
  const byStem = new Map<string, string[]>();
  for (const f of files) if (!isTest(f)) { const s = posix.basename(f).replace(/\.[^.]+$/, ''); (byStem.get(s) ?? byStem.set(s, []).get(s)!).push(f); }
  const common = (a: string, b: string) => { const x = a.split('/'), y = b.split('/'); let i = 0; while (i < x.length - 1 && i < y.length - 1 && x[i] === y[i]) i++; return i; };
  for (const t of files) {
    const stem = isTest(t) ? testStem(t) : undefined, cands = stem ? byStem.get(stem) : undefined;
    if (!cands?.length || (targets[t] ?? []).some(x => cands.includes(x))) continue;
    const ranked = cands.map(c => [c, common(t, c)] as const).sort((a, b) => b[1] - a[1]);
    if (ranked.length === 1 || ranked[0][1] > ranked[1][1]) targets[t] = [...(targets[t] ?? []), ranked[0][0]];
  }
}

// Edges touching a changed file + the unchanged neighbors ("linked"), capped per changed file.
// `targets`: for each file, the repo files it imports (already resolved by the matching language).
export function buildGraph(changed: string[], targets: Record<string, string[]>, max = 8) {
  const ch = new Set(changed);
  let edges: Link[] = [];
  for (const [f, ts] of Object.entries(targets))
    for (const t of ts)
      if (ch.has(f) || ch.has(t)) edges.push({ from: f, to: t, kind: isTest(f) ? 'test' : 'import' });
  const omitted: Record<string, number> = {};
  for (const c of changed) {
    const other = (e: Link) => (e.from === c ? e.to : e.from);
    const nb = edges.filter(e => (e.from === c || e.to === c) && !ch.has(other(e)))
      .sort((a, b) => Number(a.kind === 'test') - Number(b.kind === 'test') || other(a).localeCompare(other(b)));
    if (nb.length <= max) continue;
    const drop = new Set(nb.slice(max));
    omitted[c] = drop.size;
    edges = edges.filter(e => !drop.has(e));
  }
  const via = new Map<string, Set<string>>();
  for (const e of edges) for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) if (ch.has(a) && !ch.has(b)) (via.get(b) ?? via.set(b, new Set()).get(b)!).add(a);
  const linked = [...via].map(([path, v]) => ({ path, via: [...v].sort() })).sort((a, b) => a.path.localeCompare(b.path));
  return { links: edges, linked, omitted };
}
