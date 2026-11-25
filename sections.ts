import type { FileDiff } from './diff.ts';

export type Sym = { name: string; kind: string; start: number; end: number; doc: string | null };
export type SecLine = { k: '+' | '-'; t: string; o?: number; n?: number };
export type Section = { name: string; kind: string; start?: number; end?: number; doc: string | null; add: number; del: number; first: number; last: number; lines: SecLine[] };

// Assigns each changed line to the function/class that contains it (syms) or, without syms, to git's @@ header.
// A '+' is attributed by its new line number; a '-' by the new position where the deletion happened.
export function buildSections(f: FileDiff, syms?: Sym[]): Section[] {
  const out = new Map<string, Section>();
  const at = (line: number) => syms?.filter(s => s.start <= line && line <= s.end).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  for (const h of f.hunks) {
    let o = h.oldStart, n = h.newStart;
    for (const l of h.lines) {
      if (l.k === ' ') { o++; n++; continue; } // context lines only appear in diffs asked with context; sections are built from -U0
      const line = n;
      const s = syms ? at(line) : undefined;
      const key = f.status === 'deleted' ? '(deleted file)' : syms ? (s?.name ?? '(module)') : (h.header || '(file)');
      let sec = out.get(key);
      if (!sec) {
        sec = { name: key, kind: s?.kind ?? (syms ? 'module' : 'hunk'), start: s?.start, end: s?.end, doc: s?.doc ?? null, add: 0, del: 0, first: line, last: line, lines: [] };
        out.set(key, sec);
      }
      if (l.k === '+') { sec.add++; sec.lines.push({ k: '+', t: l.t, n: line }); n++; }
      else { sec.del++; sec.lines.push({ k: '-', t: l.t, o }); o++; }
      sec.first = Math.min(sec.first, line);
      sec.last = Math.max(sec.last, line);
    }
  }
  return [...out.values()].sort((a, b) => a.first - b.first);
}
