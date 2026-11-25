import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { analyze } from './analyze.ts';
import { ask, type AskBody, type Payload } from './ask.ts';
import { scanPayload } from './scan.ts';
import { entry, okSecret, setEntry } from './connections.ts';
import { t } from './i18n.ts';
import { intents, type Discussion } from './sources.ts';
import { jiraConfig, jiraGet, jiraIssues, jiraKeys, okJiraUrl, type JiraIssue } from './jira.ts';
import { llmInfo, stream, type Config } from './llm.ts';
import { fileLines, slimPayload } from './slim.ts';
import { discoverRepos, expand, forgetTokenCache, gitAuthEnv, githubSource, githubToken, localSource, type RepoRef, type Resolved, type Source } from './sources.ts';
import type { Api } from './serve.ts';
import { LIMITS, readSettings, writeSettings } from './settings.ts';
import { newUsage, readAll, record, totals } from './usage.ts';

const MAX_SESSIONS = 4; // default; each session keeps a temporary worktree, the oldest ones are closed
const GRAPH_LIMIT = 400;
const ID = /^[\w.-]+\/[\w.-]+$/;
const REF = /^(?!-)[\w./@+-]+$/; // never starts with '-': it would reach git as if it were an option
const okRepo = (id: unknown): id is string => typeof id === 'string' && ID.test(id) && !id.split('/').some(p => p === '.' || p === '..');
const authorOf = (a?: string) => { // login, email or name (no odd characters and never starting with '-': it would reach git as an option)
  if (a && !/^(?!-)[\w.@+ \[\]-]{1,100}$/.test(a)) throw coded(t('err.badAuthor'), 'bad_request');
  return a || undefined;
};
const pageOf = (p?: number) => (Number.isInteger(p) && p! >= 1 && p! <= 100 ? p! : 1);
// the message is already localized (t() at the call site); `code` is what the client switches on
const coded = (msg: string, code: string, status = 400) => Object.assign(new Error(msg), { code, status });

// What each session opened from the app was (the last 50), so its /pr/<sid> link reopens it after a restart.
type Opened = { sid: string; source: string; repo: string; kind: 'pr' | 'commit'; id: string };
const openedFile = () => join(process.env.PRPEER_HOME ?? join(homedir(), '.prpeer'), 'sessions.json');
const readOpened = (): Opened[] => { try { const a = JSON.parse(readFileSync(openedFile(), 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; } };
const remember = (o: Opened) => {
  try { mkdirSync(dirname(openedFile()), { recursive: true }); writeFileSync(openedFile(), JSON.stringify([...readOpened().filter(x => x.sid !== o.sid), o].slice(-50))); } catch { /* best effort: the link just will not survive */ }
};

// usual clone folders; missing ones are skipped. Desktop last: the scan stops after 5000 folders in total
export const DEFAULT_REPO_DIRS = ['~/repos', '~/code', '~/projects', '~/src', '~/dev', '~/git', '~/source/repos', '~/Documents/GitHub', '~/Desktop'];
export function createApp(cfg: Config, extraDirs: string[] = []) {
  // ---- local clones: explicit config > discovered through their remote > prpeer cache
  let disco: Map<string, string> | undefined;
  const cacheDir = (id: string) => join(expand(cfg.cacheDir ?? '~/.prpeer/repos'), id.replace('/', '__'));
  const repoDirs = () => readSettings().repoDirs ?? cfg.repoDirs ?? DEFAULT_REPO_DIRS; // UI settings > config.json > defaults
  const discover = (force = false) => {
    if (force || !disco) {
      disco = discoverRepos(repoDirs());
      for (const d of extraDirs) for (const [k, v] of discoverRepos([d], 0)) disco.set(k, v);
    }
    return disco;
  };
  const dirFor = (id: string): string | undefined => {
    const c = cfg.repos?.[id] ? expand(cfg.repos[id]) : undefined;
    if (c && existsSync(c)) return c;
    return discover().get(id) ?? (existsSync(cacheDir(id)) ? cacheDir(id) : undefined);
  };
  const listLocal = (): RepoRef[] => [...discover()].map(([id, local]) => ({ id, local })).sort((a, b) => a.id.localeCompare(b.id));
  const connId = (target: unknown) => {
    if (target === 'github' || target === 'jira') return target;
    const p = typeof target === 'string' && target.startsWith('p:') ? cfg.providers.find(x => 'p:' + x.id === target) : undefined;
    if (!p) throw coded(t('err.unknownConn'), 'bad_target');
    return 'p:' + p.id;
  };
  const sources: Source[] = [localSource(dirFor, listLocal), githubSource(cfg.github)];
  const pick = (id: string) => sources.find(s => s.id === id) ?? (() => { throw coded(t('err.unknownSource', { id }), 'bad_source'); })();

  // ---- git with credentials through a header (they do not stay in .git/config) for GitHub https remotes
  const authEnv = (url: string) => gitAuthEnv(url, () => githubToken(cfg.github?.tokenEnv), cfg.github?.cloneUrl);
  const git = (dir: string, args: string[], timeout = 180_000) => {
    let url = '';
    try { url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* no origin */ }
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', timeout, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'], env: authEnv(url) });
  };
  const prepare = (dir: string, r: Resolved) => {
    for (const rs of r.refspecs) git(dir, ['fetch', 'origin', rs]);
    for (const sha of r.need) {
      try { execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: dir, stdio: 'ignore' }); } catch { git(dir, ['fetch', 'origin', sha]); }
    }
  };

  // ---- sessions: one analyzed PR/commit = one worktree + its payload
  const sessions = new Map<string, { payload: ReturnType<typeof analyze>['payload']; slim: unknown; cleanup: () => void; meta?: { source: string; repo: string; kind: string; id: string } }>();
  let initial: string | undefined;
  const addSession = (payload: ReturnType<typeof analyze>['payload'], cleanup: () => void, isInitial = false, meta?: { source: string; repo: string; kind: string; id: string }, reuse?: string) => {
    const sid = reuse ?? randomBytes(4).toString('hex');
    sessions.set(sid, { payload, slim: slimPayload(payload as never), cleanup, meta });
    if (isInitial) initial = sid;
    while (sessions.size > (readSettings().maxSessions ?? MAX_SESSIONS)) {
      const old = [...sessions].find(([k]) => k !== initial);
      if (!old) break;
      old[1].cleanup();
      sessions.delete(old[0]);
    }
    return sid;
  };
  // usage is grouped per PR across sessions: repo#id when opened from the UI, else the title
  const prKey = (s: { payload: { title: string }; meta?: { repo: string; kind: string; id: string } }) => s.meta ? `${s.meta.repo}${s.meta.kind === 'pr' ? '#' : '@'}${s.meta.id}` : s.payload.title;
  const session = (sid: string) => sessions.get(sid) ?? (() => { throw coded(t('err.noSession'), 'no_session', 404); })();

  // PR commits and Jira tickets cited in the title, branch or commits (once per session)
  const talks = new Map<string, Promise<Discussion | null>>(); // PR description and comments (only sources that have them); a failure breaks nothing
  const discussionOf = (sid: string) => {
    let t = talks.get(sid);
    if (!t) {
      const meta = session(sid).meta;
      t = (meta?.kind === 'pr' && okRepo(meta.repo) ? pick(meta.source).discussion?.(meta.repo, meta.id) : undefined)?.catch(() => null) ?? Promise.resolve(null);
      talks.set(sid, t);
    }
    return t;
  };
  const stories = new Map<string, Promise<{ keys: string[]; commits: string[] }>>(); // tickets are requested every time: if Jira gets connected later, next time they already carry content
  const storyInfo = (sid: string) => {
    let s = stories.get(sid);
    if (!s) {
      const p = session(sid).payload as unknown as { title: string; head: string; worktree: string; base: { sha?: string } };
      s = (async () => {
        let commits: string[] = [];
        try { commits = execFileSync('git', ['log', '-n', '50', '--format=%s', `${p.base.sha}..${p.head}`], { cwd: p.worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 }).split('\n').filter(Boolean); } catch { /* unresolvable range: no commits */ }
        const d = await discussionOf(sid);
        return { keys: jiraKeys(p.title, p.head, d?.branch, d?.body, ...commits), commits };
      })();
      stories.set(sid, s);
    }
    return s.then(async x => ({ jira: await jiraIssues(x.keys), commits: x.commits }));
  };

  // extra context for the story and the reviews
  const extraFor = async (sid: string, b: AskBody) => {
    const { jira, commits } = await storyInfo(sid), d = await discussionOf(sid);
    const story = b.task === 'story' || b.task === 'summary', tool = b.tool; // the PR summary opens with what tickets, description, commits and comments asked for
    let extra = '';
    if (story || tool !== 'comments') {
      if (jira.length) extra += t('ai.extra.jira') + jira.map(j => `${j.key}${j.status ? ` [${j.status}]` : ''}${j.summary ? ': ' + j.summary : j.error ? t('ai.extra.jiraError', { error: j.error }) : t('ai.extra.jiraKeyOnly')}${j.description ? '\n' + j.description.slice(0, 2000) : ''}\n`).join('');
      if (commits.length) extra += t('ai.extra.commits') + commits.join('\n') + '\n';
      const its = intents(d);
      if (its.size) extra += t('ai.extra.intents') + [...its].map(([id, xs]) => `${id}\n` + xs.map(x => `  ${x.where}: ${x.text.slice(0, 400)}`).join('\n')).join('\n') + '\n';
      if (d?.body && (story || tool === 'coherence')) extra += t('ai.extra.prBody') + d.body.slice(0, 4000) + '\n';
    }
    if (tool === 'comments') return commentsText(d);
    if (b.task === 'summary') return extra + commentsText(d, 30, 400); // summary: only the latest human comments, short
    if (story) return extra;
    if (tool === 'security') {
      const f = scanPayload(session(sid).payload as unknown as Payload);
      extra += t('ai.extra.scan') + (f.length ? f.map(x => `[${x.level}] ${x.path}${x.line ? ':' + x.line : ''} ${x.rule} (${x.sample})`).join('\n') : t('ai.extra.none')) + '\n';
    }
    return extra;
  };
  const commentsText = (d: Discussion | null, max = 80, len = 1200) => {
    const items = max < 80 ? (d?.items ?? []).filter(i => !/\[bot\]$|-bot$/i.test(i.author)).slice(-max) : (d?.items ?? []).slice(0, max);
    return t('ai.extra.comments') + (!d ? t('ai.extra.noExpose') : items.length ? items.map(i => `[${i.kind}${i.state ? ' ' + i.state : ''}] ${i.author}${i.path ? t('ai.extra.at', { where: i.path + (i.line ? ':' + i.line : '') }) : ''}: ${i.text.slice(0, len)}`).join('\n') : t('ai.extra.noComments')) + '\n';
  };

  // open and clone touch git: one at a time
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(f: () => Promise<T>) => { const p = chain.then(f, f); chain = p.catch(() => {}); return p; };
  const openNow = async (b: unknown, reuse?: string) => {
    const { source, repo, kind, id } = (b ?? {}) as { source: string; repo: string; kind: 'pr' | 'commit'; id: string };
    if ((kind !== 'pr' && kind !== 'commit') || typeof id !== 'string' || !REF.test(id) || !okRepo(repo)) throw coded(t('err.badRequest'), 'bad_request');
    const dir = dirFor(repo);
    if (!dir) throw coded(t('err.needsClone', { repo }), 'needs_clone', 409);
    const r = await pick(source).resolve(repo, kind, id, dir);
    prepare(dir, r);
    const a = analyze({ repo: dir, title: r.title, baseRef: r.baseRef, head: r.head, moodCfg: cfg.mood });
    return addSession(r.url ? { ...a.payload, url: r.url } : a.payload, a.cleanup, false, { source, repo, kind, id }, reuse);
  };

  const api: Api = {
    initial: () => initial,
    page: sid => { const s = sessions.get(sid); return s && { ...(s.slim as object), sid, canComment: s.meta?.kind === 'pr' && !!sources.find(x => x.id === s.meta!.source)?.comment }; },
    // A comment on one line of the PR, written and sent by the user (the UI asks for confirmation). The only write prpeer
    // does on the host: the AI never calls it. The line must be one of the PR's changed lines, as the host requires.
    comment: async (sid, body) => {
      const s = session(sid), m = s.meta, src = m?.kind === 'pr' && okRepo(m.repo) ? pick(m.source) : undefined;
      if (!m || !src?.comment) throw coded(t('err.noComment'), 'bad_request');
      const { path, line, side, text } = (body ?? {}) as { path?: unknown; line?: unknown; side?: unknown; text?: unknown };
      const p = s.payload as unknown as Payload & { head: string };
      const okLine = p.files.find(f => f.path === path)?.sections.some(x => x.lines.some(l => side === 'LEFT' ? l.k === '-' && l.o === line : side === 'RIGHT' && l.k === '+' && l.n === line));
      if (typeof text !== 'string' || !text.trim() || text.length > 20_000 || !okLine) throw coded(t('err.badRequest'), 'bad_request');
      return src.comment(m.repo, m.id, { path: path as string, line: line as number, side: side as 'LEFT' | 'RIGHT', body: text, commit: p.head });
    },
    info: () => llmInfo(cfg),
    connect: async body => {
      const { target, secret, url, email } = (body ?? {}) as { target?: unknown; secret?: unknown; url?: unknown; email?: unknown };
      const id = connId(target);
      if (secret === undefined || secret === '') { const { off: _off, ...keep } = entry(id); setEntry(id, keep.secret ? keep : null); } // only reactivate what was already there
      else {
        if (!okSecret(secret)) throw coded(t('err.badSecret'), 'bad_secret');
        if (id === 'github') {
          const r = await fetch((cfg.github?.apiUrl ?? 'https://api.github.com').replace(/\/$/, '') + '/user', { headers: { authorization: `Bearer ${secret}`, 'user-agent': 'prpeer' } }).catch(() => undefined);
          if (!r) throw coded(t('err.githubUnreachable'), 'github_unreachable', 502);
          if (!r.ok) throw coded(t('err.githubRejected', { status: r.status }), 'bad_token', 401);
        }
        if (id === 'jira') { // Jira needs a site and an email besides the token; it is checked before saving
          if (!okJiraUrl(url) || typeof email !== 'string' || !/^\S+@\S+$/.test(email)) throw coded(t('err.jiraNeeds'), 'bad_request');
          const r = await jiraGet({ PRPEER_JIRA_URL: url, PRPEER_JIRA_EMAIL: email, PRPEER_JIRA_TOKEN: secret }, '/rest/api/3/myself').catch(() => undefined);
          if (!r) throw coded(t('err.jiraUnreachable'), 'jira_unreachable', 502);
          if (!r.ok) throw coded(t('err.jiraRejected', { status: r.status }), 'bad_token', 401);
          setEntry(id, { secret, url, email });
        } else setEntry(id, { secret });
      }
      forgetTokenCache();
      return { ok: true };
    },
    disconnect: async body => { setEntry(connId((body as { target?: unknown })?.target), { off: true }); forgetTokenCache(); return { ok: true }; }, // also deletes what was saved
    file: (sid, path) => fileLines(session(sid).payload as never, path),
    meta: async sid => {
      const m = session(sid).meta;
      if (!m || !okRepo(m.repo)) return null;
      const src = pick(m.source), id = m.kind === 'pr' ? m.id : m.kind === 'commit' ? await src.prForCommit?.(m.repo, m.id).catch(() => undefined) : undefined;
      return (id ? await src.meta?.(m.repo, id).catch(() => null) : null) ?? null; // sources without the data (local git) or a failure: no strip
    },
    story: async sid => ({ ...(await storyInfo(sid)), configured: !!jiraConfig().from }),
    integrations: async () => {
      const c = jiraConfig();
      return [{
        id: 'jira', label: 'Jira', ready: !c.off && !!c.from, off: !!c.off, from: c.from,
        hint: c.off ? t('conn.jira.offHint') : t('conn.jira.hint'),
        fields: [{ k: 'url', ph: t('conn.jira.phUrl') }, { k: 'email', ph: t('conn.jira.phEmail') }, { k: 'secret', ph: t('conn.jira.phToken'), secret: true }],
      }];
    },
    usage: sid => {
      const all = readAll();
      if (sid) { const k = prKey(session(sid)); return totals(all.filter(r => r.pr === k)); }
      const by = new Map<string, typeof all>();
      for (const r of all) by.set(r.pr, [...(by.get(r.pr) ?? []), r]);
      return { total: totals(all), prs: [...by].map(([pr, rs]) => ({ pr, title: rs.at(-1)!.title, last: rs.at(-1)!.ts, ...totals(rs) })).sort((a, b) => b.last.localeCompare(a.last)), recent: all.slice(-5000).reverse() }; // shortcut: the browser filters the last 5000 requests; move filtering here if the log grows past that
    },
    scan: sid => scanPayload(session(sid).payload as unknown as Payload),
    ask: async function* (sid, body, signal) {
      const b = body as AskBody;
      let extra = '';
      if (b?.task === 'story' || b?.task === 'review' || (b?.task === 'summary' && !b.files?.length)) extra = await extraFor(sid, b); // tickets, commits and comments are built by the server: the browser does not decide what is sent to the model
      const s = session(sid), u = newUsage();
      try { yield* ask(cfg, s.payload as unknown as Payload, b, signal, extra, u); }
      finally { record({ ...u, pr: prKey(s), title: s.payload.title, task: b.tool ? `review:${b.tool}` : b.task, provider: b.provider, model: b.model }); } // also on abort: the tokens were spent
    },
    sources: () => Promise.all(sources.map(async s => ({ id: s.id, label: s.label, ...(await s.status()) }))),
    repos: async (source, refresh) => {
      if (refresh) discover(true);
      return (await pick(source).repos()).map(r => ({ ...r, local: r.local ?? dirFor(r.id) }));
    },
    prs: (source, repo, state, page, author) => { if (!okRepo(repo)) throw coded(t('err.badRepo'), 'bad_request'); return pick(source).prs(repo, state, pageOf(page), authorOf(author)); },
    commits: (source, repo, ref, page, author) => { if (!okRepo(repo)) throw coded(t('err.badRepo'), 'bad_request'); if (ref && !REF.test(ref)) throw coded(t('err.badRef'), 'bad_ref'); return pick(source).commits(repo, ref, pageOf(page), authorOf(author)); },
    // Branch map: every branch's commits with their parents, newest first; the page lays out and draws the graph. Needs the local clone.
    graph: async repo => {
      if (!okRepo(repo)) throw coded(t('err.badRepo'), 'bad_request');
      const dir = dirFor(repo);
      if (!dir) throw coded(t('src.noClone', { repo }), 'needs_clone', 409);
      // shortcut: last N commits only (Ajustes > Datos), add paging if big repos need deeper history
      const out = execFileSync('git', ['log', '--branches', '--remotes', '--tags', 'HEAD', '--date-order', '-n', String(readSettings().graphLimit ?? GRAPH_LIMIT), '--format=%H%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s'], { cwd: dir, encoding: 'utf8', timeout: 20_000, maxBuffer: 1 << 26 });
      return out.split('\n').filter(Boolean).map(l => {
        const [id, parents, author, date, refs, title] = l.split('\x1f');
        return { id, parents: parents ? parents.split(' ') : [], author, date, refs: refs ? refs.split(', ') : [], title };
      });
    },
    // Short AI summary of a commit or a branch of the branch map (right click). The server builds the context from git.
    graphSummary: async body => {
      const { repo, kind, id } = (body ?? {}) as { repo?: unknown; kind?: unknown; id?: unknown };
      if (!okRepo(repo) || (kind !== 'commit' && kind !== 'branch') || typeof id !== 'string' || !REF.test(id)) throw coded(t('err.badRequest'), 'bad_request');
      const dir = dirFor(repo);
      if (!dir) throw coded(t('src.noClone', { repo }), 'needs_clone', 409);
      const git = (...a: string[]) => { try { return execFileSync('git', a, { cwd: dir, encoding: 'utf8', timeout: 20_000, maxBuffer: 1 << 26 }); } catch { return ''; } };
      let ctx: string;
      if (kind === 'commit') ctx = git('show', '--stat', '--patch', '--format=%s%n%n%b', id);
      else {
        const base = ['origin/HEAD', 'main', 'master'].find(b => git('rev-parse', '--verify', '--quiet', b)) ?? 'HEAD';
        const own = git('log', '-n', '40', '--format=- %s', `${base}..${id}`);
        ctx = own ? `Commits:\n${own}\n${git('diff', '--stat', `${base}...${id}`)}` : `Commits:\n${git('log', '-n', '20', '--format=- %s', id)}`; // the base branch itself: its latest commits
      }
      if (!ctx.trim()) throw coded(t('err.badRef'), 'bad_ref');
      const info = await llmInfo(cfg), prov = info.providers.find(p => p.ready && p.id === info.default.provider) ?? info.providers.find(p => p.ready); // the default if it can answer, else the first that can
      const model = (prov?.id === info.default.provider ? info.default.model : undefined) ?? prov?.models[0];
      if (!prov || !model) throw coded(t('ai.err.pickModel'), 'no_model');
      const system = `You summarize git history for a developer. Answer in at most 2 short sentences, plain text, no lists or markdown. ${t('ai.replyIn', { language: cfg.language ?? t('lang.name') })}`;
      const u = newUsage();
      let text = '';
      try { for await (const c of stream(cfg, prov.id, { system, messages: [{ role: 'user', content: `${kind === 'commit' ? 'Commit' : `Branch ${id}`}:\n${ctx.slice(0, 12_000)}` }], model, effort: 'low', maxTokens: 300, usage: u })) text += c; }
      finally { record({ ...u, pr: `${repo}@${id}`, title: id, task: 'graph', provider: prov.id, model }); }
      return { text: text.trim() };
    },
    search: (source, owner, kind, state, q, page, author) => {
      if (!/^[\w.-]{1,100}$/.test(owner) || owner === '.' || owner === '..') throw coded(t('err.badOwner'), 'bad_request');
      if (kind !== 'prs' && kind !== 'commits') throw coded(t('err.badSearchKind'), 'bad_request');
      const s = pick(source);
      if (!s.search) throw coded(t('err.noOwnerSearch'), 'bad_request');
      return s.search(kind, owner, { q: q.slice(0, 100), state, page: pageOf(page), author: authorOf(author) });
    },
    open: b => exclusive(async () => {
      const sid = await openNow(b), { source, repo, kind, id } = b as Opened; // openNow validated them
      remember({ sid, source, repo, kind, id });
      return { sid };
    }),
    // a /pr/<sid> link from before a restart (or a session closed for age): open the same thing again under the same sid
    reopen: sid => exclusive(async () => {
      if (sessions.has(sid)) return true;
      const o = readOpened().find(x => x.sid === sid);
      if (!o || !/^[0-9a-f]{8}$/.test(sid)) return false;
      await openNow(o, sid);
      return true;
    }),
    clone: b => exclusive(async () => {
      const { repo } = b as { repo: string };
      if (!okRepo(repo)) throw coded(t('err.badRepoName'), 'bad_request');
      const dest = cacheDir(repo);
      if (!existsSync(dest)) {
        mkdirSync(dirname(dest), { recursive: true });
        const url = (cfg.github?.cloneUrl ?? 'https://github.com/{repo}.git').replace('{repo}', repo);
        execFileSync('git', ['clone', url, dest], { encoding: 'utf8', timeout: 900_000, stdio: ['ignore', 'pipe', 'pipe'], env: authEnv(url) });
      }
      discover(true);
      return { path: dest };
    }),
  };
  // ---- Ajustes: where local repos are read from, limits and the clone cache
  const dirSize = (d: string): number => { let n = 0; try { for (const e of readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? dirSize(join(d, e.name)) : statSync(join(d, e.name)).size; } catch { /* unreadable: skip */ } return n; };
  const cacheRoot = () => expand(cfg.cacheDir ?? '~/.prpeer/repos');
  const inUse = () => new Set([...sessions.values()].map(x => x.meta?.repo));
  api.settings = async () => {
    const s = readSettings(), found = discover(true), dirs = [...found.values()], busy = inUse();
    let cache: { id: string; bytes: number; inUse: boolean }[] = [];
    try {
      cache = readdirSync(cacheRoot(), { withFileTypes: true }).filter(e => e.isDirectory() && e.name.includes('__'))
        .map(e => { const id = e.name.replace('__', '/'); return { id, bytes: dirSize(join(cacheRoot(), e.name)), inUse: busy.has(id) }; });
    } catch { /* no cache yet */ }
    return {
      repoDirs: repoDirs().map(d => ({ dir: d, exists: existsSync(expand(d)), repos: dirs.filter(x => x.startsWith(expand(d))).length })),
      custom: !!s.repoDirs, fromConfig: !s.repoDirs && !!cfg.repoDirs, defaults: DEFAULT_REPO_DIRS, found: found.size,
      maxSessions: s.maxSessions ?? MAX_SESSIONS, graphLimit: s.graphLimit ?? GRAPH_LIMIT, limits: LIMITS,
      sessions: sessions.size, cacheDir: cacheRoot(), cache,
    };
  };
  api.saveSettings = async body => { writeSettings(body as Record<string, unknown>); discover(true); return api.settings!(); };
  // deletes prpeer's own clones (only folders inside cacheDir, never the user's); the ones an open map uses are kept
  api.clearCache = body => exclusive(async () => {
    const want = (body as { repo?: unknown })?.repo;
    if (want !== undefined && !okRepo(want)) throw coded(t('err.badRepo'), 'bad_request');
    const busy = inUse();
    let removed = 0, kept = 0, names: string[] = [];
    try { names = readdirSync(cacheRoot()).filter(n => n.includes('__')); } catch { /* nothing cached */ }
    for (const n of names) {
      const id = n.replace('__', '/');
      if (want && id !== want) continue;
      if (busy.has(id)) { kept++; continue; }
      rmSync(join(cacheRoot(), n), { recursive: true, force: true, maxRetries: 3 });
      removed++;
    }
    discover(true);
    return { removed, kept };
  });
  return { api, addSession, shutdown: () => { for (const s of sessions.values()) s.cleanup(); sessions.clear(); } };
}
