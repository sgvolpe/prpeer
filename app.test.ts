import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.ts';
import { EMPTY_TREE } from './analyze.ts';
import { withLang } from './i18n.ts';
import type { Config } from './llm.ts';

process.env.PRPEER_HOME = mkdtempSync(join(tmpdir(), 'prpeer-app-')); // sessions, usage and settings stay out of the real home

const g = (dir: string, ...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

// sample repo: main (a.txt) and the feat branch (a.txt changed + new b.txt)
function mkRepo(parent: string, name = 'demo') {
  const d = join(parent, name);
  mkdirSync(d);
  g(d, 'init', '-q', '-b', 'main');
  g(d, 'remote', 'add', 'origin', 'https://github.com/test/demo.git');
  writeFileSync(join(d, 'a.txt'), 'l1\nl2\nl3\n'); g(d, 'add', '.'); g(d, 'commit', '-qm', 'base');
  const baseSha = g(d, 'rev-parse', 'HEAD');
  g(d, 'checkout', '-q', '-b', 'feat');
  writeFileSync(join(d, 'a.txt'), 'l1\nL2\nl3\n'); writeFileSync(join(d, 'b.txt'), 'nuevo\n'); g(d, 'add', '.'); g(d, 'commit', '-qm', 'feat: cambios');
  const featSha = g(d, 'rev-parse', 'HEAD');
  g(d, 'checkout', '-q', 'main');
  return { d, baseSha, featSha };
}
const cfg = (extra: Partial<Config> = {}): Config => ({ providers: [{ id: 'x', type: 'openai-compat', baseUrl: 'http://127.0.0.1:1' }], ...extra });
const names = (page: unknown) => (page as { files: { path: string }[] }).files.map(f => f.path).sort();

test('local: discovered repos, branches, commits, opening PR/commit/root commit, validations and the session cap', async () => {
  const parent = tmp('app-local-');
  const { d, baseSha, featSha } = mkRepo(parent);
  const app = createApp(cfg({ repoDirs: [parent], cacheDir: tmp('cache-') }));
  const { api } = app;
  assert.deepEqual(((await api.sources()) as { id: string }[]).map(x => x.id), ['local', 'github']); // github's 'ready' depends on the machine
  assert.deepEqual(await api.repos('local', false), [{ id: 'test/demo', local: d }]);
  const prs = (await api.prs('local', 'test/demo', 'open')) as { id: string; state: string; base: string }[];
  assert.deepEqual(prs.map(p => [p.id, p.state, p.base]), [['feat', 'open', 'main']]); // main no aparece: no tiene cambios propios
  const commits = (await api.commits('local', 'test/demo')) as { id: string; title: string }[];
  assert.equal(commits.length, 1); // HEAD es main: solo el commit base
  assert.equal(((await api.commits('local', 'test/demo', 'feat')) as unknown[]).length, 2);
  assert.equal(((await api.commits('local', 'test/demo', 'feat', 2)) as unknown[]).length, 0); // --skip of page 2
  assert.equal(((await api.prs('local', 'test/demo', 'open', 2)) as unknown[]).length, 0);
  assert.deepEqual(((await api.prs('local', 'test/demo', 'open', 1, 'nadie')) as unknown[]), []); // filtro por autor en la fuente
  assert.throws(() => api.commits('local', 'test/demo', undefined, 1, '--all'), /autor inválido/); // never reaches git as an option
  // search by owner, without choosing a repo
  assert.deepEqual(((await api.search('local', 'test', 'prs', 'open', '', 1)) as { repo: string; id: string }[]).map(p => [p.repo, p.id]), [['test/demo', 'feat']]);
  assert.deepEqual(await api.search('local', 'nadie', 'commits', 'open', '', 1), []);
  for (const bad of [['..', 'prs'], ['a/b', 'prs'], ['', 'prs'], ['test', 'otra']]) assert.throws(() => api.search('local', bad[0], bad[1], 'open', '', 1), /inválido/, bad.join());
  assert.throws(() => api.search('nube', 'test', 'prs', 'open', '', 1), /fuente desconocida/);

  const { sid } = (await api.open({ source: 'local', repo: 'test/demo', kind: 'pr', id: 'feat' })) as { sid: string };
  const page = api.page(sid) as { sid: string; title: string; worktree: string };
  assert.equal(page.sid, sid);
  assert.equal(page.title, 'feat: cambios');
  assert.deepEqual(names(page), ['a.txt', 'b.txt']);
  const lines = api.file(sid, 'a.txt') as { k: string; t: string }[][];
  assert.deepEqual(lines.flat().map(l => l.k + l.t), ['-l2', '+L2']);
  assert.equal(api.file(sid, '../a.txt'), null);
  // the diff with context: unchanged lines around the change, with both numbers; only files of the PR
  const dd = api.diff!(sid, 'a.txt', '3') as { hunks: { lines: { k: string; t: string; o?: number; n?: number }[] }[] };
  assert.deepEqual(dd.hunks[0].lines.map(l => `${l.k}${l.t}:${l.o ?? ''}/${l.n ?? ''}`), [' l1:1/1', '-l2:2/', '+L2:/2', ' l3:3/3']);
  assert.throws(() => api.diff!(sid, '../etc/passwd', '3'), /pedido inválido/);
  assert.throws(() => api.diff!(sid, 'a.txt', '3', '--output=x'), /pedido inválido/);
  // who uses a name: whole-word matches in the head, marked changed; only identifiers reach git
  assert.deepEqual((api.uses!(sid, 'nuevo') as { hits: unknown[] }).hits, [{ path: 'b.txt', line: 1, text: 'nuevo', def: false, test: false, on: 'c' }]);
  assert.deepEqual((api.uses!(sid, 'nadie') as { hits: unknown[] }).hits, []);
  for (const bad of ['--all', 'a b', '', 'x;rm']) assert.throws(() => api.uses!(sid, bad), /pedido inválido/, bad);
  // since an earlier head: which files changed; an unknown head says so; the diff since it only has the new changes
  assert.deepEqual(api.since!(sid, baseSha), { known: true, files: ['a.txt', 'b.txt'] });
  assert.deepEqual(api.since!(sid, featSha), { known: true, files: [] });
  assert.deepEqual(api.since!(sid, 'deadbeefdeadbeef'), { known: false, files: [] });
  assert.throws(() => api.since!(sid, 'HEAD~1'), /pedido inválido/);
  assert.deepEqual((api.diff!(sid, 'a.txt', '3', featSha) as { hunks: unknown[] }).hunks, []);
  assert.equal((api.page(sid) as { key: string }).key, 'test/demo#feat');
  // search in the changed lines, case-insensitive, with the line number of its side
  assert.deepEqual(api.grep!(sid, 'l2'), { hits: [{ path: 'a.txt', line: 2, k: '-', text: 'l2' }, { path: 'a.txt', line: 2, k: '+', text: 'L2' }], files: { 'a.txt': 2 } });
  assert.deepEqual(api.grep!(sid, 'zzz'), { hits: [], files: {} });
  assert.throws(() => api.grep!(sid, 'a'), /pedido inválido/);
  assert.throws(() => api.file('nope', 'a.txt'), /sesión desconocida/);

  const c = (await api.open({ source: 'local', repo: 'test/demo', kind: 'commit', id: featSha })) as { sid: string };
  assert.deepEqual(names(api.page(c.sid)), ['a.txt', 'b.txt']);
  const root = (await api.open({ source: 'local', repo: 'test/demo', kind: 'commit', id: baseSha })) as { sid: string };
  assert.equal((api.page(root.sid) as { base: { ref: string } }).base.ref, EMPTY_TREE); // root commit: against the empty tree
  assert.deepEqual(names(api.page(root.sid)), ['a.txt']);

  const bad = (b: object, code: string) => assert.rejects(api.open(b), (e: Error & { code?: string }) => e.code === code, code);
  await bad({ source: 'local', repo: 'test/demo', kind: 'pr', id: '--evil' }, 'bad_request');
  await bad({ source: 'local', repo: 'test/demo', kind: 'otro', id: 'feat' }, 'bad_request');
  await bad({ source: 'zzz', repo: 'test/demo', kind: 'pr', id: 'feat' }, 'bad_source');
  await bad({ source: 'local', repo: 'no/existe', kind: 'pr', id: 'feat' }, 'needs_clone');
  assert.throws(() => api.commits('local', 'test/demo', '--output=/tmp/x'), /ref inválida/);
  assert.throws(() => api.commits('local', '../../etc', 'main'), /repo inválido/);
  assert.throws(() => api.prs('github', 'o/../x', 'open'), /repo inválido/);

  // cap: the 5th session closes the oldest one and deletes its worktree
  const wt = page.worktree;
  assert.ok(existsSync(wt));
  for (let i = 0; i < 3; i++) await api.open({ source: 'local', repo: 'test/demo', kind: 'pr', id: 'feat' });
  assert.equal(api.page(sid), undefined);
  assert.equal(existsSync(wt), false);
  // the same errors come out in English under the English request language
  withLang('en', () => {
    assert.throws(() => api.commits('local', 'test/demo', '--output=/tmp/x'), /invalid ref/);
    assert.throws(() => api.file('nope', 'a.txt'), /unknown session/);
    assert.throws(() => api.search('nube', 'test', 'prs', 'open', '', 1), /unknown source/);
  });
  // a closed session reopens under the same link, also in a new app (a restart); a sid it never opened does not
  assert.equal(await api.reopen!(sid), true);
  assert.deepEqual(names(api.page(sid)), ['a.txt', 'b.txt']);
  const again = createApp(cfg({ repoDirs: [parent], cacheDir: tmp('cache-') }));
  assert.equal(await again.api.reopen!(sid), true);
  assert.deepEqual(names(again.api.page(sid)), ['a.txt', 'b.txt']);
  assert.equal(await again.api.reopen!('deadbeef'), false);
  again.shutdown();
  app.shutdown();
  assert.equal(g(d, 'worktree', 'list').split('\n').length, 1); // no quedan worktrees de prpeer
});

test('github (simulated API + clone from a local "remote" repo): list, filter, clone on demand, open an open PR, a merged one and a commit', async () => {
  const work = mkRepo(tmp('gh-work-'), 'src');
  const bare = join(tmp('gh-bare-'), 'remote.git');
  execFileSync('git', ['clone', '-q', '--bare', work.d, bare]);
  g(bare, 'update-ref', 'refs/pull/1/head', work.featSha);
  g(bare, 'update-ref', 'refs/pull/2/head', work.featSha);

  const pr = (n: number, state: string, merged: string | null) => ({ number: n, title: `PR ${n}`, user: { login: 'u' }, state, merged_at: merged, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', base: { ref: 'main' }, head: { ref: 'feat' } });
  const posted: unknown[] = [], reviews: unknown[] = [];
  const api = createServer((req, res) => {
    const u = new URL(req.url!, 'http://x'), p = u.pathname;
    const out = (o: unknown, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== 'Bearer test-token') return out({ message: 'Bad credentials' }, 401);
    if (req.method === 'POST' && p === '/repos/o/demo/pulls/1/reviews') { let s = ''; req.on('data', c => (s += c)); req.on('end', () => { reviews.push(JSON.parse(s)); out({ html_url: 'https://github.com/o/demo/pull/1#pullrequestreview-1' }); }); return; }
    if (req.method === 'POST' && p === '/repos/o/demo/pulls/1/comments') { let s = ''; req.on('data', c => (s += c)); req.on('end', () => { posted.push(JSON.parse(s)); out({ html_url: 'https://github.com/o/demo/pull/1#discussion_r1' }, 201); }); return; }
    if (p === `/repos/o/demo/commits/${work.featSha}/check-runs`) return out({ check_runs: [{ id: 7, name: 'lint', status: 'completed', conclusion: 'failure', output: { annotations_count: 1 } }, { id: 8, name: 'build', status: 'completed', conclusion: 'success', output: { annotations_count: 3 } }] });
    if (p === '/repos/o/demo/check-runs/7/annotations') return out([{ path: 'a.txt', start_line: 2, end_line: 2, annotation_level: 'failure', message: 'bad line', title: 'E1' }]);
    if (p === '/user') return out({ login: 'o' });
    if (p === '/user/repos') return out(u.searchParams.get('page') === '1' ? Array.from({ length: 100 }, (_, i) => ({ full_name: `o/r${i}`, description: null, pushed_at: '2026-01-01T00:00:00Z', private: false })) : [{ full_name: 'o/demo', description: 'demo', pushed_at: '2026-01-02T00:00:00Z', private: true }]);
    if (p === '/repos/o/demo/pulls' && u.searchParams.get('page') === '2') return out([]);
    if (p === '/repos/o/demo/pulls') { const s = u.searchParams.get('state'); return out([pr(1, 'open', null), pr(2, 'closed', '2026-01-03T00:00:00Z')].filter(x => s === 'all' || x.state === s)); }
    if (p === '/repos/o/demo/pulls/1') return out({ title: 'PR 1', merged: false, base: { ref: 'main', sha: work.baseSha }, head: { sha: work.featSha } });
    if (p === '/repos/o/demo/pulls/2') return out({ title: 'PR 2', merged: true, base: { ref: 'main', sha: work.baseSha }, head: { sha: work.featSha } });
    if (p === '/repos/o/demo/commits' && u.searchParams.get('page') === '2') return out([]);
    if (p === '/repos/o/demo/commits') return out([{ sha: work.featSha, commit: { message: 'feat: cambios\n\ncuerpo', author: { name: 't', date: '2026-01-01T00:00:00Z' } } }]);
    if (p === `/repos/o/demo/commits/${work.featSha}`) return out({ sha: work.featSha, parents: [{ sha: work.baseSha }], commit: { message: 'feat: cambios' } });
    out({ message: 'Not Found' }, 404);
  });
  await new Promise<void>(ok => api.listen(0, '127.0.0.1', ok));
  process.env.TEST_GH = 'test-token';
  const cache = tmp('gh-cache-');
  const app = createApp(cfg({ repoDirs: [tmp('vacio-')], cacheDir: cache, github: { apiUrl: `http://127.0.0.1:${(api.address() as { port: number }).port}`, tokenEnv: 'TEST_GH', cloneUrl: bare } }));
  const a = app.api;

  assert.equal(((await a.sources()) as { ready: boolean }[])[1].ready, true);
  const repos = (await a.repos('github', false)) as { id: string; local?: string; private: boolean }[];
  assert.equal(repos.length, 101); // it paginated
  assert.equal(repos.find(r => r.id === 'o/demo')!.local, undefined);
  assert.deepEqual(((await a.prs('github', 'o/demo', 'open')) as { id: string }[]).map(p => p.id), ['1']);
  assert.deepEqual(((await a.prs('github', 'o/demo', 'merged')) as { id: string; state: string }[]).map(p => [p.id, p.state]), [['2', 'merged']]);
  assert.equal(((await a.prs('github', 'o/demo', 'all')) as unknown[]).length, 2);
  assert.equal(((await a.prs('github', 'o/demo', 'all', 2)) as unknown[]).length, 0); // the page is forwarded to the API
  assert.equal(((await a.commits('github', 'o/demo', undefined, 2)) as unknown[]).length, 0);
  assert.equal(((await a.prs('github', 'o/demo', 'open')) as { created?: string }[])[0].created, '2026-01-01T00:00:00Z');
  assert.equal(((await a.commits('github', 'o/demo')) as { title: string }[])[0].title, 'feat: cambios');

  // no clone: it asks for confirmation instead of downloading code by itself
  await assert.rejects(a.open({ source: 'github', repo: 'o/demo', kind: 'pr', id: '1' }), (e: Error & { code?: string; status?: number }) => e.code === 'needs_clone' && e.status === 409);
  await assert.rejects(a.clone({ repo: '../x' }), /repo inválido/);
  const { path } = (await a.clone({ repo: 'o/demo' })) as { path: string };
  assert.ok(path.startsWith(cache) && existsSync(join(path, '.git')));
  assert.equal(((await a.clone({ repo: 'o/demo' })) as { path: string }).path, path); // idempotente
  assert.equal(((await a.repos('github', false)) as { id: string; local?: string }[]).find(r => r.id === 'o/demo')!.local, path);

  const open = async (kind: 'pr' | 'commit', id: string) => a.page(((await a.open({ source: 'github', repo: 'o/demo', kind, id })) as { sid: string }).sid) as { title: string; base: { ref: string } };
  const p1 = await open('pr', '1');
  assert.deepEqual(names(p1), ['a.txt', 'b.txt']);
  assert.equal(p1.title, 'PR 1');
  assert.equal(p1.base.ref, 'origin/main'); // abierto: contra la base actual
  const p2 = await open('pr', '2');
  assert.equal(p2.base.ref, work.baseSha); // merged: against the base it had
  assert.deepEqual(names(p2), ['a.txt', 'b.txt']);
  assert.deepEqual(names(await open('commit', work.featSha)), ['a.txt', 'b.txt']);

  // comments: only on a changed line of a PR, and the text reaches GitHub as the user wrote it
  const s1 = p1 as unknown as { sid: string; canComment: boolean };
  assert.equal(s1.canComment, true);
  assert.deepEqual(await a.comment!(s1.sid, { path: 'a.txt', line: 2, side: 'RIGHT', text: 'why?' }), { url: 'https://github.com/o/demo/pull/1#discussion_r1' });
  assert.deepEqual(posted, [{ body: 'why?', commit_id: work.featSha, path: 'a.txt', line: 2, side: 'RIGHT' }]);
  for (const bad of [{ path: 'a.txt', line: 3, side: 'RIGHT', text: 'x' }, { path: 'a.txt', line: 2, side: 'LEFT', text: ' ' }, { path: 'zzz', line: 2, side: 'RIGHT', text: 'x' }, { path: 'a.txt', line: 2, side: 'UP', text: 'x' }])
    await assert.rejects(a.comment!(s1.sid, bad), /pedido inválido/, JSON.stringify(bad));
  assert.equal(posted.length, 1);
  const c = (await open('commit', work.featSha)) as unknown as { sid: string; canComment: boolean };
  assert.equal(c.canComment, false);
  await assert.rejects(a.comment!(c.sid, { path: 'a.txt', line: 2, side: 'RIGHT', text: 'x' }), /solo se puede comentar/);
  // a review: the notes as line comments plus a verdict, all checked like a single comment
  const rv = { event: 'REQUEST_CHANGES', text: 'Two things', comments: [{ path: 'a.txt', line: 2, side: 'RIGHT', text: 'why?' }, { path: 'a.txt', line: 2, side: 'LEFT', text: 'was fine' }] };
  const done = { url: 'https://github.com/o/demo/pull/1#pullrequestreview-1' };
  assert.deepEqual(await a.review!(s1.sid, rv), done);
  assert.deepEqual(reviews, [{ commit_id: work.featSha, body: 'Two things', event: 'REQUEST_CHANGES', comments: [{ path: 'a.txt', line: 2, side: 'RIGHT', body: 'why?' }, { path: 'a.txt', line: 2, side: 'LEFT', body: 'was fine' }] }]);
  for (const bad of [{ ...rv, event: 'MERGE' }, { ...rv, comments: [{ path: 'a.txt', line: 1, side: 'RIGHT', text: 'x' }] }, { event: 'COMMENT', text: ' ', comments: [] }, { ...rv, comments: 'x' }])
    await assert.rejects(a.review!(s1.sid, bad), /pedido inválido/, JSON.stringify(bad));
  assert.equal(reviews.length, 1);
  assert.deepEqual(await a.review!(s1.sid, { event: 'APPROVE', comments: [] }), done); // approving needs nothing else
  await assert.rejects(a.review!(c.sid, rv), /solo se puede comentar/);
  // meta: the failed check's annotations point at file and line; the passing one's are not fetched
  assert.deepEqual(((await a.meta(s1.sid)) as { annotations: unknown[] }).annotations, [{ check: 'lint', path: 'a.txt', line: 2, end: 2, level: 'failure', message: 'E1: bad line' }]);

  app.shutdown();
  api.close();
  delete process.env.TEST_GH;
});
