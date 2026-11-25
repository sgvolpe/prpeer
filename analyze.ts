import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseDiff } from './diff.ts';
import { buildSections, type Sym } from './sections.ts';
import { pairFunctionTests, surfaceOf, tagSection } from './classify.ts';
import { buildGraph, pairTests, resolveImports, type Imp } from './graph.ts';
import { CODE_NOISE, indexRepo, langOf, resolveRef, templateRefs } from './langs.ts';
import { analyzeTs, isTsFile, parseTsconfig, resolveSpec, specsOf, type TsConfig } from './tslang.ts';
import { changelog, isPlainFile, readPlain, readmes } from './context.ts';
import { resolveMood } from './mood.ts';

export type AnalyzeOpts = {
  repo: string; // folder of a clone that already holds the base and head objects
  title: string;
  baseRef: string; // base ref or sha
  head: string; // head sha or ref
  maxLinks?: number;
  moodCfg?: unknown; // `mood` from the user's config
  keep?: boolean; // keep the worktree when done
};

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // root commit: compared against the empty tree
const PYTHON = ['python3', 'python'].find(c => { try { execFileSync(c, ['-c', '1'], { stdio: 'ignore' }); return true; } catch { return false; } });
const SKIP_TS = /(^|\/)(node_modules|dist|build|coverage|\.next|vendor)\/|\.min\.[cm]?js$/;
type PyInfo = { symbols?: Sym[]; imports?: Imp[]; doc?: string | null; total?: number; error?: string };

// Given a base/head pair from a clone: temporary head worktree, diff, per-function sections, import graph,
// READMEs, changelog and mood rules. Returns the full payload and how to remove the worktree.
export function analyze(o: AnalyzeOpts) {
  const git = (...a: string[]) => execFileSync('git', a, { cwd: o.repo, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const base = git('rev-parse', '--verify', o.baseRef);
  const head = git('rev-parse', '--verify', o.head);
  const dir = mkdtempSync(join(tmpdir(), 'prpeer-'));
  const cleanup = () => { if (!o.keep) { try { git('worktree', 'remove', '--force', dir); } catch { /* already gone */ } } };
  try {
    git('worktree', 'add', '--detach', dir, head);
    const diffs = parseDiff(git('-c', 'core.quotepath=off', 'diff', '--no-color', '-U0', '-M', base === EMPTY_TREE ? `${base}..${head}` : `${base}...${head}`));
    // per-function/class sections and import graph: Python (with python3) and JS/TS (with the TypeScript parser);
    // every other language falls back to git's @@ header
    const tracked = git('ls-tree', '-r', '--name-only', head).split('\n');
    const allPy = PYTHON ? tracked.filter(p => p.endsWith('.py') && isPlainFile(join(dir, p))) : []; // no symlinks
    const allTs = tracked.filter(p => isTsFile(p) && !SKIP_TS.test(p));
    const info: Record<string, PyInfo> = {};
    for (let i = 0; i < allPy.length; i += 80) // in batches: Windows caps the command-line length
      Object.assign(info, JSON.parse(execFileSync(PYTHON!, [join(import.meta.dirname, 'pysections.py'), ...allPy.slice(i, i + 80).map(p => join(dir, p))], { encoding: 'utf8', maxBuffer: 1 << 28 })));
    const at = (p: string) => info[join(dir, p)];
    const pySet = new Set(allPy);
    const targets: Record<string, string[]> = Object.fromEntries(allPy.filter(p => at(p)?.imports).map(p => [p, resolveImports(p, at(p).imports!, pySet)]));
    // JS/TS: imports are scanned for every file (fast) and only what changed is analyzed in depth
    const tsSet = new Set(allTs), isChangedTs = new Set(diffs.filter(f => f.status !== 'deleted' && tsSet.has(f.path)).map(f => f.path));
    const cfgs = new Map<string, TsConfig>();
    for (const p of tracked.filter(p => /(^|\/)[tj]sconfig\.json$/.test(p))) {
      try { const c = parseTsconfig(p, readPlain(join(dir, p)) ?? ''); if (c) cfgs.set(dirname(p).replace(/^\.$/, ''), c); } catch { /* unreadable tsconfig: no aliases */ }
    }
    const cfgFor = (p: string) => { for (let d = dirname(p).replace(/^\.$/, ''); ; d = dirname(d).replace(/^\.$/, '')) { if (cfgs.has(d)) return cfgs.get(d); if (d === '') return undefined; } };
    for (const p of allTs) {
      let text: string;
      const t = readPlain(join(dir, p)); if (t === undefined) continue; text = t;
      targets[p] = specsOf(text).map(s => resolveSpec(p, s, tsSet, cfgFor(p))).filter((x): x is string => !!x);
      if (isChangedTs.has(p)) { try { info[join(dir, p)] = analyzeTs(p, text); } catch (e) { info[join(dir, p)] = { error: (e as Error).message }; } }
    }
    pairTests([...allPy, ...allTs], targets);
    // Every language in langs.ts (Terraform, shell, SQL, Markdown, YAML, HTML, CSS, Dockerfile, Go, Java…): named sections and references between files
    // (templates, static files, modules, COPY…). Python views also point at their templates.
    const ix = indexRepo(tracked.filter(p => !CODE_NOISE.test(p)));
    const changedSet = new Set(diffs.filter(f => f.status !== 'deleted').map(f => f.path));
    const isLang = (p: string) => !pySet.has(p) && !tsSet.has(p) && !CODE_NOISE.test(p) && !!langOf(p);
    const hasTemplates = [...ix.byBase.keys()].some(b => /\.(html?|jinja2?|j2)$/.test(b));
    for (const p of [...tracked.filter(isLang), ...(hasTemplates ? tracked.filter(p => p.endsWith('.py') && !CODE_NOISE.test(p)) : [])]) {
      let text: string;
      const t = readPlain(join(dir, p)); if (t === undefined) continue; text = t;
      const lang = langOf(p);
      const refs = lang ? lang.refs?.(text, p) ?? [] : templateRefs(text);
      if (refs.length) targets[p] = [...new Set([...(targets[p] ?? []), ...refs.flatMap(r => resolveRef(p, r, ix, changedSet))])].filter(t => t !== p);
      if (lang && changedSet.has(p)) {
        try { info[join(dir, p)] = { ...lang.analyze(text), total: text.split('\n').length - (text.endsWith('\n') ? 1 : 0) }; }
        catch (e) { info[join(dir, p)] = { error: (e as Error).message }; }
      }
    }
    const changed = diffs.filter(f => f.status !== 'deleted' && (pySet.has(f.path) || tsSet.has(f.path) || isLang(f.path))).map(f => f.path);
    const graph = buildGraph(changed, targets, o.maxLinks ?? 8);
    const files = diffs.map(f => {
      const r = at(f.path);
      const sections = buildSections(f, r?.symbols).map(s => ({ ...s, tags: tagSection(s) }));
      return { ...f, doc: r?.doc ?? null, total: r?.total, parseError: r?.error, sections, hunks: f.hunks.map(({ lines: _l, ...h }) => h) };
    });
    pairFunctionTests(files, names => {
      try { return git('-C', dir, '-c', 'core.quotepath=off', 'grep', '-n', '-I', '-w', '-F', ...names.flatMap(n => ['-e', n]), '--', '.'); }
      catch (e) { if ((e as { status?: number }).status === 1) return ''; throw e; } // 1 = no match
    });
    // mood: defaults < user config < the repo's .prpeer.json. Read from the BASE (already merged), not the PR head:
    // the regexes run in the browser and a PR must not be able to bring its own.
    let repoMood: unknown;
    try { repoMood = (JSON.parse(git('show', `${base}:.prpeer.json`)) as { mood?: unknown }).mood; } catch { /* the repo has no .prpeer.json */ }
    const mood = resolveMood({ src: 'defaults' }, { src: 'config', cfg: o.moodCfg }, { src: '.prpeer.json (rama base)', cfg: repoMood });
    const cl = files.find(f => /(^|\/)CHANGELOG\.md$/i.test(f.path) && f.status !== 'deleted');
    const payload = {
      title: o.title, base: { ref: o.baseRef, sha: base }, head, worktree: dir, files, ...graph, surface: surfaceOf(files),
      readmes: readmes(dir, [...files.map(f => f.path), ...graph.linked.map(l => l.path)]),
      mood,
      changelog: cl ? changelog(readPlain(join(dir, cl.path)) ?? '') : null,
    };
    return { payload, dir, hasPython: !!PYTHON, cleanup };
  } catch (e) { cleanup(); throw e; }
}
