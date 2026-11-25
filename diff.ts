export type Line = { k: '+' | '-' | ' '; t: string }; // ' ': context line (only when the diff was asked with context)
export type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; header: string; lines: Line[] };
export type FileDiff = { path: string; oldPath?: string; status: 'added' | 'deleted' | 'renamed' | 'modified'; binary: boolean; add: number; del: number; hunks: Hunk[] };

// Parses the output of `git diff -U0 -M --no-color` (or with -U<n> / -W: context lines come as k ' ').
export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let f: FileDiff | undefined;
  let h: Hunk | undefined;
  for (const l of text.split('\n')) {
    let m: RegExpExecArray | null;
    // shortcut: a path containing " b/" is ambiguous; parse ---/+++ instead if a real case shows up
    if ((m = /^diff --git a\/(.+) b\/(.+)$/.exec(l))) {
      f = { path: m[2], status: 'modified', binary: false, add: 0, del: 0, hunks: [] };
      files.push(f);
      h = undefined;
    } else if (!f) continue;
    else if (l.startsWith('new file mode')) f.status = 'added';
    else if (l.startsWith('deleted file mode')) f.status = 'deleted';
    else if (l.startsWith('rename from ')) { f.status = 'renamed'; f.oldPath = l.slice(12); }
    else if (l.startsWith('Binary files') || l.startsWith('GIT binary patch')) f.binary = true;
    else if ((m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(l))) {
      h = { oldStart: +m[1], oldLines: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newLines: m[4] === undefined ? 1 : +m[4], header: m[5], lines: [] };
      f.hunks.push(h);
    } else if (h && (l[0] === '+' || l[0] === '-' || l[0] === ' ')) {
      h.lines.push({ k: l[0] as Line['k'], t: l.slice(1) });
      if (l[0] === '+') f.add++; else if (l[0] === '-') f.del++;
    }
  }
  return files;
}
