import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverRepos, gitAuthEnv, githubSource, githubToken, intents, localSource, parseRemote, type CommitHit, type PRHit } from './sources.ts';

const g = (dir: string, ...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('parseRemote: ssh, https, with and without .git, other hosts', () => {
  for (const u of ['git@github.com:o/n.git', 'https://github.com/o/n', 'https://github.com/o/n.git/', 'ssh://git@ghe.corp/o/n.git', 'git@gitlab.com:o/n']) assert.equal(parseRemote(u), 'o/n', u);
  assert.equal(parseRemote('/home/x/repo'), 'x/repo'); // local path: the last two segments
  assert.equal(parseRemote('x'), null);
});

test('discoverRepos: by origin remote, nested, and the main clone wins over the worktree', () => {
  const root = mkdtempSync(join(tmpdir(), 'disco-'));
  const mk = (rel: string, origin: string) => { const d = join(root, rel); mkdirSync(d, { recursive: true }); g(d, 'init', '-q', '-b', 'main'); g(d, 'remote', 'add', 'origin', origin); return d; };
  const a = mk('a', 'git@github.com:org/alpha.git');
  const nested = mk('a/sub/beta', 'https://github.com/org/beta.git'); // repo dentro de otro repo
  mk('sinorigen', 'x'); // origin sin forma owner/nombre: se ignora
  mkdirSync(join(root, 'node_modules', 'zeta'), { recursive: true });
  g(join(root, 'node_modules', 'zeta'), 'init', '-q');
  // worktree real de alpha (su .git es un ARCHIVO); se llama 0wt para que se recorra ANTES que el clon principal
  writeFileSync(join(a, 'f.txt'), 'x'); g(a, 'add', 'f.txt'); g(a, 'commit', '-qm', 'c');
  g(a, 'worktree', 'add', '-q', join(root, '0wt'), '-b', 'otra');
  const found = discoverRepos([root], 4);
  assert.equal(found.get('org/alpha'), a);
  assert.equal(found.get('org/beta'), nested);
  assert.equal([...found.keys()].some(k => k.includes('zeta')), false); // node_modules no se recorre
  assert.equal(found.size, 2);
});

test('githubToken: environment variable first; with nothing it returns undefined', () => {
  process.env.TEST_TOKEN_X = 'abc';
  assert.equal(githubToken('TEST_TOKEN_X'), 'abc');
  delete process.env.TEST_TOKEN_X;
  const saved = { p: process.env.PATH, a: process.env.GH_TOKEN, b: process.env.GITHUB_TOKEN };
  delete process.env.GH_TOKEN; delete process.env.GITHUB_TOKEN;
  process.env.PATH = mkdtempSync(join(tmpdir(), 'nopath-')); // sin gh a la vista
  try { assert.equal(githubToken('NO_EXISTE'), undefined); } finally {
    process.env.PATH = saved.p; if (saved.a) process.env.GH_TOKEN = saved.a; if (saved.b) process.env.GITHUB_TOKEN = saved.b;
  }
});

test('githubSource without credentials: actionable error and status with a hint', async () => {
  const saved = { p: process.env.PATH, a: process.env.GH_TOKEN, b: process.env.GITHUB_TOKEN };
  delete process.env.GH_TOKEN; delete process.env.GITHUB_TOKEN;
  process.env.PATH = mkdtempSync(join(tmpdir(), 'nopath-'));
  try {
    const s = githubSource({ tokenEnv: 'NO_EXISTE_2', apiUrl: 'http://127.0.0.1:1' });
    assert.equal((await s.status()).ready, false);
    assert.match((await s.status()).hint!, /GITHUB_TOKEN|gh auth login/);
    await assert.rejects(s.repos(), /sin credenciales/);
  } finally { process.env.PATH = saved.p; if (saved.a) process.env.GH_TOKEN = saved.a; if (saved.b) process.env.GITHUB_TOKEN = saved.b; }
});

test('gitAuthEnv: the token goes through the environment, only over https and only to github.com or the cloneUrl host', () => {
  const tok = () => 'ghp_secreto';
  const header = (url: string, clone?: string) => gitAuthEnv(url, tok, clone).GIT_CONFIG_VALUE_0;
  assert.equal(header('https://github.com/o/n.git'), `Authorization: Basic ${Buffer.from('x-access-token:ghp_secreto').toString('base64')}`);
  assert.equal(gitAuthEnv('https://github.com/o/n.git', tok).GIT_CONFIG_KEY_0, 'http.extraheader');
  assert.equal(header('https://ghe.corp/o/n.git', 'https://ghe.corp/{repo}.git') !== undefined, true); // the cloneUrl host too
  assert.equal(header('https://otro.example/o/n.git', 'https://ghe.corp/{repo}.git'), undefined); // un origin ajeno no recibe el token
  assert.equal(header('https://otro.example/o/n.git'), undefined);
  assert.equal(header('http://github.com/o/n.git'), undefined); // nunca en claro
  assert.equal(header('/ruta/local', '/ruta/local'), undefined);
  assert.equal(header('https://github.com.evil.example/o/n.git'), undefined); // el host se compara entero, no por prefijo
  assert.equal(gitAuthEnv('https://github.com/o/n.git', () => undefined).GIT_CONFIG_VALUE_0, undefined); // sin token no se agrega nada
  let asked = false;
  gitAuthEnv('https://otro.example/x.git', () => { asked = true; return 'x'; });
  assert.equal(asked, false); // ni se busca el token si el host no corresponde
});

test('local search: PRs (branches) and commits of all the repos of an owner, with the repo in each result', async () => {
  const root = mkdtempSync(join(tmpdir(), 'srch-')), dirs: Record<string, string> = {};
  for (const [id, msg, branch] of [['acme/api', 'arregla pagos', 'feat/pagos'], ['acme/web', 'cambia logo', 'feat/logo'], ['otro/x', 'arregla pagos', 'feat/x']]) {
    const d = join(root, id.replace('/', '_')); mkdirSync(d); dirs[id] = d;
    g(d, 'init', '-q', '-b', 'main'); writeFileSync(join(d, 'a.txt'), '1'); g(d, 'add', '-A'); g(d, 'commit', '-qm', 'base');
    g(d, 'checkout', '-qb', branch); writeFileSync(join(d, 'a.txt'), '2'); g(d, 'commit', '-qam', msg);
  }
  g(dirs['acme/api'], 'checkout', '-q', 'main'); // the branch commit is not in HEAD: the search finds it anyway
  const s = localSource(r => dirs[r], () => Object.keys(dirs).map(id => ({ id })));
  const o = { q: '', state: 'open', page: 1 };
  const prs = await s.search!('prs', 'acme', o) as PRHit[];
  assert.deepEqual(prs.map(p => p.repo).sort(), ['acme/api', 'acme/web']); // 'otro/x' queda fuera
  assert.deepEqual((await s.search!('prs', 'acme', { ...o, q: 'pagos' }) as PRHit[]).map(p => p.repo), ['acme/api']);
  const cs = await s.search!('commits', 'acme', { ...o, q: 'PAGOS' }) as CommitHit[];
  assert.deepEqual(cs.map(c => [c.repo, c.title]), [['acme/api', 'arregla pagos']]); // case-insensitive
  assert.equal((await s.search!('commits', 'acme', o) as CommitHit[]).length, 4); // sin texto: los commits recientes de cada repo
  assert.deepEqual(await s.search!('prs', 'acme', { ...o, page: 2 }), []);
});

test('GitHub search: query with user:<owner>, without letting qualifiers through from the text, and maps each result\'s repo', async () => {
  const real = globalThis.fetch, urls: string[] = [];
  process.env.PRPEER_TEST_TOK = 'x';
  globalThis.fetch = (async (u: string) => {
    urls.push(decodeURIComponent(u));
    return { ok: true, json: async () => u.includes('/search/commits')
      ? { items: [{ sha: 'abc', commit: { message: 'fix pagos\n\ncuerpo', author: { name: 'Ana', date: '2026-01-01T00:00:00Z' } }, author: { login: 'ana' }, repository: { full_name: 'acme/api' } }] }
      : { items: [{ number: 7, title: 'Pagos', user: { login: 'bo' }, state: 'closed', pull_request: { merged_at: '2026-01-02T00:00:00Z' }, created_at: 'c', updated_at: 'u', repository_url: 'https://api.github.com/repos/acme/web' }] } };
  }) as never;
  try {
    const s = githubSource({ tokenEnv: 'PRPEER_TEST_TOK', apiUrl: 'https://x.test' });
    const [p] = await s.search!('prs', 'acme', { q: 'pagos repo:evil/x', state: 'merged', page: 2 }) as PRHit[];
    assert.deepEqual([p.id, p.state, p.repo, p.author], ['7', 'merged', 'acme/web', 'bo']);
    assert.match(urls[0], /q=is:pr user:acme is:merged pagos repo evil\/x in:title&.*page=2/); // el ':' del texto se descarta
    const [c] = await s.search!('commits', 'acme', { q: 'pagos', state: 'open', page: 1 }) as CommitHit[];
    assert.deepEqual([c.id, c.title, c.author, c.repo], ['abc', 'fix pagos', 'ana', 'acme/api']);
    assert.match(urls[1], /\/search\/commits\?q=user:acme pagos&/);
  } finally { globalThis.fetch = real; delete process.env.PRPEER_TEST_TOK; }
});

test('author filter in the source: GitHub uses search (PRs) and ?author= (commits); local uses --author; the login lets no qualifiers through', async () => {
  const real = globalThis.fetch, urls: string[] = [];
  process.env.PRPEER_TEST_TOK = 'x';
  globalThis.fetch = (async (u: string) => {
    urls.push(decodeURIComponent(u));
    return { ok: true, json: async () => u.includes('/search/issues')
      ? { items: [{ number: 5, title: 'T', user: { login: 'zoe' }, state: 'open', created_at: 'c', updated_at: 'u' }] }
      : [{ sha: 'abc', commit: { message: 'm', author: { name: 'Zoe Gómez', date: 'd' } }, author: { login: 'zoe' } }] };
  }) as never;
  try {
    const s = githubSource({ tokenEnv: 'PRPEER_TEST_TOK', apiUrl: 'https://x.test' });
    const [p] = await s.prs('acme/api', 'open', 2, 'zoe');
    assert.deepEqual([p.id, p.author, p.state, p.base], ['5', 'zoe', 'open', undefined]); // the search brings neither base nor branch
    assert.match(urls[0], /\/search\/issues\?q=is:pr repo:acme\/api author:zoe is:open&.*page=2/);
    const [c] = await s.commits('acme/api', undefined, 1, 'zoe');
    assert.equal(c.author, 'zoe'); // se muestra el login, no el nombre de git
    assert.match(urls[1], /\/repos\/acme\/api\/commits\?.*&author=zoe/);
    await s.prs('acme/api', 'open', 1); // sin autor: el listado normal
    assert.match(urls[2], /\/repos\/acme\/api\/pulls\?/);
    await assert.rejects(s.prs('acme/api', 'open', 1, 'zoe repo:evil/x'), /login/); // espacios: no se cuelan calificadores
    await assert.rejects(s.commits('acme/api', undefined, 1, 'a b'), /login/);
  } finally { globalThis.fetch = real; delete process.env.PRPEER_TEST_TOK; }

  const d = mkdtempSync(join(tmpdir(), 'auth-'));
  g(d, 'init', '-q', '-b', 'main');
  for (const [n, who] of [['1', 'Ana Pérez'], ['2', 'Bo Ríos']]) { writeFileSync(join(d, 'f'), n); g(d, 'add', '-A'); g(d, '-c', `user.name=${who}`, 'commit', '-qm', `c${n}`); }
  const l = localSource(() => d, () => [{ id: 'o/r' }]);
  assert.deepEqual((await l.commits('o/r', undefined, 1, 'pérez')).map(x => x.title), ['c1']);
  assert.equal((await l.commits('o/r')).length, 2);
});

test('intents: groups #i- inline comments by id, with line ranges', () => {
  const m = intents({ items: [
    { kind: 'inline', author: 'a', text: '#i-retry — loop de reintento. Ver PR-PEER.md', path: 'src/w.ts', start: 40, line: 78 },
    { kind: 'inline', author: 'a', text: '#i-retry — config', path: 'cfg.yml', line: 8 },
    { kind: 'inline', author: 'b', text: 'nit: rename this', path: 'src/w.ts', line: 50 },
    { kind: 'comment', author: 'b', text: '#i-retry not anchored' },
  ] });
  assert.deepEqual([...m.keys()], ['#i-retry']);
  assert.deepEqual(m.get('#i-retry')!.map(x => x.where), ['src/w.ts:40-78', 'cfg.yml:8']);
  assert.equal(intents(null).size, 0);
});
