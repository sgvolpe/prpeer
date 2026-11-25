import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { entry } from './connections.ts';
import { t } from './i18n.ts';
import { EMPTY_TREE } from './analyze.ts';

export type RepoRef = { id: string; desc?: string; updated?: string; private?: boolean; local?: string; mine?: boolean; url?: string };
export type PRRef = { id: string; title: string; author?: string; state: 'open' | 'merged' | 'closed'; created?: string; updated?: string; base: string; head: string; url?: string };
export type CommitRef = { id: string; title: string; author?: string; date?: string; url?: string };
// Result of searching all the repos of an owner: the same as a PR / commit, plus the repo it belongs to (GitHub search does not bring base or branch).
export type PRHit = Omit<PRRef, 'base' | 'head'> & { repo: string; base?: string; head?: string };
export type CommitHit = CommitRef & { repo: string };
export type SearchOpts = { q: string; state: string; page: number; author?: string };
// What has to be fetched into the clone before analyzing: refspecs (`git fetch origin <x>`) and commits that must exist.
export type Resolved = { title: string; baseRef: string; head: string; refspecs: string[]; need: string[]; url?: string }; // url: the page of the PR / commit on the host, when it has one
export type SourcesCfg = { repoDirs?: string[]; repos?: Record<string, string>; github?: { tokenEnv?: string; apiUrl?: string; cloneUrl?: string } };

// What was said about the PR: description, branch and comments (general, review and on diff lines).
export type Discussion = { body?: string; branch?: string; items: { kind: 'comment' | 'review' | 'inline'; author: string; text: string; path?: string; start?: number; line?: number; state?: string }[] };

// Header data of a PR: who, when, CI checks, comments and whether it merges cleanly.
export type PrMeta = { id?: string; url?: string; author?: string; created?: string; closed?: string; approvals?: number; changesRequested?: number; unresolved?: number; state: string; draft?: boolean; comments: number; conflicts?: boolean; checks: { name: string; state: 'ok' | 'fail' | 'wip' | 'skip' }[];
  annotations?: { check: string; path: string; line: number; end: number; level: string; message: string }[] }; // where the failed checks point (file and lines)
export type LineComment = { path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string; commit: string };
export type Review = { commit: string; body: string; event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'; comments: Omit<LineComment, 'commit'>[] };

// Inline comments that start with an intent id (`#i-retry — ...`, see GUIA-PR-PEER.md), grouped by intent.
export function intents(d: Discussion | null): Map<string, { where: string; text: string }[]> {
  const m = new Map<string, { where: string; text: string }[]>();
  for (const i of d?.items ?? []) {
    const id = i.kind === 'inline' && i.path ? /^\s*(#i-[\w-]+)/.exec(i.text)?.[1] : undefined;
    if (!id) continue;
    const where = i.path + (i.line ? ':' + (i.start && i.start !== i.line ? `${i.start}-${i.line}` : i.line) : '');
    m.set(id, [...(m.get(id) ?? []), { where, text: i.text.trim() }]);
  }
  return m;
}

export interface Source {
  id: string;
  meta?(repo: string, id: string): Promise<PrMeta>;
  prForCommit?(repo: string, sha: string): Promise<string | undefined>; // the PR that contains the commit, so a commit session also gets the strip
  discussion?(repo: string, id: string): Promise<Discussion>;
  comment?(repo: string, id: string, c: LineComment): Promise<{ url?: string }>; // writes: called only when the user sends a comment from the UI
  review?(repo: string, id: string, r: Review): Promise<{ url?: string }>; // the user's notes as one review with a verdict, sent from the UI
  readonly label: string; // may be a getter: it is localized per request
  status(): Promise<{ ready: boolean; hint?: string }>;
  repos(): Promise<RepoRef[]>;
  prs(repo: string, state: string, page?: number, author?: string): Promise<PRRef[]>; // pages of 50, from 1; `author` filtra en la fuente (no solo lo ya cargado)
  commits(repo: string, ref?: string, page?: number, author?: string): Promise<CommitRef[]>;
  search?(kind: 'prs' | 'commits', owner: string, o: SearchOpts): Promise<(PRHit | CommitHit)[]>; // PRs or commits of all the repos of an owner, without choosing a repo
  resolve(repo: string, kind: 'pr' | 'commit', id: string, localDir?: string): Promise<Resolved>;
}

export const expand = (p: string) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p);

// 'git@github.com:o/n.git', 'https://host/o/n', 'ssh://git@host/o/n/' -> 'o/n'
export function parseRemote(url: string): string | null {
  const m = /[:/]([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

const run = (cwd: string, ...a: string[]) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8', timeout: 20_000, maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`git ${a[0]}: ${(r.stderr || r.error?.message || '').trim().slice(0, 300)}`);
  return r.stdout.trim();
};

const SKIP = new Set(['node_modules', 'venvs', 'venv', 'snap', '__pycache__', 'dist', 'build', 'target']);
// Local clones under `dirs` (up to `depth` levels), by their origin remote: 'owner/name' -> folder.
// The main clone (.git folder) wins over its worktrees (.git file).
export function discoverRepos(dirs: string[], depth = 3): Map<string, string> {
  const found = new Map<string, { dir: string; main: boolean }>();
  let visited = 0;
  const walk = (d: string, lvl: number) => {
    if (visited++ > 5000) return;
    let ents;
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    const g = ents.find(e => e.name === '.git');
    if (g) {
      const r = spawnSync('git', ['-C', d, 'remote', 'get-url', 'origin'], { encoding: 'utf8', timeout: 3000 });
      const id = r.status === 0 ? parseRemote(r.stdout) : null;
      if (id && (!found.has(id) || (g.isDirectory() && !found.get(id)!.main))) found.set(id, { dir: d, main: g.isDirectory() });
    }
    if (lvl >= depth) return;
    for (const e of ents) if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) walk(join(d, e.name), lvl + 1);
  };
  for (const d of dirs) walk(expand(d), 0);
  return new Map([...found].map(([k, v]) => [k, v.dir]));
}

// ---- local git: branches with their own commits = local "PRs"; commits = git log
export function localSource(dirOf: (repo: string) => string | undefined, list: () => RepoRef[]): Source {
  const defaultBranch = (dir: string) => {
    try { return run(dir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'); } catch { /* no origin/HEAD */ }
    const b = ['main', 'master', 'develop'].find(x => { try { run(dir, 'rev-parse', '--verify', x); return true; } catch { return false; } });
    if (!b) throw new Error(t('src.noBaseBranch'));
    return b;
  };
  const need = (repo: string) => dirOf(repo) ?? (() => { throw new Error(t('src.noClone', { repo })); })();
  const src: Source = {
    id: 'local', get label() { return t('src.local'); },
    status: async () => ({ ready: true }),
    repos: async () => list(),
    prs: async (repo, _state, page = 1, author) => {
      if (page > 1) return []; // local branches fit in a single page
      const dir = need(repo), base = defaultBranch(dir);
      const out = run(dir, 'for-each-ref', '--sort=-committerdate', '--count=80', '--format=%(refname:short)%1f%(authorname)%1f%(committerdate:iso-strict)%1f%(subject)', 'refs/heads', 'refs/remotes/origin');
      const prs: PRRef[] = [];
      for (const line of out.split('\n').filter(Boolean)) {
        const [name, who, updated, subject] = line.split('\x1f');
        if (!name || name === base || name === 'origin' || name.endsWith('/HEAD')) continue;
        if (author && !(who ?? '').toLowerCase().includes(author.toLowerCase())) continue;
        if (Number(run(dir, 'rev-list', '--count', `${base}..${name}`)) === 0) continue; // no commits of its own
        prs.push({ id: name, title: subject, author: who, state: 'open', updated, base, head: name });
        if (prs.length >= 40) break;
      }
      return prs;
    },
    commits: async (repo, ref, page = 1, author) => run(need(repo), 'log', '-n', '50', `--skip=${(page - 1) * 50}`, ...(author ? ['--regexp-ignore-case', '--fixed-strings', `--author=${author}`] : []), '--format=%H%x1f%an%x1f%aI%x1f%s', ref || 'HEAD').split('\n').filter(Boolean).map(l => {
      const [id, author, date, title] = l.split('\x1f');
      return { id, author, date, title };
    }),
    resolve: async (repo, kind, id) => {
      const dir = need(repo);
      if (kind === 'commit') {
        let baseRef = `${id}^`;
        try { run(dir, 'rev-parse', '--verify', baseRef); } catch { baseRef = EMPTY_TREE; } // root commit
        return { title: run(dir, 'log', '-1', '--format=%s', id), baseRef, head: id, refspecs: [], need: [] };
      }
      return { title: run(dir, 'log', '-1', '--format=%s', id), baseRef: defaultBranch(dir), head: id, refspecs: [], need: [] };
    },
    // Walks the owner's clones. A repo that fails (no base branch, broken clone) is skipped: it does not take down the search of the others.
    search: async (kind, owner, { q, page, author }) => {
      if (page > 1) return []; // everything fits in a single page
      const f = q.trim().toLowerCase(), hits: (PRHit | CommitHit)[] = [];
      for (const r of list().filter(x => x.id.split('/')[0] === owner)) {
        try {
          if (kind === 'prs') for (const p of await src.prs(r.id, 'open', 1, author)) { if (!f || [p.title, p.author, p.head].join(' ').toLowerCase().includes(f)) hits.push({ ...p, repo: r.id }); }
          else for (const c of run(need(r.id), 'log', '-n', '30', ...(f || author ? ['--regexp-ignore-case', '--fixed-strings'] : []), ...(f ? [`--grep=${q.trim()}`] : []), ...(author ? [`--author=${author}`] : []), '--format=%H%x1f%an%x1f%aI%x1f%s', '--all').split('\n').filter(Boolean)) { // --all: also the commits of branches that are not the current one
            const [id, author, date, title] = c.split('\x1f');
            hits.push({ id, author, date, title, repo: r.id });
          }
        } catch { /* repo with no base branch or broken clone */ }
      }
      return hits.sort((a, b) => (Date.parse((b as CommitHit).date ?? (b as PRHit).updated ?? '') || 0) - (Date.parse((a as CommitHit).date ?? (a as PRHit).updated ?? '') || 0)).slice(0, 100);
    },
  };
  return src;
}

// ---- GitHub through the REST API. The token is looked up in the environment or in `gh auth token` (or gh.exe from WSL) and never leaves the server.
let tokenCache: { v?: string; at: number } | undefined;
export const forgetTokenCache = () => { tokenCache = undefined; };
// Order: token pasted in the UI > environment variable > gh. With "disconnect" none is used (`ignoreOff` only serves to show what it would have used).
export function githubCred(envName?: string, ignoreOff = false): { token?: string; from?: 'saved' | 'env' | 'gh' } {
  const c = entry('github');
  if (c.off && !ignoreOff) return {};
  if (c.secret) return { token: c.secret, from: 'saved' };
  for (const n of [envName, 'GH_TOKEN', 'GITHUB_TOKEN']) if (n && process.env[n]) return { token: process.env[n], from: 'env' };
  if (!tokenCache || Date.now() - tokenCache.at >= 300_000) {
    let v: string | undefined;
    for (const cmd of ['gh', 'gh.exe']) {
      const r = spawnSync(cmd, ['auth', 'token'], { encoding: 'utf8', timeout: 5000 });
      if (r.status === 0 && r.stdout.trim()) { v = r.stdout.trim(); break; }
    }
    tokenCache = { v, at: Date.now() };
  }
  return tokenCache.v ? { token: tokenCache.v, from: 'gh' } : {};
}
export const githubToken = (envName?: string) => githubCred(envName).token;

// Credential for git through the environment (GIT_CONFIG_*): it does not stay in .git/config or in the process list. It only travels over https and only to
// github.com or the cloneUrl host: a clone whose origin points elsewhere never receives the token. `token` is only requested if the host matches.
export function gitAuthEnv(url: string, token: () => string | undefined, cloneUrl?: string): NodeJS.ProcessEnv {
  const host = (u: string) => { try { return new URL(u.replace('{repo}', 'o/r')).host; } catch { return ''; } };
  const h = host(url), t = /^https:\/\//.test(url) && h && (h === 'github.com' || (!!cloneUrl && h === host(cloneUrl))) ? token() : undefined;
  return t ? { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraheader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${t}`).toString('base64')}` } : process.env;
}

// State qualifier for GitHub search, and a validated author (a login has no spaces: so no other qualifiers sneak in)
const stateQ = (state: string) => (state === 'open' ? 'is:open' : state === 'merged' ? 'is:merged' : state === 'closed' ? 'is:closed is:unmerged' : '');
const login = (a?: string) => {
  if (a && !/^[\w.@+[\]-]{1,100}$/.test(a)) throw new Error(t('src.badLogin'));
  return a;
};
type GhPR = { number: number; title: string; user: { login: string } | null; state: string; pull_request?: { merged_at: string | null }; merged_at?: string | null; created_at: string; updated_at: string; base?: { ref: string }; head?: { ref: string }; repository_url?: string; html_url?: string };
const ghPR = (p: GhPR) => ({ id: String(p.number), title: p.title, author: p.user?.login, state: (p.pull_request?.merged_at ?? p.merged_at) ? 'merged' as const : p.state === 'open' ? 'open' as const : 'closed' as const, created: p.created_at, updated: p.updated_at, base: p.base?.ref, head: p.head?.ref, url: p.html_url });

export function githubSource(cfg: SourcesCfg['github'] = {}): Source {
  const api = (cfg.apiUrl ?? 'https://api.github.com').replace(/\/$/, '');
  // post: sends it as a JSON POST (only `comment` and `review` do, after the user confirmed them)
  const get = async <T>(path: string, post?: unknown): Promise<T> => {
    const token = githubToken(cfg.tokenEnv);
    if (!token) throw new Error(t('src.ghNoCreds'));
    const res = await fetch(api + path, { ...(post === undefined ? {} : { method: 'POST', body: JSON.stringify(post) }), headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'prpeer', 'x-github-api-version': '2022-11-28' } });
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${((await res.json().catch(() => ({}))) as { message?: string }).message ?? res.statusText}`);
    return res.json() as Promise<T>;
  };
  const title = (m: string) => m.split('\n')[0];
  return {
    id: 'github', label: 'GitHub',
    discussion: async (repo, id) => {
      type U = { user?: { login: string } | null };
      const [pr, cs, rs, ics] = await Promise.all([
        get<{ body: string | null; head: { ref: string } }>(`/repos/${repo}/pulls/${id}`),
        get<(U & { body: string })[]>(`/repos/${repo}/issues/${id}/comments?per_page=100`),
        get<(U & { body: string; state: string })[]>(`/repos/${repo}/pulls/${id}/reviews?per_page=100`),
        get<(U & { body: string; path: string; start_line?: number | null; line: number | null; original_line: number | null })[]>(`/repos/${repo}/pulls/${id}/comments?per_page=100`),
      ]);
      const who = (x: U) => x.user?.login ?? t('src.someone');
      return {
        body: pr.body ?? undefined, branch: pr.head.ref,
        items: [
          ...cs.map(c => ({ kind: 'comment' as const, author: who(c), text: c.body })),
          ...rs.filter(r => r.body).map(r => ({ kind: 'review' as const, author: who(r), text: r.body, state: r.state })),
          ...ics.map(c => ({ kind: 'inline' as const, author: who(c), text: c.body, path: c.path, start: c.start_line ?? undefined, line: c.line ?? c.original_line ?? undefined })),
        ],
      };
    },
    comment: async (repo, id, c) => {
      const r = await get<{ html_url?: string }>(`/repos/${repo}/pulls/${id}/comments`, { body: c.body, commit_id: c.commit, path: c.path, line: c.line, side: c.side });
      return { url: r.html_url };
    },
    review: async (repo, id, rv) => {
      const r = await get<{ html_url?: string }>(`/repos/${repo}/pulls/${id}/reviews`, { commit_id: rv.commit, body: rv.body, event: rv.event, comments: rv.comments });
      return { url: r.html_url };
    },
    prForCommit: async (repo, sha) => { const r = await get<{ number: number }[]>(`/repos/${repo}/commits/${sha}/pulls`).catch(() => []); return r[0] ? String(r[0].number) : undefined; },
    meta: async (repo, id) => {
      const pr = await get<{ html_url?: string; closed_at: string | null; user?: { login: string } | null; created_at: string; state: string; merged_at: string | null; draft?: boolean; comments: number; review_comments: number; mergeable_state?: string; head: { sha: string } }>(`/repos/${repo}/pulls/${id}`);
      // Checks (Actions, Codecov app...) and legacy statuses (Codecov, CircleCI...) end up as one list; a failure of either must not hide the rest.
      // Latest review per reviewer decides approvals; unresolved threads only exist in GraphQL (a failure just hides that chip).
      const [owner, name] = repo.split('/'), token = githubToken(cfg.tokenEnv);
      const [runs, sts, revs, unresolved] = await Promise.all([
        get<{ check_runs: { id: number; name: string; status: string; conclusion: string | null; output?: { annotations_count?: number } }[] }>(`/repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`).then(r => r.check_runs).catch(() => []),
        get<{ statuses: { context: string; state: string }[] }>(`/repos/${repo}/commits/${pr.head.sha}/status`).then(r => r.statuses).catch(() => []),
        get<{ user?: { login: string } | null; state: string }[]>(`/repos/${repo}/pulls/${id}/reviews?per_page=100`).catch(() => []),
        fetch(api.replace(/\/v3$/, '') + '/graphql', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'user-agent': 'prpeer' }, body: JSON.stringify({ query: 'query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){reviewThreads(first:100){nodes{isResolved}}}}}', variables: { o: owner, n: name, p: Number(id) } }) })
          .then(r => r.json()).then((j: { data?: { repository?: { pullRequest?: { reviewThreads?: { nodes: { isResolved: boolean }[] } } } } }) => j.data?.repository?.pullRequest?.reviewThreads?.nodes.filter(n => !n.isResolved).length).catch(() => undefined),
      ]);
      const last = new Map<string, string>();
      for (const r of revs) if (r.user && r.state !== 'COMMENTED' && r.state !== 'PENDING') last.set(r.user.login, r.state);
      const states = [...last.values()];
      const checks = [
        ...runs.map(r => ({ name: r.name, state: r.status !== 'completed' ? 'wip' as const : r.conclusion === 'success' ? 'ok' as const : r.conclusion === 'skipped' || r.conclusion === 'neutral' ? 'skip' as const : 'fail' as const })),
        ...sts.map(x => ({ name: x.context, state: x.state === 'success' ? 'ok' as const : x.state === 'pending' ? 'wip' as const : 'fail' as const })),
      ];
      // failed check runs say where they failed (file and lines): the map marks those cards. At most 10 runs × 50 annotations.
      type Ann = { path: string; start_line: number; end_line: number; annotation_level: string; message: string; title?: string | null };
      const failed = runs.filter(r => r.status === 'completed' && !['success', 'skipped', 'neutral'].includes(r.conclusion ?? '') && (r.output?.annotations_count ?? 0) > 0).slice(0, 10);
      const annotations = (await Promise.all(failed.map(r => get<Ann[]>(`/repos/${repo}/check-runs/${r.id}/annotations?per_page=50`)
        .then(as => as.map(a => ({ check: r.name, path: a.path, line: a.start_line, end: a.end_line, level: a.annotation_level, message: (a.title ? a.title + ': ' : '') + a.message.slice(0, 1000) }))).catch(() => [])))).flat();
      return { annotations, id, url: pr.html_url, approvals: states.filter(s => s === 'APPROVED').length, changesRequested: states.filter(s => s === 'CHANGES_REQUESTED').length, unresolved, closed: pr.merged_at ?? pr.closed_at ?? undefined, author: pr.user?.login, created: pr.created_at, state: pr.merged_at ? 'merged' : pr.state, draft: pr.draft, comments: pr.comments + pr.review_comments, conflicts: pr.mergeable_state === 'dirty' ? true : pr.mergeable_state === 'unknown' ? undefined : false, checks };
    },
    status: async () => {
      const off = !!entry('github').off, found = githubCred(cfg.tokenEnv, true), ready = !off && !!found.token;
      return { ready, off, from: found.from, ...(ready ? {} : { hint: off ? t('src.ghOffHint') : t('src.ghHint') }) };
    },
    repos: async () => {
      const all: RepoRef[] = [], me = (await get<{ login: string }>('/user')).login.toLowerCase();
      for (let page = 1; page <= 5; page++) {
        const r = await get<{ full_name: string; description: string | null; pushed_at: string; private: boolean; html_url: string }[]>(`/user/repos?per_page=100&sort=pushed&page=${page}`);
        all.push(...r.map(x => ({ id: x.full_name, desc: x.description ?? undefined, updated: x.pushed_at, private: x.private, mine: x.full_name.split('/')[0].toLowerCase() === me, url: x.html_url })));
        if (r.length < 100) break;
      }
      return all;
    },
    // With an author the search is used (/pulls cannot filter by author): so their PRs show up even beyond the first page.
    prs: async (repo, state, page = 1, author) => {
      const who = login(author);
      if (who) {
        const r = await get<{ items: GhPR[] }>(`/search/issues?q=${encodeURIComponent(`is:pr repo:${repo} author:${who} ${stateQ(state)}`.replace(/\s+/g, ' ').trim())}&sort=updated&order=desc&per_page=50&page=${page}`);
        return r.items.map(ghPR);
      }
      return (await get<GhPR[]>(`/repos/${repo}/pulls?state=${state === 'open' ? 'open' : state === 'all' ? 'all' : 'closed'}&per_page=50&page=${page}&sort=updated&direction=desc`))
        .filter(p => state !== 'merged' || p.merged_at)
        .map(ghPR);
    },
    // The author is shown by login (as in PRs) and falls back to the git name if the email is not linked to an account.
    commits: async (repo, ref, page = 1, author) => (await get<{ sha: string; commit: { message: string; author: { name: string; date: string } }; author?: { login: string } | null; html_url?: string }[]>(
      `/repos/${repo}/commits?per_page=50&page=${page}${ref ? `&sha=${encodeURIComponent(ref)}` : ''}${login(author) ? `&author=${encodeURIComponent(author!)}` : ''}`))
      .map(c => ({ id: c.sha, title: title(c.commit.message), author: c.author?.login ?? c.commit.author?.name, date: c.commit.author?.date, url: c.html_url })),
    // GitHub search (/search) covers all the owner's repos at once (user: works for users and organizations).
    // ':' and quotes are removed from the text: it cannot sneak other qualifiers (repo:, org:…) into the query.
    search: async (kind, owner, { q, state, page, author }) => {
      const text = q.replace(/[:"()]/g, ' ').trim(), pg = `per_page=50&page=${page}&order=desc`, who = login(author), aq = who ? `author:${who}` : '';
      if (kind === 'commits') {
        const r = await get<{ items: { sha: string; commit: { message: string; author: { name: string; date: string } }; author?: { login: string } | null; repository: { full_name: string }; html_url?: string }[] }>(
          `/search/commits?q=${encodeURIComponent(`user:${owner} ${aq} ${text}`.replace(/\s+/g, ' ').trim())}&sort=author-date&${pg}`);
        return r.items.map(c => ({ id: c.sha, title: title(c.commit.message), author: c.author?.login ?? c.commit.author?.name, date: c.commit.author?.date, repo: c.repository.full_name, url: c.html_url }));
      }
      // '_mine' / '_review' are not owners (a login cannot start with '_'): they are the viewer's own PRs, and the PRs waiting for their review
      const scope = owner === '_mine' ? 'author:@me' : owner === '_review' ? 'review-requested:@me' : `user:${owner}`;
      const r = await get<{ items: GhPR[] }>(`/search/issues?q=${encodeURIComponent(`is:pr ${scope} ${aq} ${stateQ(state)} ${text ? text + ' in:title' : ''}`.replace(/\s+/g, ' ').trim())}&sort=updated&${pg}`);
      return r.items.map(p => ({ ...ghPR(p), repo: p.repository_url!.replace(/^.*\/repos\//, '') }));
    },
    resolve: async (repo, kind, id) => {
      if (kind === 'commit') {
        const c = await get<{ sha: string; html_url?: string; parents: { sha: string }[]; commit: { message: string } }>(`/repos/${repo}/commits/${id}`);
        const parent = c.parents[0]?.sha; // root commit: compared against the empty tree
        return { title: title(c.commit.message), baseRef: parent ?? EMPTY_TREE, head: c.sha, refspecs: [], need: [c.sha, ...(parent ? [parent] : [])], url: c.html_url };
      }
      const p = await get<{ title: string; html_url?: string; merged: boolean; base: { ref: string; sha: string }; head: { sha: string } }>(`/repos/${repo}/pulls/${id}`);
      // merged: the current base already contains the PR (empty diff); the base it had when merged is used
      return { title: p.title, baseRef: p.merged ? p.base.sha : `origin/${p.base.ref}`, head: p.head.sha, refspecs: [`refs/pull/${id}/head`, p.base.ref], need: [], url: p.html_url };
    },
  };
}
