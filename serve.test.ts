import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { serve, type Api } from './serve.ts';
import { setDefaultLang } from './i18n.ts';

// Fake API: what is tested here is the HTTP routing and the protections, not app.ts logic
const fake = (initial?: string): Api => ({
  initial: () => initial,
  page: sid => (sid === 'abc' ? { title: '</script><b>t</b>', sid } : undefined),
  info: async () => ({ ok: true }),
  file: (sid, path) => (sid === 'abc' && path === 'a.py' ? [[{ k: '+', t: 'x' }]] : null),
  ask: async function* (sid, body) { yield 'ho'; yield 'la'; if ((body as { fail?: boolean }).fail) throw new Error('boom'); },
  sources: async () => [],
  repos: async () => [],
  prs: async () => [],
  commits: async () => [],
  open: async b => { if ((b as { clone?: boolean }).clone) throw Object.assign(new Error('missing clone'), { code: 'needs_clone', status: 409 }); return { sid: 'abc' }; },
  clone: async () => ({ path: '/x' }),
});

async function withServer(api: Api, f: (base: string, port: number) => Promise<void>) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const srv = serve(port, api);
  await once(srv, 'listening');
  try { await f(`http://localhost:${port}`, port); } finally { srv.closeAllConnections(); srv.close(); }
}

test('routes: / redirects to the initial session or to /home; /pr/<sid> injects the PR and all its scripts resolve', async () => {
  await withServer(fake(), async base => {
    const r = await fetch(base + '/', { redirect: 'manual' });
    assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/home');
  });
  await withServer(fake('abc'), async base => {
    assert.equal((await fetch(base + '/', { redirect: 'manual' })).headers.get('location'), '/pr/abc');
    for (const path of ['/home', '/pr/abc']) {
      const res = await fetch(base + path), html = await res.text();
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-security-policy') ?? '', /connect-src 'self'.*frame-ancestors 'none'/); // CSP: nada sale del origen
      for (const m of html.matchAll(/<script src="([^"]+)"/g)) // relative scripts resolve against the page URL
        assert.equal((await fetch(new URL(m[1], base + path))).status, 200, `${path} -> ${m[1]}`);
    }
    assert.equal((await fetch(base + '/ui.css')).status, 200);
    const page = await (await fetch(base + '/pr/abc')).text();
    assert.ok(page.includes('window.PRDATA={') && page.includes('"sid":"abc"'));
    assert.equal(page.includes('</script><b>'), false); // the PR title cannot close the <script>
    assert.equal((await fetch(base + '/pr/zzz')).status, 404);
  });
});

test('API: files, errors with code and status, and POSTs require the own header', async () => {
  await withServer(fake(), async base => {
    assert.deepEqual(await (await fetch(`${base}/api/file?s=abc&path=a.py`)).json(), [[{ k: '+', t: 'x' }]]);
    assert.equal((await fetch(`${base}/api/file?s=abc&path=../x`)).status, 404);
    const post = (path: string, body: object, headers: Record<string, string> = {}) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal((await post('/api/open', {})).status, 403); // sin x-prpeer (CSRF)
    assert.equal((await post('/api/ask?s=abc', {})).status, 403);
    assert.deepEqual(await (await post('/api/open', {}, { 'x-prpeer': '1' })).json(), { sid: 'abc' });
    const bad = await post('/api/open', { clone: true }, { 'x-prpeer': '1' });
    assert.equal(bad.status, 409); assert.deepEqual(await bad.json(), { error: 'missing clone', code: 'needs_clone' });
    assert.equal(await (await post('/api/ask?s=abc', {}, { 'x-prpeer': '1' })).text(), 'hola');
    assert.equal(await (await post('/api/ask?s=abc', { fail: true }, { 'x-prpeer': '1' })).text(), 'hola\n[error] boom');
  });
});

test('language: x-prpeer-lang picks the language of server messages; i18n assets are served; <html lang> carries the default', async () => {
  const api = { ...fake('abc'), page: () => undefined } as Api;
  await withServer(api, async base => {
    const nf = await fetch(base + '/pr/zzz'), page = await nf.text(); // session not found: a friendly HTML page with a link home (and still a 404)
    assert.equal(nf.status, 404); assert.match(nf.headers.get('content-type')!, /text\/html/);
    assert.match(page, /<title>PR Peer · Sesión no encontrada<\/title>/); assert.match(page, /href="\/home"/); assert.equal(page.includes('{{'), false); // every placeholder was filled
    assert.match(await (await fetch(base + '/pr/zzz', { headers: { 'x-prpeer-lang': 'en' } })).text(), /<title>PR Peer · Session not found<\/title>/);
    assert.match(await (await fetch(base + '/pr/zzz', { headers: { 'x-prpeer-lang': 'xx' } })).text(), /Sesión no encontrada/); // unknown language: the default
    for (const f of ['/i18n.js', '/locales.js']) assert.equal((await fetch(base + f)).status, 200, f);
    assert.match(await (await fetch(base + '/home')).text(), /<html lang="es"/);
    setDefaultLang('en');
    try {
      assert.match(await (await fetch(base + '/home')).text(), /<html lang="en"/);
      assert.match(await (await fetch(base + '/pr/zzz')).text(), /Session not found/);
    } finally { setDefaultLang(); }
  });
});

test('a foreign Host (DNS rebinding) gets 403 everywhere', async () => {
  await withServer(fake('abc'), async (_base, port) => {
    const { request } = await import('node:http');
    const status = await new Promise<number>(ok => { const r = request({ host: '127.0.0.1', port, path: '/api/llm', headers: { host: 'evil.com' } }, res => ok(res.statusCode!)); r.end(); });
    assert.equal(status, 403);
  });
});

test('-v: one line per API request, no query and no static files', async () => {
  const lines: string[] = [], port = 20000 + Math.floor(Math.random() * 20000);
  const srv = serve(port, fake(), l => lines.push(l));
  await once(srv, 'listening');
  try {
    await (await fetch(`http://localhost:${port}/api/llm?secret=1`)).text();
    await (await fetch(`http://localhost:${port}/theme.js`)).text();
    await new Promise(r => setTimeout(r, 50)); // the log is written when the response closes
  } finally { srv.closeAllConnections(); srv.close(); }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^GET \/api\/llm 200 \d+ms$/);
});
