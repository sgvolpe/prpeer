import { posix } from 'node:path';
import type { Sym } from './sections.ts';

// "Structural" languages with no dependencies: Terraform/HCL, shell, SQL, Markdown, YAML, HTML/templates, CSS and Dockerfile.
// Each one provides (a) named sections to split the diff and (b) references to other files for the graph.
// They are lightweight analyzers (not full grammars): see each one's "shortcut" notes.
export type LangInfo = { symbols: Sym[]; doc: string | null };
export type Ref = { spec: string; mode: 'rel' | 'suffix' | 'dir' };
export type Lang = { id: string; match(path: string): boolean; analyze(text: string): LangInfo; refs?(text: string, path: string): Ref[] };

const countLines = (t: string) => t.split('\n').length - (t.endsWith('\n') ? 1 : 0);
const lineStarts = (t: string) => { const s = [0]; for (let i = 0; i < t.length; i++) if (t[i] === '\n') s.push(i + 1); return s; };
const lineOf = (starts: number[], idx: number) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= idx) lo = m; else hi = m - 1; } return lo + 1; };
const squash = (s: string, n = 90) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// Comments directly above line `line` (1-based), with no blank line in between.
function docAbove(lines: string[], line: number, marker: RegExp): string | null {
  const out: string[] = [];
  for (let i = line - 2; i >= 0 && marker.test(lines[i]); i--) out.unshift(lines[i].replace(marker, '').trim());
  return out.join('\n').trim().slice(0, 1500) || null;
}

// ---- mask: same text with comments, string contents and heredocs replaced by spaces (newlines are kept),
// so braces and semicolons can be searched for without being fooled by what is inside a comment or a string.
type MaskCfg = { line?: string[]; block?: [string, string][]; quotes?: string[]; heredoc?: boolean; dollar?: boolean; interp?: boolean; noEscape?: boolean };
export function mask(text: string, c: MaskCfg): string {
  const n = text.length, out = text.split('');
  const blank = (a: number, b: number) => { for (let k = Math.max(a, 0); k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  const skipCode = (i0: number): number => { // inside ${ … } (HCL): up to the } that closes it, with nested strings
    let i = i0, depth = 1;
    while (i < n && depth > 0) {
      const ch = text[i];
      if (ch === '"') { i = skipStr(i, ch); continue; }
      if (ch === '{') depth++; else if (ch === '}') depth--;
      i++;
    }
    return i;
  };
  const skipStr = (i0: number, q: string): number => { // returns the index after the closing quote
    let i = i0 + 1;
    while (i < n) {
      const ch = text[i];
      if (ch === '\\' && !c.noEscape) { i += 2; continue; }
      if (c.interp && ch === '$' && text[i + 1] === '{') { i = skipCode(i + 2); continue; }
      if (ch === q) return i + 1;
      i++;
    }
    return n;
  };
  let i = 0, pending: string | undefined;
  while (i < n) {
    const ch = text[i];
    if (ch === '\n') {
      if (pending) { // heredoc body: up to a line that is only the marker
        let j = i + 1;
        for (;;) {
          const e = text.indexOf('\n', j), ln = text.slice(j, e < 0 ? n : e);
          if (ln.trim() === pending) { blank(i + 1, j); i = j; break; }
          if (e < 0) { blank(i + 1, n); i = n; break; }
          j = e + 1;
        }
        pending = undefined;
        continue;
      }
      i++;
      continue;
    }
    const b = c.block?.find(([o]) => text.startsWith(o, i));
    if (b) { const e = text.indexOf(b[1], i + b[0].length), end = e < 0 ? n : e + b[1].length; blank(i, end); i = end; continue; }
    const l = c.line?.find(s => text.startsWith(s, i));
    if (l && (l !== '#' || i === 0 || /[\s;]/.test(text[i - 1]))) { const e = text.indexOf('\n', i), end = e < 0 ? n : e; blank(i, end); i = end; continue; }
    if (c.dollar && ch === '$') {
      const m = /^\$([A-Za-z_]\w*)?\$/.exec(text.slice(i, i + 40));
      if (m) { const e = text.indexOf(m[0], i + m[0].length); blank(i + m[0].length, e < 0 ? n : e); i = e < 0 ? n : e + m[0].length; continue; }
    }
    if (c.quotes?.includes(ch)) { const end = skipStr(i, ch); blank(i + 1, end - 1); i = end; continue; }
    if (c.heredoc && ch === '<' && !text.startsWith('<<<', i)) {
      const m = /^<<-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(text.slice(i, i + 80));
      if (m) { pending = m[2]; i += m[0].length; continue; }
    }
    i++;
  }
  return out.join('');
}

// Top-level `header { … }` blocks. The header is the brace's line (plus the previous ones if they end in a comma, or the
// previous one if the brace is alone) and must pass `isHeader`; other braces only count depth.
type Span = { header: string; start: number; end: number };
// `level`: brace depth of the blocks to return (0 = top level; 1 = members of a class or a C# namespace)
function topBlocks(text: string, masked: string, isHeader: (h: string) => boolean, skipDollarBrace = false, level = 0): Span[] {
  const starts = lineStarts(text), orig = text.split('\n'), mk = masked.split('\n');
  const spans: Span[] = [];
  let depth = 0, cur: { header: string; start: number } | undefined;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '{') {
      if (skipDollarBrace && masked[i - 1] === '$') { // ${var}: not a block
        let d = 1; i++;
        while (i < masked.length && d > 0) { if (masked[i] === '{') d++; else if (masked[i] === '}') d--; i++; }
        i--;
        continue;
      }
      if (depth === level) {
        const ln = lineOf(starts, i);
        let hl = ln, h = mk[ln - 1].slice(0, i - starts[ln - 1]);
        if (!h.trim()) { hl = ln - 1; while (hl > 1 && !mk[hl - 1].trim()) hl--; h = mk[hl - 1] ?? ''; }
        while (hl > 1 && /,\s*$/.test(mk[hl - 2])) { hl--; h = mk[hl - 1] + ' ' + h; }
        const ok = isHeader(h.trim());
        cur = ok ? { header: orig[hl - 1].trim(), start: hl } : undefined;
        if (ok && hl === ln) cur.header = orig[ln - 1].slice(0, i - starts[ln - 1]).trim();
      }
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === level && cur) { spans.push({ ...cur, end: lineOf(starts, i) }); cur = undefined; }
    }
  }
  return spans;
}

// ---- Markdown: one section per heading (with the path of parent headings) up to the next heading of the same or higher level
const markdown: Lang = {
  id: 'markdown', match: p => /\.(md|markdown)$/i.test(p),
  analyze(text) {
    const lines = text.split('\n'), total = countLines(text);
    const heads: { level: number; title: string; line: number }[] = [];
    let fence = '';
    lines.forEach((l, i) => {
      const f = /^\s*(`{3,}|~{3,})/.exec(l);
      if (f) { if (!fence) fence = f[1][0]; else if (l.trim().startsWith(fence.repeat(3))) fence = ''; return; }
      if (fence) return;
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
      if (m) heads.push({ level: m[1].length, title: m[2], line: i + 1 });
    });
    const stack: typeof heads = [], symbols: Sym[] = [];
    heads.forEach((h, idx) => {
      while (stack.length && stack.at(-1)!.level >= h.level) stack.pop();
      stack.push(h);
      const next = heads.slice(idx + 1).find(x => x.level <= h.level);
      symbols.push({ name: squash(stack.map(s => s.title).join(' > '), 100), kind: 'heading', start: h.line, end: next ? next.line - 1 : total, doc: null });
    });
    return { symbols, doc: null };
  },
  refs: (text, from) => [...text.matchAll(/\]\(\s*<?([^)\s>#?]+)/g)].map(m => m[1]).filter(s => !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(s)).map(spec => ({ spec, mode: 'rel' as const })),
};

// ---- shell: functions (`f() {` or `function f {`). shortcut: a heredoc or string with unbalanced braces can shift the end
const SHELL_MASK: MaskCfg = { line: ['#'], quotes: ["'", '"'], heredoc: true };
const shell: Lang = {
  id: 'shell', match: p => /\.(sh|bash)$/.test(p),
  analyze(text) {
    const lines = text.split('\n');
    const spans = topBlocks(text, mask(text, SHELL_MASK), h => /^(?:function\s+[A-Za-z_][\w:.-]*\s*(?:\(\s*\))?|[A-Za-z_][\w:.-]*\s*\(\s*\))$/.test(h), true);
    const symbols = spans.map(s => {
      const m = /^(?:function\s+)?([A-Za-z_][\w:.-]*)/.exec(s.header)!;
      return { name: m[1], kind: 'fn', start: s.start, end: s.end, doc: docAbove(lines, s.start, /^\s*#\s?/) };
    });
    const head = /^#!.*\n((?:#.*\n)+)\s*\n/.exec(text)?.[1]; // comment block after the shebang
    return { symbols, doc: head ? head.replace(/^#\s?/gm, '').trim().slice(0, 1500) : null };
  },
  refs: (text) => {
    const m = mask(text, SHELL_MASK), out: Ref[] = [];
    for (const x of m.matchAll(/(?:^|[;&|(]|\s)(?:source|\.)\s+["']?([^\s"';&|)]+)/gm)) out.push({ spec: x[1], mode: 'rel' });
    for (const x of text.matchAll(/(?:^|[\s;&|(])((?:\.{1,2}\/|[\w.-]+\/)[\w./-]*\.(?:sh|py|bash))\b/gm)) out.push({ spec: x[1], mode: 'rel' });
    return [...new Map(out.map(r => [r.spec, r])).values()];
  },
};

// ---- Terraform/HCL: one top-level block per section (resource.type.name, module.x, var.x…)
const HCL_MASK: MaskCfg = { line: ['#', '//'], block: [['/*', '*/']], quotes: ['"'], heredoc: true, interp: true };
const hcl: Lang = {
  id: 'hcl', match: p => /\.(tf|tfvars|hcl)$/.test(p),
  analyze(text) {
    const lines = text.split('\n');
    const spans = topBlocks(text, mask(text, HCL_MASK), h => /^[A-Za-z_][\w-]*(?:\s+"[^"]*")*$/.test(h));
    const symbols = spans.map(s => {
      const [kind, ...labels] = [...s.header.matchAll(/[A-Za-z_][\w-]*|"([^"]*)"/g)].map(m => m[1] ?? m[0]);
      const name = kind === 'variable' ? `var.${labels[0]}` : kind === 'resource' ? labels.join('.') : kind === 'locals' || kind === 'terraform' ? kind : [kind, ...labels].join('.');
      return { name: name || kind, kind, start: s.start, end: s.end, doc: docAbove(lines, s.start, /^\s*(?:#|\/\/)\s?/) };
    });
    return { symbols, doc: null };
  },
  refs: (text) => {
    const m = mask(text, { ...HCL_MASK, quotes: [] }), out: Ref[] = []; // comments are masked but strings are not
    for (const x of m.matchAll(/\bsource\s*=\s*"(\.{1,2}\/[^"]*)"/g)) out.push({ spec: x[1], mode: 'dir' });
    for (const x of m.matchAll(/\b(?:file|templatefile|filebase64)\(\s*"(?:\$\{path\.module\}\/)?([^"$]+)"/g)) out.push({ spec: x[1], mode: 'rel' });
    // AWS: Lambda code and archives (filename, archive_file source_dir/source_file) and user-data scripts
    for (const x of m.matchAll(/\b(?:filename|source_dir|source_file|user_data_file)\s*=\s*"(?:\$\{path\.module\}\/)?([^"$]+)"/g)) out.push({ spec: x[1], mode: 'rel' });
    return out;
  },
};

// ---- SQL: one section per statement (create function public.f, alter table t, insert t…). Splits on `;` outside strings,
// comments and $$ … $$ bodies
const SQL_MASK: MaskCfg = { line: ['--'], block: [['/*', '*/']], quotes: ["'", '"'], dollar: true, noEscape: true };
const sql: Lang = {
  id: 'sql', match: p => /\.sql$/i.test(p),
  analyze(text) {
    const m = mask(text, SQL_MASK), starts = lineStarts(text), lines = text.split('\n'), symbols: Sym[] = [];
    const cut = [...[...m.matchAll(/;/g)].map(x => x.index!), m.length];
    let from = 0;
    for (const e of cut) {
      const seg = m.slice(from, e), lead = seg.search(/\S/);
      if (lead >= 0) {
        const a = from + lead, start = lineOf(starts, a), end = lineOf(starts, Math.max(a, e - (e < m.length ? 0 : 1)));
        const src = text.slice(a, e).replace(/\s+/g, ' ');
        const d = /^(create(?:\s+or\s+replace)?|alter|drop)\s+(?:(?:unique|materialized|temp(?:orary)?|unlogged|recursive)\s+)*(table|view|function|procedure|index|trigger|type|schema|extension|sequence|policy|role|domain|constraint)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:only\s+)?([\w."]+)/i.exec(src);
        const o = /^(insert\s+into|update|delete\s+from|alter\s+table(?:\s+only)?|grant|revoke|comment\s+on\s+\w+|truncate(?:\s+table)?|select|with|set)\s+(?:if\s+exists\s+)?([\w."]+)?/i.exec(src);
        const name = d ? `${d[1].toLowerCase().replace(/\s+or\s+replace/, '')} ${d[2].toLowerCase()} ${d[3]}` : o ? `${o[1].toLowerCase().replace(/\s+/g, ' ')} ${o[2] ?? ''}`.trim() : squash(src, 40);
        symbols.push({ name, kind: d ? d[2].toLowerCase() : 'statement', start, end, doc: docAbove(lines, start, /^\s*--\s?/) });
      }
      from = e + 1;
    }
    return { symbols, doc: null };
  },
};

// Keys of an indented file (YAML, JSON): the root keys (indent `rootInd`) and, below them, second-level keys (services.api, scripts.build…).
// `skip`: lines that do not count as content when trimming the end of a section
type KeyLine = { i: number; ind: number; key: string };
function keySections(lines: string[], total: number, kl: KeyLine[], rootInd: number, skip: (l: string) => boolean): Sym[] {
  const endBefore = (nextI: number) => { let e = nextI; while (e > 0 && skip(lines[e - 1])) e--; return Math.max(e, 1); };
  const symbols: Sym[] = [];
  const top = kl.filter(k => k.ind === rootInd);
  top.forEach((t, ti) => {
    const nextTop = top[ti + 1]?.i ?? total;
    const end = endBefore(nextTop);
    symbols.push({ name: t.key, kind: 'key', start: t.i + 1, end: Math.max(end, t.i + 1), doc: docAbove(lines, t.i + 1, /^\s*#\s?/) });
    const kids = kl.filter(k => k.i > t.i && k.i < nextTop && k.ind > rootInd);
    const ci = kids[0]?.ind;
    const sib = kids.filter(k => k.ind === ci);
    sib.forEach((s, si) => symbols.push({ name: `${t.key}.${s.key}`, kind: 'key', start: s.i + 1, end: Math.max(endBefore(sib[si + 1]?.i ?? nextTop), s.i + 1), doc: docAbove(lines, s.i + 1, /^\s*#\s?/) }));
  });
  return symbols;
}

// ---- YAML: top-level keys and, below them, second-level keys (services.api, jobs.build…)
const yaml: Lang = {
  id: 'yaml', match: p => /\.ya?ml$/.test(p),
  analyze(text) {
    const lines = text.split('\n'), total = countLines(text);
    const key = /^(\s*)("[^"]+"|'[^']+'|[\w.\-/@]+)\s*:(?:\s|$)/;
    const skip = (l: string) => !l.trim() || /^\s*#/.test(l);
    const kl: KeyLine[] = [];
    lines.forEach((l, i) => { if (skip(l) || /^\s*-/.test(l) || l.startsWith('---')) return; const m = key.exec(l); if (m) kl.push({ i, ind: m[1].length, key: m[2].replace(/^["']|["']$/g, '') }); });
    return { symbols: keySections(lines, total, kl, 0, skip), doc: null };
  },
};

// ---- JSON: the keys of the root object and their second-level keys (package.json scripts.build, tsconfig compilerOptions…).
// shortcut: needs pretty-printed JSON (one key per line); a root array or a one-line file gives no sections; lock files are skipped
const json: Lang = {
  id: 'json', match: p => /\.json$/i.test(p) && !/(^|\/)(package-lock|npm-shrinkwrap)\.json$|\.min\.json$/i.test(p),
  analyze(text) {
    if (/^\s*\[/.test(text)) return { symbols: [], doc: null };
    const lines = text.split('\n'), kl: KeyLine[] = [];
    lines.forEach((l, i) => { const m = /^(\s*)"((?:[^"\\]|\\.)*)"\s*:/.exec(l); if (m) kl.push({ i, ind: m[1].length, key: m[2] }); });
    const root = Math.min(...kl.map(k => k.ind));
    return { symbols: keySections(lines, countLines(text), kl, root, l => !l.trim() || /^[}\]],?\s*$/.test(l)), doc: null };
  },
};

// ---- TOML: one section per [table] / [[array of tables]] (tool.poetry.dependencies, dependencies…).
// shortcut: keys before the first table are not a section
const toml: Lang = {
  id: 'toml', match: p => /\.toml$/i.test(p),
  analyze(text) {
    const lines = text.split('\n'), total = countLines(text), heads: { i: number; name: string }[] = [];
    let str = '';
    lines.forEach((l, i) => {
      if (str) { if (l.includes(str)) str = ''; return; } // inside a multi-line string
      const q = /("""|''')/.exec(l);
      if (q && l.split(q[1]).length % 2 === 0) { str = q[1]; return; }
      const m = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/.exec(l);
      if (m) heads.push({ i, name: m[1].replace(/\s+/g, '') });
    });
    return { symbols: heads.map((h, n) => {
      let e = heads[n + 1]?.i ?? total; while (e > h.i + 1 && !lines[e - 1].trim()) e--;
      return { name: h.name, kind: 'table', start: h.i + 1, end: Math.max(e, h.i + 1), doc: docAbove(lines, h.i + 1, /^\s*#\s?/) };
    }), doc: null };
  },
};

// ---- Makefile: one section per target (its recipe up to the next target). shortcut: variables between targets stay in the previous one
const makefile: Lang = {
  id: 'make', match: p => /(^|\/)(GNUmakefile|[Mm]akefile)$|\.mk$/.test(p),
  analyze(text) {
    const lines = text.split('\n'), total = countLines(text), heads: { i: number; name: string }[] = [];
    lines.forEach((l, i) => {
      const m = /^([\w.%/$()-]+(?:\s+[\w.%/$()-]+)*)\s*:(?![:=])/.exec(l);
      if (m && !/^\.(PHONY|SUFFIXES|DEFAULT|PRECIOUS|INTERMEDIATE|SECONDARY|DELETE_ON_ERROR)\b/.test(m[1])) heads.push({ i, name: squash(m[1], 50) });
    });
    return { symbols: heads.map((h, n) => {
      let e = heads[n + 1]?.i ?? total; while (e > h.i + 1 && (!lines[e - 1].trim() || /^#/.test(lines[e - 1]))) e--;
      return { name: h.name, kind: 'target', start: h.i + 1, end: Math.max(e, h.i + 1), doc: docAbove(lines, h.i + 1, /^\s*#\s?/) };
    }), doc: null };
  },
  refs: text => [...text.matchAll(/^-?(?:s?include)\s+(.+)$/gm)].flatMap(m => m[1].split(/\s+/)).filter(s => s && !s.includes('$')).map(spec => ({ spec, mode: 'rel' as const })),
};

// ---- Dockerfile: one section per stage (FROM). References are the files it copies (COPY/ADD)
const dockerfile: Lang = {
  id: 'dockerfile', match: p => /(^|\/)Dockerfile(\..+)?$/.test(p) || /\.dockerfile$/i.test(p),
  analyze(text) {
    const lines = text.split('\n'), total = countLines(text);
    const froms = lines.map((l, i) => [/^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(l), i] as const).filter(([m]) => m);
    const symbols = froms.map(([m, i], n) => {
      let e = (froms[n + 1]?.[1] ?? total) ; while (e > i + 1 && (!lines[e - 1].trim() || /^\s*#/.test(lines[e - 1]))) e--;
      return { name: m![2] ? `stage ${m![2]}` : `stage ${n + 1} (${m![1]})`, kind: 'stage', start: i + 1, end: Math.max(e, i + 1), doc: docAbove(lines, i + 1, /^\s*#\s?/) };
    });
    return { symbols, doc: null };
  },
  refs: (text) => {
    const out: Ref[] = [];
    for (const m of text.matchAll(/^\s*(?:COPY|ADD)\s+((?:--\S+\s+)*)(.+)$/gim)) {
      if (/--from=/i.test(m[1])) continue;
      const toks = m[2].trim().replace(/^\[|\]$/g, '').split(/[\s,]+/).map(t => t.replace(/^"|"$/g, '')).filter(Boolean);
      for (const t of toks.slice(0, -1)) if (t !== '.' && !/^[a-z]+:\/\//i.test(t) && !/[*?$]/.test(t)) out.push({ spec: t, mode: 'rel' });
    }
    return out;
  },
};

// ---- HTML / templates (Django, Jinja): {% block x %}, inline <script> and <style>, and landmarks (form, table, section…).
// References: extends/include/import, <script src>, <link href>, {% static %}. shortcut: assumes well-closed tags
const LANDMARKS = 'header|nav|main|section|form|table|footer|dialog|template|aside|article';
const html: Lang = {
  id: 'html', match: p => /\.(html?|jinja2?|j2|tmpl)$/i.test(p),
  analyze(text) {
    const m = text.replace(/<!--[\s\S]*?-->|\{#[\s\S]*?#\}/g, c => c.replace(/[^\n]/g, ' '));
    const starts = lineStarts(text), symbols: Sym[] = [];
    const open: { tag: string; name: string; kind: string; start: number }[] = [];
    const re = new RegExp(`\\{%-?\\s*(block|endblock)\\b\\s*([\\w-]*)[^%]*%\\}|<(/?)(script|style|${LANDMARKS})\\b([^>]*)>`, 'gi');
    for (let x; (x = re.exec(m));) {
      const line = lineOf(starts, x.index);
      if (x[1]?.toLowerCase() === 'block') open.push({ tag: 'block', name: `block ${x[2]}`, kind: 'block', start: line });
      else if (x[1]?.toLowerCase() === 'endblock') { const k = open.map(o => o.tag).lastIndexOf('block'); if (k >= 0) { const o = open.splice(k)[0]; symbols.push({ name: o.name, kind: o.kind, start: o.start, end: line, doc: null }); } }
      else if (x[4]) {
        const tag = x[4].toLowerCase(), attrs = x[5] ?? '';
        if (x[3]) { // closing tag
          const k = open.map(o => o.tag).lastIndexOf(tag);
          if (k >= 0) { const o = open.splice(k)[0]; symbols.push({ name: o.name, kind: o.kind, start: o.start, end: line, doc: null }); }
        } else if (tag === 'script' || tag === 'style') {
          const close = m.toLowerCase().indexOf(`</${tag}`, re.lastIndex), end = close < 0 ? m.length : close;
          if (!/\bsrc\s*=/i.test(attrs)) symbols.push({ name: tag, kind: tag, start: line, end: lineOf(starts, end), doc: null });
          re.lastIndex = close < 0 ? m.length : close;
        } else if (!/\/\s*$/.test(attrs)) {
          const id = /\bid\s*=\s*["']([^"']+)/i.exec(attrs)?.[1], cls = /\bclass\s*=\s*["']\s*([^\s"']+)/i.exec(attrs)?.[1];
          open.push({ tag, name: tag + (id ? `#${id}` : cls ? `.${cls}` : ''), kind: 'element', start: line });
        }
      }
    }
    return { symbols: symbols.sort((a, b) => a.start - b.start || b.end - a.end), doc: null };
  },
  refs: (text) => {
    const out: Ref[] = [];
    for (const x of text.matchAll(/\{%-?\s*(?:extends|include|import|from)\s+["']([^"']+)["']/g)) out.push({ spec: x[1], mode: 'suffix' });
    for (const x of text.matchAll(/\{%-?\s*static\s+["']([^"']+)["']/g)) out.push({ spec: x[1], mode: 'suffix' });
    for (const x of text.matchAll(/url_for\(\s*["']static["']\s*,\s*filename\s*=\s*["']([^"']+)["']/g)) out.push({ spec: x[1], mode: 'suffix' });
    for (const x of text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"'{]+)["']|<link\b[^>]*\bhref\s*=\s*["']([^"'{]+)["']/gi)) {
      const s = x[1] ?? x[2];
      if (!s || /^([a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(s)) continue;
      out.push(s.startsWith('/') ? { spec: s.replace(/^\/(?:static\/)?/, ''), mode: 'suffix' } : { spec: s.split(/[?#]/)[0], mode: 'rel' });
    }
    return out;
  },
};

// ---- CSS / SCSS / Less: one section per top-level rule or @-rule. shortcut: nested rules go inside their parent
const css: Lang = {
  id: 'css', match: p => /\.(css|scss|less)$/i.test(p) && !/\.min\.css$/i.test(p),
  analyze(text) {
    const lines = text.split('\n');
    const spans = topBlocks(text, mask(text, { block: [['/*', '*/']], quotes: ["'", '"'] }), h => h.length > 0 && !h.includes(';'));
    return { symbols: spans.map(s => ({ name: squash(s.header, 70), kind: s.header.startsWith('@') ? 'at-rule' : 'rule', start: s.start, end: s.end, doc: docAbove(lines, s.start, /^\s*\/\/\s?/) })), doc: null };
  },
  refs: (text) => [...mask(text, { block: [['/*', '*/']] }).matchAll(/@(?:import|use|forward)\s+(?:url\(\s*)?["']([^"')]+)/g)].map(x => ({ spec: x[1], mode: 'rel' as const })).filter(r => !/^(https?:)?\/\//.test(r.spec)),
};

// ---- brace languages (GraphQL, Protobuf, Go, Java, Kotlin, C#, PHP, Rust): one section per type and, inside it, per member.
// `cls` recognizes the header of a type (it holds members), `fn` the header of a function/method/message.
// shortcut: members are one level inside the type; a header split across lines without trailing commas is not seen
type Sig = { name: string; kind: string } | null;

// Comment above a declaration (`/** */`, `//`, `///`, `#`), skipping the annotations in between (@Foo, [Foo], #[foo]).
// `start` is the first line of that block, so a change in a doc or annotation lands in the section.
function docC(lines: string[], start: number): { start: number; doc: string | null } {
  let i = start - 2;
  while (i >= 0 && /^\s*(?:@\w[\w.]*(?:\(.*\))?|\[\w.*\]|#\[.*\])\s*$/.test(lines[i])) i--;
  const noDoc = { start: i + 2, doc: null };
  if (i < 0) return noDoc;
  if (/\*\/\s*$/.test(lines[i])) {
    let j = i; while (j > 0 && !lines[j].includes('/*')) j--;
    const doc = lines.slice(j, i + 1).map(l => l.replace(/^\s*(?:\/\*+|\*)\s?/, '').replace(/\s*\*+\/\s*$/, '')).join('\n').trim().slice(0, 1500);
    return { start: j + 1, doc: doc || null };
  }
  let j = i; while (j >= 0 && /^\s*(?:\/\/|#)/.test(lines[j])) j--;
  if (j === i) return noDoc;
  return { start: j + 2, doc: lines.slice(j + 1, i + 1).map(l => l.replace(/^\s*(?:\/\/\/?|#)\s?/, '')).join('\n').trim().slice(0, 1500) || null };
}

function braceSyms(text: string, mk: MaskCfg, cls: (h: string) => Sig, fn: (h: string) => Sig, base = 0): Sym[] {
  const masked = mask(text, mk), lines = text.split('\n'), symbols: Sym[] = [];
  const put = (s: Span, g: NonNullable<Sig>, prefix: string) => {
    const d = docC(lines, s.start);
    symbols.push({ name: prefix + g.name, kind: prefix && g.kind === 'fn' ? 'method' : g.kind, start: d.start, end: s.end, doc: d.doc });
  };
  const inner = topBlocks(text, masked, h => !!fn(h), false, base + 1);
  for (const s of topBlocks(text, masked, h => !!(cls(h) || fn(h)), false, base)) {
    const c = cls(s.header);
    if (!c) { put(s, fn(s.header)!, ''); continue; }
    put(s, c, '');
    for (const m of inner) if (m.start > s.start && m.end <= s.end) put(m, fn(m.header)!, c.name + '.');
  }
  return symbols;
}

const C_MASK: MaskCfg = { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"] };
const pick = (re: RegExp, kind: (m: RegExpExecArray) => string = m => m[1], name: (m: RegExpExecArray) => string = m => m[2]) =>
  (h: string): Sig => { const m = re.exec(h); return m ? { name: name(m), kind: kind(m) } : null; };

// `name(…) {` of Java, Kotlin, C# and PHP methods and functions; not control flow, assignments or calls
const CTRL = /^(?:if|else|for|foreach|while|do|switch|catch|try|finally|using|lock|synchronized|return|when|fixed|unsafe|new|throw|await|yield)\b/;
const callName = (h: string): Sig => {
  const s = h.replace(/^(?:@\w[\w.]*(?:\([^)]*\))?\s*)+/, '').trim(), i = s.indexOf('(');
  if (CTRL.test(s) || i < 0 || /[=;]/.test(s.slice(0, i))) return null;
  const m = /([A-Za-z_]\w*)\s*(?:<[^()]*>)?\s*$/.exec(s.slice(0, i));
  return m ? { name: m[1], kind: 'fn' } : null;
};

// ---- GraphQL: type, input, enum, query, mutation, fragment… (a `scalar` or `union` has no braces: not a section)
const graphql: Lang = {
  id: 'graphql', match: p => /\.(graphql|gql)$/i.test(p),
  analyze: text => ({
    symbols: braceSyms(text, { line: ['#'], quotes: ['"'] },
      h => { const m = /^(?:extend\s+)?(type|input|interface|enum|schema|query|mutation|subscription|directive|fragment)\b\s*(@?\w+)?/.exec(h); return m ? { name: m[2] ? `${m[1]} ${m[2]}` : m[1], kind: m[1] } : null; },
      () => null),
    doc: null,
  }),
};

// ---- Protobuf: message, enum, service (with its rpc and nested messages). References: import
const proto: Lang = {
  id: 'proto', match: p => /\.proto$/i.test(p),
  analyze: text => ({
    symbols: braceSyms(text, C_MASK,
      pick(/^(message|enum|service|extend)\s+([\w.]+)$/),
      h => { const m = /^(?:(rpc)|(message|enum))\s+(\w+)/.exec(h); return m ? { name: m[3], kind: m[1] ?? m[2] } : null; }),
    doc: null,
  }),
  refs: text => [...mask(text, { ...C_MASK, quotes: [] }).matchAll(/^\s*import\s+(?:public\s+|weak\s+)?"([^"]+)"/gm)].map(m => ({ spec: m[1], mode: 'suffix' as const })),
};

// ---- Go: functions (with their receiver: Svc.Name) and types. References: none (imports are module paths, not files)
const go: Lang = {
  id: 'go', match: p => /\.go$/.test(p) && !/_generated\.go$|\.pb\.go$/.test(p),
  analyze: text => ({
    symbols: braceSyms(text, { line: ['//'], block: [['/*', '*/']], quotes: ['"', '`', "'"] },
      pick(/^type\s+(\w+)/, m => 'type', m => m[1]),
      h => { const m = /^func\s*(?:\(\s*(?:\w+\s+)?\*?\s*(\w+)(?:\[[^\]]*\])?\s*\)\s*)?(\w+)/.exec(h); return m ? { name: m[1] ? `${m[1]}.${m[2]}` : m[2], kind: 'fn' } : null; }),
    doc: null,
  }),
};

// import a.b.C → a/b/C.java (or .kt): found by its path suffix. shortcut: wildcard and static imports are not followed
const jvmRefs = (text: string): Ref[] => [...text.matchAll(/^\s*import\s+([\w.]+)\s*;?\s*$/gm)].flatMap(m => ['java', 'kt'].map(e => ({ spec: m[1].replace(/\./g, '/') + '.' + e, mode: 'suffix' as const })));

// ---- Java: classes, interfaces, enums, records and their methods
const java: Lang = {
  id: 'java', match: p => /\.java$/.test(p),
  analyze: text => ({ symbols: braceSyms(text, C_MASK, pick(/(?:^|\s)(class|interface|enum|record|@interface)\s+([A-Za-z_]\w*)/, m => m[1].replace('@', '')), callName), doc: null }),
  refs: jvmRefs,
};

// ---- Kotlin: classes, interfaces, objects (and companion) and their functions, plus top-level functions
const kotlin: Lang = {
  id: 'kotlin', match: p => /\.kts?$/.test(p),
  analyze: text => ({
    symbols: braceSyms(text, { ...C_MASK, interp: true },
      h => { const m = /(?:^|\s)(class|interface|object)\s+([A-Za-z_]\w*)/.exec(h) ?? /\bcompanion\s+(object)(?:\s+(\w+))?/.exec(h); return m ? { name: m[2] ?? 'Companion', kind: m[1] } : null; },
      callName),
    doc: null,
  }),
  refs: jvmRefs,
};

// ---- C#: classes, structs, interfaces, enums, records and their methods (also inside a `namespace X { }` block). References: none
const csharp: Lang = {
  id: 'csharp', match: p => /\.cs$/.test(p),
  analyze: text => ({
    symbols: braceSyms(text, C_MASK, pick(/(?:^|\s)(class|struct|interface|enum|record)(?:\s+(?:class|struct))?\s+([A-Za-z_]\w*)/), callName, /^\s*namespace\s+[\w.]+\s*\{/m.test(text) ? 1 : 0),
    doc: null,
  }),
};

// ---- PHP: classes, interfaces, traits, enums and their methods, plus top-level functions. References: use App\X\Y, require/include
const php: Lang = {
  id: 'php', match: p => /\.php$/.test(p),
  analyze: text => ({
    symbols: braceSyms(text, { line: ['//', '#'], block: [['/*', '*/']], quotes: ['"', "'"] },
      pick(/(?:^|\s)(class|interface|trait|enum)\s+(\w+)/),
      h => { const m = /(?:^|\s)function\s+&?\s*(\w+)\s*\(/.exec(h); return m ? { name: m[1], kind: 'fn' } : null; }),
    doc: null,
  }),
  refs: text => {
    const m = mask(text, { line: ['//', '#'], block: [['/*', '*/']] }), out: Ref[] = [];
    for (const x of m.matchAll(/^\s*use\s+([\w\\]+)\s*;/gm)) { const p = x[1].split('\\'); out.push({ spec: p.join('/') + '.php', mode: 'suffix' }, ...(p.length > 2 ? [{ spec: p.slice(1).join('/') + '.php', mode: 'suffix' as const }] : [])); }
    for (const x of m.matchAll(/\b(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*)?['"]\/?([^'"$]+\.php)['"]/g)) out.push({ spec: x[1], mode: 'rel' });
    return out;
  },
};

// ---- Rust: fn, struct, enum, trait, impl and mod with their functions. References: `mod x;` → x.rs, x/mod.rs
// shortcut: `where` clauses on their own lines hide the function; a '"' char literal confuses the string masking
const rust: Lang = {
  id: 'rust', match: p => /\.rs$/.test(p),
  analyze: text => ({
    symbols: braceSyms(text, { line: ['//'], block: [['/*', '*/']], quotes: ['"'] },
      h => {
        const m = /^(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?(struct|enum|union|trait|mod)\s+(\w+)/.exec(h), i = /^(?:unsafe\s+)?impl\b(.*)$/.exec(h);
        return m ? { name: m[2], kind: m[1] } : i ? { name: squash('impl' + i[1], 60), kind: 'impl' } : null;
      },
      pick(/^(?:pub(?:\([^)]*\))?\s+)?(?:default\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s*(?:"[^"]*")?\s*)?fn\s+(\w+)/, () => 'fn', m => m[1])),
    doc: null,
  }),
  refs: (text, path) => {
    const stem = posix.basename(path, '.rs'), out: Ref[] = [];
    for (const x of mask(text, { line: ['//'], block: [['/*', '*/']] }).matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm)) {
      const n = x[1], base = ['lib', 'main', 'mod'].includes(stem) ? '' : stem + '/';
      for (const f of [`${base}${n}.rs`, `${base}${n}/mod.rs`]) out.push({ spec: f, mode: 'rel' });
    }
    return out;
  },
};

// ---- Ruby: modules, classes and methods, closed by an `end` at the same indentation. References: require, require_relative
// shortcut: needs consistent indentation; `class << self` is not a section; a heredoc containing `end` can confuse it
const ruby: Lang = {
  id: 'ruby', match: p => /\.(rb|rake|gemspec)$|(^|\/)(Rakefile|Gemfile)$/.test(p),
  analyze(text) {
    const lines = text.split('\n'), symbols: Sym[] = [], open: { name: string; kind: string; ind: number; start: number; doc: string | null }[] = [];
    lines.forEach((l, i) => {
      const m = /^(\s*)(class|module|def)\s+(?:self\.)?([A-Za-z_][\w:?!=]*)/.exec(l);
      if (m) {
        const owner = open.filter(o => o.kind !== 'def').at(-1)?.name, kind = m[2] === 'def' ? 'def' : m[2];
        const o = { name: kind === 'def' && owner ? `${owner}.${m[3]}` : m[3], kind: kind === 'def' ? 'method' : kind, ind: m[1].length, start: i + 1, doc: docAbove(lines, i + 1, /^\s*#\s?/) };
        if (kind === 'def' && /^\s*def\s+[^#]*\)\s*=|^\s*def\s+\S+\s*=\s/.test(l)) symbols.push({ ...o, end: i + 1 }); // endless def
        else open.push({ ...o, kind: kind === 'def' ? 'def' : kind });
        return;
      }
      const e = /^(\s*)end\b/.exec(l);
      if (e) { const k = open.map(o => o.ind).lastIndexOf(e[1].length); if (k >= 0) { const o = open.splice(k)[0]; symbols.push({ name: o.name, kind: o.kind === 'def' ? 'method' : o.kind, start: o.start, end: i + 1, doc: o.doc }); } }
    });
    return { symbols: symbols.sort((a, b) => a.start - b.start || b.end - a.end), doc: null };
  },
  refs: text => {
    const out: Ref[] = [];
    for (const x of text.matchAll(/^\s*require_relative\s+["']([^"']+)["']/gm)) out.push({ spec: x[1].endsWith('.rb') ? x[1] : x[1] + '.rb', mode: 'rel' });
    for (const x of text.matchAll(/^\s*require\s+["']([^"']+)["']/gm)) out.push({ spec: x[1].endsWith('.rb') ? x[1] : x[1] + '.rb', mode: 'suffix' });
    return out;
  },
};

export const LANGS: Lang[] = [markdown, shell, hcl, sql, yaml, dockerfile, html, css, json, toml, makefile, graphql, proto, go, java, kotlin, csharp, php, rust, ruby];
export const langOf = (path: string) => LANGS.find(l => l.match(path));
export const CODE_NOISE = /(^|\/)(node_modules|vendor|\.terraform|dist|build)\//; // not analyzed

// ---- resolving references against the repo files
export type RepoIndex = { all: Set<string>; byBase: Map<string, string[]>; byDir: Map<string, string[]> };
export function indexRepo(files: string[]): RepoIndex {
  const byBase = new Map<string, string[]>(), byDir = new Map<string, string[]>();
  for (const f of files) {
    const b = posix.basename(f), d = posix.dirname(f);
    (byBase.get(b) ?? byBase.set(b, []).get(b)!).push(f);
    (byDir.get(d) ?? byDir.set(d, []).get(d)!).push(f);
  }
  return { all: new Set(files), byBase, byDir };
}
const common = (a: string, b: string) => { const x = a.split('/'), y = b.split('/'); let i = 0; while (i < x.length - 1 && i < y.length - 1 && x[i] === y[i]) i++; return i; };

// `prefer`: changed files; a Terraform module links to its changed files and, if none, to its main.tf
export function resolveRef(from: string, r: Ref, ix: RepoIndex, prefer?: Set<string>): string[] {
  const spec = r.spec;
  if (!spec || spec.includes('\0')) return [];
  if (r.mode === 'rel') {
    const dir = posix.dirname(from), b = posix.normalize(posix.join(dir, spec)), root = posix.normalize(spec);
    const variants = (p: string) => /\.(scss|less)$|^[^.]*$/.test(p) ? [p, posix.join(posix.dirname(p), '_' + posix.basename(p)), p + '.scss', posix.join(posix.dirname(p), '_' + posix.basename(p) + '.scss')] : [p];
    for (const c of [b, root]) for (const v of variants(c)) if (v !== from && ix.all.has(v)) return [v];
    return [];
  }
  if (r.mode === 'dir') { // Terraform module
    const d = posix.normalize(posix.join(posix.dirname(from), spec)).replace(/\/$/, '');
    const list = (ix.byDir.get(d) ?? []).filter(f => f.endsWith('.tf') && f !== from).sort((a, b) => Number(posix.basename(b) === 'main.tf') - Number(posix.basename(a) === 'main.tf') || a.localeCompare(b));
    const hit = list.filter(f => prefer?.has(f));
    return hit.length ? hit : list.slice(0, 1);
  }
  // suffix: templates and static files by their logical path ("base.html", "js/app.js"); the closest wins, ties are not guessed
  const ref = posix.normalize(spec).replace(/^\.?\//, '');
  const cands = (ix.byBase.get(posix.basename(ref)) ?? []).filter(p => p !== from && (p === ref || p.endsWith('/' + ref)));
  if (cands.length <= 1) return cands;
  const ranked = cands.map(c => [c, common(from, c)] as const).sort((a, b) => b[1] - a[1]);
  return ranked[0][1] > ranked[1][1] ? [ranked[0][0]] : [];
}

// Python: views point at their templates by name (render(request, "x.html"), render_template, get_template)
export const templateRefs = (text: string): Ref[] => [...text.matchAll(/["']([\w./-]+\.(?:html?|jinja2?|j2))["']/g)].map(m => ({ spec: m[1], mode: 'suffix' as const }));
