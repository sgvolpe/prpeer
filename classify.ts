// What kind of change each section is, and what in the PR changes for whoever uses the code ("surface").
// Heuristics on the changed lines only, the same for every language.
import { isTest } from './graph.ts';
import type { Section } from './sections.ts';

export type Tag = 'new' | 'removed' | 'format' | 'signature';
export type Surface = { kind: 'signature' | 'removed' | 'endpoint' | 'env' | 'migration' | 'deps' | 'config'; path: string; line?: number; text: string };

const norm = (ls: { t: string }[]) => ls.map(l => l.t.replace(/\s+/g, '')).filter(Boolean).sort().join('\n');
// the bare name of a section: `Svc.refund` → refund, `def ship(order) -> X:` → ship
export const short = (name: string) => /([A-Za-z_$][\w$]*)\s*(\(|$)/.exec(name.split(/\.|::|#/).pop()!.trim())?.[1];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// names too common to pair a function with its tests by name alone
const COMMON = new Set(['get', 'set', 'run', 'main', 'init', '__init__', 'constructor', 'default', 'render', 'call', 'update', 'create', 'delete', 'save', 'load', 'handle', 'process', 'setup', 'apply', 'build', 'parse', 'validate', 'toString', '__str__', '__repr__']);
type T = { path: string; line: number };
// Each changed function or class with the tests that mention it: `grep` gets the matches of every name at once
// (`git grep -n -w` output: path:line:text) and tests[] stays empty when no test file mentions it.
// shortcut: pairing is by name, so two functions with the same name share tests; COMMON names are not paired.
export function pairFunctionTests(files: { path: string; status: string; sections: (Section & { tests?: T[] })[] }[], grep: (names: string[]) => string) {
  const want = new Map<string, (Section & { tests?: T[] })[]>();
  for (const f of files) {
    if (isTest(f.path) || f.status === 'deleted') continue;
    for (const s of f.sections) {
      const n = s.kind !== 'module' && s.kind !== 'hunk' ? short(s.name) : undefined;
      if (!n || n.length < 3 || COMMON.has(n)) continue;
      s.tests = [];
      (want.get(n) ?? want.set(n, []).get(n)!).push(s);
    }
  }
  const names = [...want.keys()].slice(0, 200); // one command line: Windows caps its length
  if (!names.length) return;
  const re = new RegExp(`\\b(${names.map(esc).join('|')})\\b`, 'g');
  for (const l of grep(names).split(/\r?\n/)) {
    const m = /^(.*?):(\d+):(.*)$/s.exec(l);
    if (!m || !isTest(m[1])) continue;
    for (const n of new Set([...m[3].matchAll(re)].map(x => x[1])))
      for (const s of want.get(n) ?? []) if (s.tests!.length < 5 && !s.tests!.some(x => x.path === m[1] && x.line === +m[2])) s.tests!.push({ path: m[1], line: +m[2] });
  }
}

// new: the whole function was added · removed: only deletions · format: the same code with other spacing or line breaks ·
// signature: its definition line (the name followed by its parameters) changed.
// shortcut: "signature" looks for the name followed by `(` or after `class`; decorators and multi-line signatures can be missed.
export function tagSection(s: Section): Tag[] {
  const add = s.lines.filter(l => l.k === '+'), del = s.lines.filter(l => l.k === '-');
  if (!del.length && s.start != null && s.end != null && add.length >= s.end - s.start + 1) return ['new'];
  if (!add.length && del.length) return ['removed'];
  if (norm(add) && norm(add) === norm(del)) return ['format'];
  const n = s.kind !== 'module' && s.kind !== 'hunk' ? short(s.name) : undefined;
  if (n) {
    const def = new RegExp(`(\\b${esc(n)}\\s*\\(|\\bclass\\s+${esc(n)}\\b)`);
    const a = add.find(l => def.test(l.t)), d = del.find(l => def.test(l.t));
    if (a && d && a.t.replace(/\s+/g, '') !== d.t.replace(/\s+/g, '')) return ['signature'];
  }
  return [];
}

const MIGRATION = /(^|\/)migrations?\/|\.sql$/i;
const DEPS = /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile|go\.mod|Cargo\.toml|Gemfile|pom\.xml|build\.gradle(\.kts)?)$/;
const CONFIG = /\.(ya?ml|toml|ini|cfg|env)$|(^|\/)(Dockerfile|docker-compose[^/]*|\.github\/.*)$/;
const ROUTE = /@(app|router|bp|blueprint|api)\.(get|post|put|patch|delete|route)\s*\(|\b(app|router)\.(get|post|put|patch|delete|use)\s*\(\s*['"`]|@(Get|Post|Put|Patch|Delete|RequestMapping|GetMapping|PostMapping)\b/;
const ENV = /os\.environ|os\.getenv|process\.env\.|getenv\(|ENV\[/;

type F = { path: string; status: string; sections: (Section & { tags?: Tag[] })[] };
// What changes for the code's users: signatures and removals of public functions, endpoints, environment variables,
// migrations, dependencies and configuration. At most 60 items.
export function surfaceOf(files: F[]): Surface[] {
  const out: Surface[] = [];
  for (const f of files) {
    if (isTest(f.path)) continue;
    if (MIGRATION.test(f.path)) { out.push({ kind: 'migration', path: f.path, text: f.status }); continue; }
    if (DEPS.test(f.path)) { out.push({ kind: 'deps', path: f.path, text: f.status }); continue; }
    if (CONFIG.test(f.path)) out.push({ kind: 'config', path: f.path, text: f.status });
    for (const s of f.sections) {
      const pub = !(short(s.name) ?? '_').startsWith('_');
      const tags = s.tags ?? tagSection(s);
      if (pub && tags.includes('signature')) { const l = s.lines.find(l => l.k === '+' && l.t.includes(short(s.name)!)); out.push({ kind: 'signature', path: f.path, line: l?.n, text: (l?.t ?? s.name).trim() }); }
      if (pub && tags.includes('removed') && s.kind !== 'module' && s.kind !== 'hunk') out.push({ kind: 'removed', path: f.path, line: s.first, text: s.name });
      for (const l of s.lines) {
        if (l.k !== '+') continue;
        if (ROUTE.test(l.t)) out.push({ kind: 'endpoint', path: f.path, line: l.n, text: l.t.trim() });
        else if (ENV.test(l.t)) out.push({ kind: 'env', path: f.path, line: l.n, text: l.t.trim() });
      }
    }
  }
  return out.map(x => ({ ...x, text: x.text.slice(0, 160) })).slice(0, 60);
}
