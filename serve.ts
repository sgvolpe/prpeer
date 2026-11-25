import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { defaultLang, t, withLang } from './i18n.ts';

export type Api = {
  initial(): string | undefined;
  page(sid: string): unknown | undefined;
  info(): Promise<unknown>;
  file(sid: string, path: string): unknown;
  ask(sid: string, body: unknown, signal: AbortSignal): AsyncIterable<string>;
  usage(sid?: string): unknown; // LLM tokens and dollars: one PR's totals, or the whole history
  scan(sid: string): unknown; // secrets and dangerous signals in the added lines, no AI
  story(sid: string): Promise<unknown>;
  meta(sid: string): Promise<unknown>; // author, date, checks, comments and conflicts of the PR (null if the source lacks them)
  integrations(): Promise<unknown>; // Jira and other tools plugged in from Connections
  sources(): Promise<unknown>;
  repos(source: string, refresh: boolean): Promise<unknown>;
  prs(source: string, repo: string, state: string, page?: number, author?: string): Promise<unknown>;
  graph(repo: string): Promise<unknown>; // branch map: git log --graph --all of the local clone
  graphSummary(body: unknown): Promise<unknown>; // short AI summary of a commit or branch of the branch map
  commits(source: string, repo: string, ref?: string, page?: number, author?: string): Promise<unknown>;
  search(source: string, owner: string, kind: string, state: string, q: string, page?: number, author?: string): Promise<unknown>; // PRs or commits of all the repos of an owner
  open(body: unknown): Promise<unknown>;
  reopen?(sid: string): Promise<boolean>; // a remembered session (opened before a restart): open it again under the same sid
  comment?(sid: string, body: unknown): Promise<unknown>; // a line comment the user wrote, posted to the PR on its host
  diff?(sid: string, path: string, ctx: string, since?: string): unknown; // one file's diff with context ('3' | 'fn' | 'all'), or since an earlier head
  uses?(sid: string, name: string): unknown; // where a function or class name appears in the PR's head
  since?(sid: string, from: string): unknown; // files changed between an earlier head the user reviewed and this one
  grep?(sid: string, q: string): unknown; // text search in the PR's changed lines
  review?(sid: string, body: unknown): Promise<unknown>; // the user's notes posted as one review with a verdict
  clone(body: unknown): Promise<unknown>;
  connect(body: unknown): Promise<unknown>;
  disconnect(body: unknown): Promise<unknown>;
  settings?(): Promise<unknown>; // Ajustes: repo folders, limits, clone cache
  saveSettings?(body: unknown): Promise<unknown>;
  clearCache?(body: unknown): Promise<unknown>;
};

const readBody = (req: IncomingMessage, max = 2_000_000) => new Promise<string>((ok, fail) => {
  const big = t('http.bodyTooBig'); // resolved now: the 'data' callbacks may run outside the request's language context
  let s = '';
  req.on('data', c => { s += c; if (s.length > max) { fail(new Error(big)); req.destroy(); } });
  req.on('end', () => ok(s));
  req.on('error', fail);
});
// Defense in depth against XSS (a PR's code is untrusted data): nothing leaves this origin (no fetch, images or forms)
// and the page cannot be embedded. The map's inline handlers force 'unsafe-inline' in scripts.
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";
const send = (res: ServerResponse, status: number, type: string, body: string | Buffer) => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(type.startsWith('text/html') ? { 'content-security-policy': CSP } : {}) });
  res.end(body);
};
// Static assets: ETag + revalidate (no-cache = ask every time, 304 if unchanged; the files have no hash in their name) and gzip.
const gz = new Map<string, Buffer>();
const sendStatic = (req: IncomingMessage, res: ServerResponse, type: string, body: Buffer) => {
  const etag = `"${createHash('sha1').update(body).digest('base64url')}"`;
  const h: Record<string, string> = { 'content-type': type, 'cache-control': 'no-cache', etag, vary: 'accept-encoding', 'x-content-type-options': 'nosniff' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, h); res.end(); return; }
  let out = body;
  if (body.length > 1024 && /gzip/.test(String(req.headers['accept-encoding'] ?? ''))) {
    let z = gz.get(etag); if (!z) { z = gzipSync(body); gz.set(etag, z); if (gz.size > 50) gz.delete(gz.keys().next().value!); }
    h['content-encoding'] = 'gzip'; out = z;
  }
  res.writeHead(200, h); res.end(out);
};
const json = (res: ServerResponse, status: number, o: unknown) => send(res, status, 'application/json', JSON.stringify(o));

// Serves web/ (a PR's map at /pr/<session>, the home screen at /home) and the API. The PR is injected into the HTML
// (no fetch: the inline handlers need synchronous data).
// The request language comes from the x-prpeer-lang header; every response is built inside withLang so t() picks it up.
export function serve(port: number, api: Api, log?: (line: string) => void) {
  const web = join(import.meta.dirname, 'web');
  const file = (n: string) => readFileSync(join(web, n));
  // the client engine reads <html lang> as the server's default language
  const html = (n: string) => file(n).toString('utf8').replace('<html lang="es"', () => `<html lang="${defaultLang()}"`);
  const mapPage = (data: unknown) => html('index.html').replace('/*PRDATA*/null', () => JSON.stringify(data).replace(/</g, '\\u003c'));
  // the "session not found" page: a friendly screen with a link home; its texts come from locales.ts in the request's language
  const notFoundPage = () => html('notfound.html').replace(/\{\{([\w.]+)\}\}/g, (_, k: string) => t(k));
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  return createServer((req, res) => withLang(req.headers['x-prpeer-lang'], () => handle(req, res))).listen(port, '127.0.0.1');
  async function handle(req: IncomingMessage, res: ServerResponse) {
    // the API spends the user's credentials: only from our page (fixed Host against DNS rebinding + own header on POSTs against CSRF)
    if (!hosts.has(req.headers.host ?? '')) { res.writeHead(403); res.end(); return; }
    const url = new URL(req.url ?? '/', 'http://x'), u = url.pathname, q = (k: string) => url.searchParams.get(k) ?? '';
    const t0 = Date.now();
    // -v: one line per request (no query or body: they may carry private repos or keys); static files are not listed
    if (log && !/\.(js|css|svg|ico|gif)$/.test(u)) res.on('close', () => log(`${req.method} ${u} ${res.statusCode} ${Date.now() - t0}ms`));
    try {
      if (req.method === 'GET') {
        if (u === '/') { const sid = api.initial(); if (sid) { res.writeHead(302, { location: `/pr/${sid}` }); res.end(); } else { res.writeHead(302, { location: '/home' }); res.end(); } return; }
        if (u === '/favicon.ico') { res.writeHead(204); res.end(); return; }
        if (u === '/logo-peer.gif') return sendStatic(req, res, 'image/gif', file('logo-peer.gif'));
        if (u === '/favicon.svg') return sendStatic(req, res, 'image/svg+xml', file('favicon.svg'));
        if (u === '/dist/map.js' || u === '/dist/map.css') { // the map (React Flow) built with `npm run build`
          try { return sendStatic(req, res, u.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8', file(u.slice(1))); }
          catch { return send(res, 503, 'text/plain; charset=utf-8', t('http.mapNotBuilt')); }
        }
        if (u === '/query.js') return sendStatic(req, res, 'text/javascript; charset=utf-8', file('query.js'));
        if (u === '/i18n.js') return sendStatic(req, res, 'text/javascript; charset=utf-8', file('i18n.js'));
        if (u === '/locales.js') return sendStatic(req, res, 'text/javascript; charset=utf-8', file('locales.js'));
        if (u === '/home') return send(res, 200, 'text/html; charset=utf-8', html('home.html'));
        if (u === '/home.js') return sendStatic(req, res, 'text/javascript; charset=utf-8', file('home.js'));
        if (u === '/ui.css' || u === '/index.css' || u === '/home.css') return sendStatic(req, res, 'text/css; charset=utf-8', file(u.slice(1)));
        if (u === '/theme.js' || u === '/settings.js') return sendStatic(req, res, 'text/javascript; charset=utf-8', file(u.slice(1)));
        if (u === '/app.js') return sendStatic(req, res, 'text/javascript; charset=utf-8', file('app.js'));
        const m = /^\/pr\/(\w+)$/.exec(u);
        if (m) {
          let d = api.page(m[1]);
          if (!d && api.reopen && await api.reopen(m[1]).catch(e => { log?.(`reopen ${m[1]} failed: ${(e as Error).message}`); return false; })) d = api.page(m[1]);
          return d ? send(res, 200, 'text/html; charset=utf-8', mapPage(d)) : send(res, 404, 'text/html; charset=utf-8', notFoundPage());
        }
        if (u === '/api/story') return json(res, 200, (({ jira, configured }) => ({ jira, configured }))(await api.story(q('s')) as { jira: unknown; configured: unknown }));
        if (u === '/api/meta') return json(res, 200, await api.meta(q('s')));
        if (u === '/api/usage') return json(res, 200, api.usage(q('s') || undefined));
        if (u === '/api/scan') return json(res, 200, api.scan(q('s')));
        if (u === '/api/integrations') return json(res, 200, await api.integrations());
        if (u === '/api/settings' && api.settings) return json(res, 200, await api.settings());
        if (u === '/api/llm') return json(res, 200, await api.info());
        if (u === '/api/sources') return json(res, 200, await api.sources());
        if (u === '/api/repos') return json(res, 200, await api.repos(q('source'), q('refresh') === '1'));
        if (u === '/api/prs') return json(res, 200, await api.prs(q('source'), q('repo'), q('state') || 'open', Number(q('page')) || 1, q('author') || undefined));
        if (u === '/api/search') return json(res, 200, await api.search(q('source'), q('owner'), q('kind'), q('state') || 'open', q('q'), Number(q('page')) || 1, q('author') || undefined));
        if (u === '/api/commits') return json(res, 200, await api.commits(q('source'), q('repo'), q('ref') || undefined, Number(q('page')) || 1, q('author') || undefined));
        if (u === '/api/graph') return json(res, 200, await api.graph(q('repo')));
        if (u === '/api/grep' && api.grep) return json(res, 200, api.grep(q('s'), q('q')));
        if (u === '/api/since' && api.since) return json(res, 200, api.since(q('s'), q('from')));
        if (u === '/api/uses' && api.uses) return json(res, 200, api.uses(q('s'), q('name')));
        if (u === '/api/diff' && api.diff) return json(res, 200, api.diff(q('s'), q('path'), q('ctx'), q('since') || undefined));
        if (u === '/api/file') { const l = api.file(q('s'), q('path')); return json(res, l ? 200 : 404, l); }
      } else if (req.method === 'POST') {
        if (req.headers['x-prpeer'] !== '1') { res.writeHead(403); res.end(); return; }
        if (u === '/api/open') return json(res, 200, await api.open(JSON.parse(await readBody(req))));
        if (u === '/api/connect') return json(res, 200, await api.connect(JSON.parse(await readBody(req, 20_000))));
        if (u === '/api/disconnect') return json(res, 200, await api.disconnect(JSON.parse(await readBody(req, 20_000))));
        if (u === '/api/settings' && api.saveSettings) return json(res, 200, await api.saveSettings(JSON.parse(await readBody(req, 20_000))));
        if (u === '/api/cache/clear' && api.clearCache) return json(res, 200, await api.clearCache(JSON.parse(await readBody(req, 20_000))));
        if (u === '/api/review' && api.review) return json(res, 200, await api.review(q('s'), JSON.parse(await readBody(req, 500_000))));
        if (u === '/api/comment' && api.comment) return json(res, 200, await api.comment(q('s'), JSON.parse(await readBody(req, 40_000))));
        if (u === '/api/graph-summary') return json(res, 200, await api.graphSummary(JSON.parse(await readBody(req, 20_000))));
        if (u === '/api/clone') return json(res, 200, await api.clone(JSON.parse(await readBody(req))));
        if (u === '/api/ask') {
          const ac = new AbortController();
          res.on('close', () => { if (!res.writableEnded) ac.abort(); });
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
          try { for await (const c of api.ask(q('s'), JSON.parse(await readBody(req)), ac.signal)) res.write(c); }
          catch (e) { if (!ac.signal.aborted) { log?.(`ask error: ${(e as Error).message}`); res.write(`\n[error] ${(e as Error).message}`); } }
          res.end();
          return;
        }
      }
      res.writeHead(404); res.end();
    } catch (e) {
      const err = e as Error & { status?: number; code?: string; stderr?: string };
      const msg = (err.stderr?.trim() || err.message).slice(0, 500);
      if ((err.status ?? 500) >= 500) console.error(`prpeer: ${req.method} ${u} failed: ${msg}`); // internal errors are always shown, not only with -v
      if (!res.headersSent) json(res, err.status ?? 500, { error: msg, code: err.code });
      else res.end();
    }
  }
}
