// `prpeer doctor`: checks everything PR Peer needs or can use, and says how to fix what is missing.
// Only node: modules, so it works before `npm ci`. Exit code 1 when something required fails.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Level = 'ok' | 'warn' | 'fail';
export type Check = { level: Level; name: string; detail: string; fix?: string };

const here = dirname(fileURLToPath(import.meta.url));
const win = process.platform === 'win32', mac = process.platform === 'darwin';
const out = (cmd: string, a: string[]) => {
  try { return execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000, shell: win && cmd === 'npm' }).trim(); } catch { return null; }
};
const install = (pkg: { win: string; mac: string; linux: string }) => win ? pkg.win : mac ? pkg.mac : pkg.linux;

export function portFree(port: number) {
  return new Promise<boolean>(ok => { const s = createServer().once('error', () => ok(false)).once('listening', () => s.close(() => ok(true))).listen(port, '127.0.0.1'); });
}

export async function checks(port = 4173): Promise<Check[]> {
  const c: Check[] = [];
  const node = process.versions.node, major = Number(node.split('.')[0]);
  c.push(major >= 24 ? { level: 'ok', name: 'Node.js', detail: node }
    : { level: 'fail', name: 'Node.js', detail: `${node} (needs 24+)`, fix: install({ win: 'winget install OpenJS.NodeJS.LTS', mac: 'nvm install 24', linux: 'nvm install 24' }) });

  const git = out('git', ['--version']);
  c.push(git ? { level: 'ok', name: 'git', detail: git.replace('git version ', '') }
    : { level: 'fail', name: 'git', detail: 'not found', fix: install({ win: 'winget install Git.Git', mac: 'xcode-select --install', linux: 'sudo apt install git' }) });

  const py = ['python3', 'python'].map(p => ({ p, v: out(p, ['--version']) })).find(x => x.v?.startsWith('Python 3'));
  if (py) c.push({ level: 'ok', name: 'Python 3', detail: `${py.v!.slice(7)} (${py.p})` });
  else {
    // the Microsoft Store alias answers on PATH but runs nothing: point at a real install hiding behind it
    const real = win ? out('where.exe', ['python']) ?? '' : '';
    const hidden = real.split(/\r?\n/).find(p => p && !/WindowsApps/i.test(p));
    c.push({ level: 'warn', name: 'Python 3', detail: hidden ? `installed at ${dirname(hidden)} but the Microsoft Store alias comes first on PATH` : 'not found: Python repos will show no functions or links',
      fix: hidden ? `move ${dirname(hidden)} before ...\\WindowsApps in your user PATH (the Windows installer of PR Peer can do it)` : install({ win: 'winget install Python.Python.3.13', mac: 'brew install python', linux: 'sudo apt install python3' }) });
  }

  c.push(existsSync(join(here, 'node_modules')) && existsSync(join(here, 'web', 'dist', 'map.js'))
    ? { level: 'ok', name: 'Dependencies and build', detail: 'in place' }
    : { level: 'fail', name: 'Dependencies and build', detail: 'missing', fix: `npm ci in ${here} (or just run prpeer: it does it on first run)` });

  const where = out(win ? 'where.exe' : 'which', ['prpeer']);
  c.push(where ? { level: 'ok', name: 'prpeer command', detail: where.split(/\r?\n/)[0] }
    : { level: 'warn', name: 'prpeer command', detail: 'not on PATH', fix: `run the installer, or npm install -g . in ${here}; then open a new terminal` });

  const gh = out('gh', ['--version']);
  const ghAuth = gh ? out('gh', ['auth', 'token']) : null;
  const saved = (() => { try { return JSON.parse(readFileSync(join(process.env.PRPEER_HOME ?? join(homedir(), '.prpeer'), 'connections.json'), 'utf8')) as Record<string, unknown>; } catch { return {}; } })();
  c.push(process.env.GITHUB_TOKEN ? { level: 'ok', name: 'GitHub', detail: 'GITHUB_TOKEN set' }
    : ghAuth ? { level: 'ok', name: 'GitHub', detail: 'gh is logged in' }
    : saved.github ? { level: 'ok', name: 'GitHub', detail: 'token saved in Connections' }
    : { level: 'warn', name: 'GitHub', detail: gh ? 'gh installed but not logged in' : 'no credentials (optional: local repos still work)', fix: gh ? 'gh auth login' : install({ win: 'winget install GitHub.cli', mac: 'brew install gh', linux: 'see https://cli.github.com' }) + ', then gh auth login' });

  const claude = !win && out('claude', ['--version']);
  const savedAi = Object.keys(saved).some(k => k.startsWith('p:'));
  c.push(process.env.ANTHROPIC_API_KEY ? { level: 'ok', name: 'AI', detail: 'ANTHROPIC_API_KEY set' }
    : savedAi ? { level: 'ok', name: 'AI', detail: 'provider saved in Connections' }
    : existsSync(join(homedir(), '.prpeer', 'config.json')) ? { level: 'ok', name: 'AI', detail: 'providers in ~/.prpeer/config.json' }
    : claude ? { level: 'ok', name: 'AI', detail: 'Claude Code CLI available' }
    : { level: 'warn', name: 'AI', detail: 'no provider (optional: the map works without it)', fix: 'export ANTHROPIC_API_KEY=..., or add one from the Connections button' });

  c.push(await portFree(port) ? { level: 'ok', name: `Port ${port}`, detail: 'free' }
    : { level: 'warn', name: `Port ${port}`, detail: 'in use (another prpeer running?)', fix: `close it, or use prpeer --serve --port ${port + 1}` });
  return c;
}

if (import.meta.main || process.argv[2] === 'doctor') {
  const portArg = process.argv.indexOf('--port');
  const list = await checks(portArg > 0 ? Number(process.argv[portArg + 1]) : 4173);
  const tty = process.stdout.isTTY && !process.env.NO_COLOR;
  const paint = (l: Level, s: string) => !tty ? s : `\x1b[${l === 'ok' ? 32 : l === 'warn' ? 33 : 31}m${s}\x1b[0m`;
  console.log('prpeer doctor: the duck checks your setup\n');
  for (const x of list) {
    console.log(`  ${paint(x.level, x.level === 'ok' ? '[ok]  ' : x.level === 'warn' ? '[warn]' : '[FAIL]')} ${x.name.padEnd(24)} ${x.detail}`);
    if (x.fix) console.log(`         fix: ${x.fix}`);
  }
  const fails = list.filter(x => x.level === 'fail').length, warns = list.filter(x => x.level === 'warn').length;
  console.log('\n' + (fails ? `${fails} problem(s) to fix before PR Peer can run.` : warns ? `Ready to go. ${warns} optional thing(s) could be better.` : 'All good. The duck approves.'));
  process.exitCode = fails ? 1 : 0;
}
