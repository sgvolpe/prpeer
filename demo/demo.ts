#!/usr/bin/env node
// Sample repo with a PR designed to showcase the tool: `npm run demo`.
// Builds a git repo (main branch + feature/partial-refunds branch) from demo/shop/{base,pr} and opens prpeer on the diff.
// Usage: npm run demo -- [--dir folder] [--only-build] [prpeer options: --port N, --no-open, -v]
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const BRANCH = 'feature/partial-refunds';
const here = import.meta.dirname;

// Creates the repo in `dir` (deleting it if it existed) and returns the path.
export function buildDemo(dir: string): string {
  // `--dir` is chosen by whoever runs the command: only an empty folder or a previous sample repo (it has .git/prpeer-demo) is replaced; never anything else.
  const marker = join(dir, '.git', 'prpeer-demo');
  if (existsSync(dir) && readdirSync(dir).length && !existsSync(marker)) throw new Error(`${dir} is not empty and is not a prpeer sample repo; pick another folder with --dir`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'demo@example.com'); git('config', 'user.name', 'Demo Dev'); git('config', 'core.autocrlf', 'false');
  cpSync(join(here, 'shop', 'base'), dir, { recursive: true });
  git('add', '-A'); git('commit', '-qm', 'Base: orders, payments, reports');
  git('checkout', '-q', '-b', BRANCH);
  cpSync(join(here, 'shop', 'pr'), dir, { recursive: true });
  git('add', '-A'); git('commit', '-qm', 'Partial refunds');
  writeFileSync(marker, 'prpeer sample repo\n');
  return dir;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const take = (n: string) => { const i = args.indexOf(n); return i < 0 ? undefined : args.splice(i, 2)[1]; };
  const dir = buildDemo(take('--dir') ?? join(tmpdir(), 'prpeer-demo-shop'));
  if (args.includes('--only-build')) { console.log(`sample repo: ${dir}  (branch ${BRANCH} against main)`); process.exit(0); }
  // Without a real Python, prpeer sees no functions or links between files (on Windows `python` is often the Microsoft Store shortcut).
  if (!['python3', 'python'].some(c => { try { execFileSync(c, ['-c', '1'], { stdio: 'ignore' }); return true; } catch { return false; } }))
    console.warn('warning: Python 3 not found; the map will have no functions or links. Install it and open a new terminal.');
  console.log(`sample repo: ${dir}`);
  process.exit(spawnSync(process.execPath, [join(here, '..', 'prpeer.ts'), BRANCH, '--base', 'main', '--repo', dir, '--serve', ...args], { stdio: 'inherit' }).status ?? 1);
}
