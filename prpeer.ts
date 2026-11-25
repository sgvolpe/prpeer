#!/usr/bin/env node
// A GitHub PR URL (https://github.com/o/r/pull/N) starts the app and opens that PR in the browser from any folder.
// Usage: prpeer [<PR-url | number | branch>] [--base <ref>] [--repo <dir>] [--json] [--keep] [--sections] [--links] [--max-links N]
//            [--serve] [--port N] [--config file] [--no-open] [-v|--verbose] [--debug]       (with no PR and --serve: opens the home screen)
import { execFileSync, spawn } from 'node:child_process';
import { analyze } from './analyze.ts';
import { banner } from './banner.ts';
import { createApp } from './app.ts';
import { setDefaultLang } from './i18n.ts';
import { loadConfig } from './llm.ts';
import { serve } from './serve.ts';

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 && !!args.splice(i, 1); };
const repo = opt('--repo') ?? process.cwd();
const baseOpt = opt('--base');
const asJson = flag('--json');
const keep = flag('--keep');
const showSections = flag('--sections');
const showLinks = flag('--links');
const serveFlag = flag('--serve');
const noOpen = flag('--no-open');
const debug = flag('--debug') || !!process.env.PRPEER_DEBUG; // verbose + every git/gh command + full stack traces
const verbose = flag('--verbose') || flag('-v') || debug;
const configPath = opt('--config');
const port = Number(opt('--port') ?? 4173);
const maxLinks = Number(opt('--max-links') ?? 8);
const target = args[0];
// A GitHub PR URL needs no clone nor --serve: it starts the app, clones the repo if missing and opens the PR in the browser
const ghPr = /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/.exec(target ?? '');
const doServe = serveFlag || !!ghPr;
if (!target && !doServe) {
  console.error('usage: prpeer [<PR-url|number|branch>] [--base ref] [--repo dir] [--json] [--keep] [--sections] [--links] [--max-links N] [--serve] [--port N] [--config file] [--no-open] [-v|--verbose] [--debug]');
  process.exit(2);
}

const run = (cmd: string, a: string[]) => {
  const t0 = Date.now();
  try { return execFileSync(cmd, a, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }); }
  finally { if (debug) console.error(`[debug] ${cmd} ${a.join(' ')}  ${Date.now() - t0}ms`); }
};
const git = (...a: string[]) => run('git', a).trim();

function resolve() {
  // shortcut: for PRs it assumes `repo` is a clone of the PR's repo (remote `origin`), pass --repo otherwise
  if (/^\d+$|\/pull\/\d+/.test(target)) {
    const n = target.match(/(\d+)\/?$/)![1];
    let info: { title: string; baseRefName: string; baseRefOid: string; state: string } | undefined;
    try { info = JSON.parse(run('gh', ['pr', 'view', target, '--json', 'title,baseRefName,baseRefOid,state'])); }
    catch { if (!baseOpt) throw new Error('without `gh` I cannot know the PR base branch; pass --base origin/<branch>'); }
    git('fetch', 'origin', `refs/pull/${n}/head`);
    const head = git('rev-parse', 'FETCH_HEAD');
    const baseName = info?.baseRefName ?? baseOpt!.replace(/^origin\//, '');
    git('fetch', 'origin', baseName);
    return { title: info?.title ?? git('log', '-1', '--format=%s', head),
    // merged: the current base already contains the PR (empty diff); use the base it had when merged
    baseRef: baseOpt ?? (info!.state === 'MERGED' ? info!.baseRefOid : `origin/${info!.baseRefName}`), head };
  }
  let head: string;
  try { head = git('rev-parse', '--verify', target); } catch { throw new Error(`cannot find the branch or ref "${target}" in ${repo}`); }
  let baseRef = baseOpt;
  if (!baseRef) {
    try { baseRef = git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD'); }
    catch { baseRef = ['main', 'master'].find(b => { try { git('rev-parse', '--verify', b); return true; } catch { return false; } }); }
  }
  if (!baseRef) throw new Error('could not detect the base branch; pass --base');
  return { title: git('log', '-1', '--format=%s', head), baseRef, head };
}

let serving = false;
let analysis: ReturnType<typeof analyze> | undefined;
try {
  const cfg = doServe ? loadConfig(configPath) : undefined;
  setDefaultLang(cfg?.lang);
  if (target && !ghPr) {
    const { title, baseRef, head } = resolve();
    analysis = analyze({ repo, title, baseRef, head, moodCfg: cfg?.mood, maxLinks, keep });
  }
  if (doServe) {
    banner();
    const app = createApp(cfg!, [repo]);
    if (analysis) app.addSession(analysis.payload, analysis.cleanup, true);
    let path = analysis ? '' : '/home';
    if (ghPr) {
      const open = () => app.api.open({ source: 'github', repo: ghPr[1], kind: 'pr', id: ghPr[2] }) as Promise<{ sid: string }>;
      console.log(`prpeer: analyzing ${ghPr[1]}#${ghPr[2]}…`);
      let r: { sid: string };
      try { r = await open(); }
      catch (e) {
        if ((e as { code?: string }).code !== 'needs_clone') throw e;
        console.log(`prpeer: no local clone of ${ghPr[1]}; cloning it into the prpeer cache…`);
        await app.api.clone({ repo: ghPr[1] });
        r = await open();
      }
      path = `/pr/${r.sid}`;
    }
    serving = true;
    const srv = serve(port, app.api, verbose ? s => console.log(`${new Date().toLocaleTimeString()} ${s}`) : undefined);
    const bye = () => { console.log('\nprpeer: the duck goes back to sleep. Ship it (carefully).'); srv.close(); app.shutdown(); process.exit(0); };
    for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(s, bye); // SIGHUP: the terminal was closed
    srv.on('error', e => { console.error(`prpeer: could not open port ${port} (${(e as Error).message}); try --port N`); app.shutdown(); process.exit(1); });
    const url = `http://localhost:${port}${path}`;
    console.log(`prpeer: ${url}  (Ctrl-C to quit)${debug ? '  · debug on' : verbose ? '  · logs on' : ''}`);
    if (!noOpen) srv.on('listening', () => { // default browser; if that fails, the URL is already printed
      const [cmd, ...a] = process.platform === 'win32' || process.env.WSL_DISTRO_NAME ? ['cmd.exe', '/c', 'start', '', url] : process.platform === 'darwin' ? ['open', url] : ['xdg-open', url];
      spawn(cmd, a, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    });
  } else if (analysis) {
    const { payload, dir, hasPython } = analysis;
    const { title, files, links, linked } = payload;
    if (asJson) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`${title}\n${payload.base.ref}...${payload.head.slice(0, 8)}  worktree: ${dir}`);
      if (!files.length) console.log('(no changes; if the PR is already merged and there is no gh, pass --base <sha of the original base>)');
      const nl = links.length;
      if (nl || !hasPython) console.log(hasPython ? `${nl} links, ${linked.length} linked files` : '(no python: no per-function sections or links)');
      for (const f of files) {
        console.log(`${f.status.padEnd(8)} ${f.binary ? 'binary' : `+${f.add} -${f.del}`.padEnd(10)} ${f.path}${f.oldPath ? ` (← ${f.oldPath})` : ''}`);
        if (showSections) for (const s of f.sections) console.log(`           · ${s.name}  +${s.add} -${s.del}  L${s.first}-${s.last}${s.doc ? '  ▸ ' + s.doc.split('\n')[0].slice(0, 60) : ''}`);
      }
      if (showLinks) for (const l of links) console.log(`  ${l.kind.padEnd(6)} ${l.from} → ${l.to}`);
    }
  }
} catch (e) {
  const msg = (e as { stderr?: string }).stderr?.trim() || (e as Error).message;
  console.error('prpeer:', msg, /not a git repository/.test(msg) ? `\n(run prpeer inside the repo or pass --repo <folder>; current repo: ${repo})` : '');
  if (debug) console.error(e);
  process.exitCode = 1;
} finally {
  if (!serving) analysis?.cleanup();
}

