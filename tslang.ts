import ts from 'typescript'; // pinned to 5.x: 7 (native) does not ship this JS API
import { posix } from 'node:path';
import type { Sym } from './sections.ts';

export const TS_EXT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
export const isTsFile = (p: string) => TS_EXT.some(e => p.endsWith(e)) && !p.endsWith('.d.ts');
const kindOf = (p: string) => p.endsWith('.tsx') ? ts.ScriptKind.TSX : p.endsWith('.jsx') ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(p) ? ts.ScriptKind.JS : ts.ScriptKind.TS;

const nameOf = (n?: ts.PropertyName | ts.BindingName) => n && (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isPrivateIdentifier(n)) ? n.text : '[computed]';
const isFnInit = (e?: ts.Expression): e is ts.ArrowFunction | ts.FunctionExpression | ts.ClassExpression => !!e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e) || ts.isClassExpression(e));

// Functions, classes, methods, types and enums of a JS/TS file, with their line range and JSDoc.
// Diff sections are assigned among them the same way as with Python (the innermost wins).
export function analyzeTs(path: string, text: string): { symbols: Sym[]; doc: string | null; total: number } {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kindOf(path));
  const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const jsdoc = (n: ts.Node) => (ts.getLeadingCommentRanges(text, n.getFullStart()) ?? []).filter(r => text.startsWith('/**', r.pos)).at(-1);
  const clean = (r: ts.CommentRange) => text.slice(r.pos + 3, r.end - 2).split('\n').map(l => l.replace(/^\s*\*? ?/, '')).join('\n').trim().slice(0, 1500) || null;
  const symbols: Sym[] = [];
  const add = (name: string, kind: string, n: ts.Node) => {
    const d = jsdoc(n);
    symbols.push({ name, kind, start: line(d ? d.pos : n.getStart(sf)), end: line(n.getEnd()), doc: d ? clean(d) : null });
  };
  const members = (c: ts.ClassLikeDeclaration, nm: string) => {
    for (const m of c.members) {
      if (ts.isConstructorDeclaration(m)) { add(`${nm}.constructor`, 'method', m); m.body && ts.forEachChild(m.body, x => visit(x, `${nm}.constructor.`)); }
      else if (ts.isMethodDeclaration(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m)) { const mn = `${nm}.${nameOf(m.name)}`; add(mn, 'method', m); m.body && ts.forEachChild(m.body, x => visit(x, mn + '.')); }
      else if (ts.isPropertyDeclaration(m) && isFnInit(m.initializer)) { const mn = `${nm}.${nameOf(m.name)}`; add(mn, 'method', m); ts.forEachChild(m.initializer, x => visit(x, mn + '.')); }
    }
  };
  function visit(n: ts.Node, prefix: string) {
    if (ts.isFunctionDeclaration(n)) { // overload signatures share their name with the implementation: their sections are merged
      const nm = prefix + (n.name?.text ?? 'default');
      add(nm, 'fn', n);
      if (n.body) ts.forEachChild(n.body, x => visit(x, nm + '.'));
      return;
    }
    if (ts.isClassDeclaration(n)) { const nm = prefix + (n.name?.text ?? 'default'); add(nm, 'class', n); members(n, nm); return; }
    if (ts.isInterfaceDeclaration(n)) { add(prefix + n.name.text, 'interface', n); return; }
    if (ts.isTypeAliasDeclaration(n)) { add(prefix + n.name.text, 'type', n); return; }
    if (ts.isEnumDeclaration(n)) { add(prefix + n.name.text, 'enum', n); return; }
    if (ts.isModuleDeclaration(n)) { const nm = prefix + n.name.text; add(nm, 'namespace', n); if (n.body) visit(n.body, nm + '.'); return; }
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !isFnInit(d.initializer)) continue;
        const nm = prefix + d.name.text, single = n.declarationList.declarations.length === 1;
        add(nm, ts.isClassExpression(d.initializer) ? 'class' : 'fn', single ? n : d);
        if (ts.isClassExpression(d.initializer)) members(d.initializer, nm); else ts.forEachChild(d.initializer, x => visit(x, nm + '.'));
      }
      return;
    }
    if (ts.isExportAssignment(n) && isFnInit(n.expression)) { // export default () => …
      const nm = prefix + 'default';
      add(nm, ts.isClassExpression(n.expression) ? 'class' : 'fn', n);
      if (ts.isClassExpression(n.expression)) members(n.expression, nm); else ts.forEachChild(n.expression, x => visit(x, nm + '.'));
      return;
    }
    ts.forEachChild(n, x => visit(x, prefix));
  }
  visit(sf, '');

  // module docstring: a /** */ at the top separated from the code by a blank line (or with @file/@module)
  const off = ts.getShebang(text)?.length ?? 0;
  const top = ts.getLeadingCommentRanges(text, off)?.find(r => text.startsWith('/**', r.pos));
  let doc: string | null = null;
  if (top) {
    const gap = /^\s*/.exec(text.slice(top.end))![0];
    if ((gap.match(/\n/g) ?? []).length >= 2 || /@(file|fileoverview|module)\b/.test(text.slice(top.pos, top.end))) doc = clean(top);
  }
  return { symbols, doc, total: text.split('\n').length - (text.endsWith('\n') ? 1 : 0) };
}

// Modules a file imports: import/export … from, require(), import() — fast scanner, without building the AST.
export const specsOf = (text: string) => ts.preProcessFile(text, true, true).importedFiles.map(f => f.fileName);

export type TsConfig = { dir: string; baseUrl?: string; paths: [string, string[]][] };
// shortcut: does not follow "extends"; aliases living in a base tsconfig are not resolved
export function parseTsconfig(file: string, text: string): TsConfig | null {
  const o = (ts.parseConfigFileTextToJson(file, text).config as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } } | undefined)?.compilerOptions;
  if (!o) return null;
  const dir = posix.dirname(file);
  return { dir, baseUrl: o.baseUrl ? posix.join(dir, o.baseUrl) : undefined, paths: Object.entries(o.paths ?? {}) };
}

const candidates = (b: string) => {
  const out = [b];
  const m = /\.(js|jsx|mjs|cjs)$/.exec(b); // TS ESM: './a.js' points to a.ts
  if (m) out.push(...(m[1] === 'js' ? ['.ts', '.tsx'] : m[1] === 'jsx' ? ['.tsx'] : m[1] === 'mjs' ? ['.mts'] : ['.cts']).map(e => b.slice(0, -m[0].length) + e));
  out.push(...TS_EXT.map(e => b + e), ...TS_EXT.map(e => posix.join(b, 'index' + e)));
  return out;
};

// Repo file a specifier points to: relative paths and tsconfig aliases (paths / baseUrl). Packages are ignored.
export function resolveSpec(from: string, spec: string, all: Set<string>, cfg?: TsConfig): string | undefined {
  const bases: string[] = [];
  if (spec.startsWith('.')) bases.push(posix.join(posix.dirname(from), spec));
  else if (cfg) {
    for (const [pat, targets] of cfg.paths) {
      const star = pat.indexOf('*');
      const hit = star < 0 ? spec === pat : spec.length >= pat.length - 1 && spec.startsWith(pat.slice(0, star)) && spec.endsWith(pat.slice(star + 1));
      if (!hit) continue;
      const mid = star < 0 ? '' : spec.slice(star, spec.length - (pat.length - star - 1));
      for (const t of targets) bases.push(posix.join(cfg.baseUrl ?? cfg.dir, t.replace('*', mid)));
    }
    if (cfg.baseUrl) bases.push(posix.join(cfg.baseUrl, spec));
  }
  for (const b of bases) for (const c of candidates(b)) if (c !== from && all.has(c)) return c;
}
