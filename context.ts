import { lstatSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { t } from './i18n.ts';

// First useful paragraph of the README (no titles, badges or HTML); if there is none, the first title.
export function firstParagraph(md: string): string {
  const blocks = md.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const body = blocks.find(b => !/^(#|\[!\[|<|!\[|---)/.test(b));
  const text = (body ?? (blocks[0] ?? '').replace(/^#+\s*/, '')).replace(/\s+/g, ' ');
  return text.length > 400 ? text.slice(0, 399) + '…' : text;
}

// Reads only plain files from the worktree: a PR can bring a symlink (README.md -> ~/.ssh/id_rsa) and prpeer would end up
// showing or sending to the LLM a file from the user's machine. Symlink, folder or missing: undefined.
export const isPlainFile = (path: string) => { try { return lstatSync(path).isFile(); } catch { return false; } };
export function readPlain(path: string, maxBytes = 1_500_000): string | undefined {
  try { return isPlainFile(path) && lstatSync(path).size <= maxBytes ? readFileSync(path, 'utf8') : undefined; } catch { return undefined; }
}

// Closest README (walking up the folders) for each folder of `paths`. Key: the file's folder.
export function readmes(root: string, paths: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of new Set(paths.map(p => posix.dirname(p)))) {
    for (let x = d; ; x = posix.dirname(x)) {
      const f = join(root, x, 'README.md');
      const md = readPlain(f);
      if (md !== undefined) { const p = firstParagraph(md); if (p) out[d] = p; break; }
      if (x === '.' || x === '/') break;
    }
  }
  return out;
}

// [Unreleased] section of a CHANGELOG (Keep a Changelog) -> [[group, [items]]]; null if it does not exist or is empty.
export function changelog(text: string): [string, string[]][] | null {
  const m = /^##\s*\[?Unreleased\]?.*$/im.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const end = rest.search(/^##\s/m);
  const groups: [string, string[]][] = [];
  for (const line of (end < 0 ? rest : rest.slice(0, end)).split('\n')) {
    const h = /^###\s+(.+?)\s*$/.exec(line), it = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
    if (h) groups.push([h[1], []]);
    else if (it) (groups.at(-1) ?? (groups.push([t('ctx.defaultGroup'), []]), groups.at(-1)!))[1].push(it[1]);
  }
  return groups.filter(g => g[1].length).length ? groups.filter(g => g[1].length) : null;
}
