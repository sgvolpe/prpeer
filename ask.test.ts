import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ask, buildContext, buildPrompt, type Payload } from './ask.ts';
import { withLang } from './i18n.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PRPEER_HOME = mkdtempSync(join(tmpdir(), 'prpeer-ask-')); // the answer cache lives on disk: keep it out of the real home

const sec = (name: string, n: number, extra = '') => ({
  name, kind: 'fn', doc: extra || null, add: n, del: 0, first: 10, last: 10 + n,
  lines: Array.from({ length: n }, (_, i) => ({ k: '+' as const, t: `line ${i}`, n: 10 + i })),
});
const P: Payload = {
  title: 'feat: something', base: { ref: 'main' }, head: 'abcdef1234',
  files: [
    { path: 'a/x.py', status: 'modified', add: 30, del: 0, binary: false, doc: 'doc of x', sections: [sec('big', 30, 'does things'), sec('small', 2)] },
    { path: 'a/y.py', status: 'added', add: 5, del: 0, binary: false, doc: null, sections: [sec('f', 5)] },
  ],
  links: [{ from: 'a/x.py', to: 'a/y.py', kind: 'import' }, { from: 't/test_x.py', to: 'a/x.py', kind: 'test' }],
  linked: [{ path: 't/test_x.py' }], readmes: { a: 'README of a' }, changelog: [['Added', ['thing']]],
};
const cfg = { providers: [] };

// the default language is Spanish, so the Spanish labels below are the base-language output
test('level 0 has no code; level 2 includes more lines than level 1', () => {
  assert.equal(buildContext(P, undefined, 0).includes('line 0'), false);
  assert.ok(buildContext(P, ['a/x.py'], 1).includes('… 15 líneas más'));
  assert.equal(buildContext(P, ['a/x.py'], 2).includes('líneas más'), false);
});

test('the selection limits files and brings connections, README and docstrings', () => {
  const c = buildContext(P, ['a/x.py'], 1);
  assert.ok(c.includes('a/x.py') && !c.includes('== a/y.py'));
  assert.ok(c.includes('usa: a/y.py') && c.includes('lo usan: t/test_x.py'));
  assert.ok(c.includes('README (a): README of a') && c.includes('docstring del módulo: doc of x'));
  assert.ok(c.indexOf('big') < c.indexOf('small')); // by churn
});

test('no selection: PR summary + changelog; a selected file with no changes is listed', () => {
  const c = buildContext(P, undefined, 0);
  assert.ok(c.includes('2 archivos (+35 −0)') && c.includes('Changelog') && c.includes('modified a/x.py +30'));
  assert.ok(buildContext(P, ['t/test_x.py'], 1).includes('Seleccionados sin cambios'));
});

test('files in view become context: more focus = more code', () => {
  const sys = buildPrompt(cfg, P, { task: 'chat', provider: 'p', model: 'm', messages: [{ role: 'user', content: 'q' }], level: 0, view: [{ path: 'a/x.py', w: 0.9 }, { path: 'a/y.py', w: 0.1 }] }).system;
  assert.ok(sys.includes('line 29') && !sys.includes('líneas más')); // a/x.py, high focus: all its code
  assert.ok(sys.includes('a/y.py') && sys.split('| line 0').length - 1 === 2); // a/y.py, low focus: header only (x's two sections show line 0, y's would add a third)
});

test('the context respects the cap and reports the trimming', () => {
  const big: Payload = { ...P, files: Array.from({ length: 40 }, (_, i) => ({ ...P.files[0], path: `f${i}.py`, sections: Array.from({ length: 5 }, (_, j) => sec(`s${j}`, 400)) })) };
  const c = buildContext(big, undefined, 2);
  assert.ok(c.length < 85_000 && c.includes('contexto recortado'));
});

test('buildPrompt: chat validates the question; PR data is declared untrusted', () => {
  const b = { provider: 'p', model: 'm' };
  assert.throws(() => buildPrompt(cfg, P, { ...b, task: 'chat', messages: [] }), /falta la pregunta/);
  const r = buildPrompt(cfg, P, { ...b, task: 'chat', messages: [{ role: 'user', content: 'hi' }] });
  assert.ok(r.system.includes('DATOS no confiables') && r.messages.length === 1);
  assert.throws(() => buildPrompt(cfg, P, { ...b, task: 'explain' }), /falta target/);
  const e = buildPrompt(cfg, P, { ...b, task: 'explain', target: { path: 'a/x.py', section: 'small', line: 11, text: 'line 1' } });
  assert.ok(e.messages[0].content.includes('línea 11') && e.messages[0].content.includes('Sección completa'));
});

test('review: each tool has its own request; an unknown one is rejected; security brings more code', () => {
  const cfg = {} as never;
  const sys = (tool: string) => buildPrompt(cfg, P, { task: 'review', tool, provider: 'p', model: 'm' } as never).system;
  assert.match(sys('coherence'), /ticket de Jira/);
  assert.match(sys('comments'), /comentarios del PR/);
  assert.match(sys('security'), /revisión de seguridad/);
  assert.throws(() => buildPrompt(cfg, P, { task: 'review', tool: 'x', provider: 'p', model: 'm' } as never), /revisión inválida/);
});

test('English: the system prompt, the review text, the context labels and the errors come out in English', () => {
  withLang('en', () => {
    const sys = buildPrompt(cfg, P, { task: 'review', tool: 'coherence', provider: 'p', model: 'm' }).system;
    assert.match(sys, /Reply in English/);
    assert.match(sys, /Jira ticket/);
    assert.match(sys, /UNTRUSTED DATA/);
    assert.match(sys, /== Changed files ==/);
    assert.match(sys, /2 files \(\+35 −0\)/);
    assert.equal(sys.includes('Respondé'), false);
    assert.throws(() => buildPrompt(cfg, P, { task: 'chat', provider: 'p', model: 'm', messages: [] }), /question is missing/);
    // the story prompt keeps the same JSON schema in every language
    assert.match(buildPrompt(cfg, P, { task: 'story', provider: 'p', model: 'm' }).system, /\{"headline":.*"pages":\[\{"title":.*"changes":\[\{"path":.*"section":.*"note":/);
  });
  // `language` overrides the reply-language name in any UI language
  assert.match(buildPrompt({ providers: [], language: 'português' }, P, { task: 'chat', provider: 'p', model: 'm', messages: [{ role: 'user', content: 'x' }] }).system, /Respondé en português/);
});

test('the answer cache key includes the language', async () => {
  let calls = 0;
  const srv = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      calls++;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>(ok => srv.listen(0, '127.0.0.1', ok));
  const c = { providers: [{ id: 'o', type: 'openai-compat' as const, baseUrl: `http://127.0.0.1:${(srv.address() as { port: number }).port}` }] };
  const run = async () => { let s = ''; for await (const x of ask(c, { ...P, head: 'cachehead' }, { task: 'summary', provider: 'o', model: 'm' })) s += x; return s; };
  try {
    assert.equal(await run(), 'ok'); assert.equal(calls, 1);
    await run(); assert.equal(calls, 1); // same language: served from the cache
    await withLang('en', run); assert.equal(calls, 2); // other language: a new request
    await withLang('en', run); assert.equal(calls, 2);
  } finally { srv.close(); }
});

test('whole-PR summary sends shorter sections than an explicit level-1 request (token savings)', () => {
  const big: Payload = { ...P, files: [{ ...P.files[0], sections: [sec('f', 20)] }] };
  const sum = buildPrompt(cfg, big, { task: 'summary', provider: 'p', model: 'm', level: 1 }).system;
  assert.match(sum, /line 7\b/);
  assert.doesNotMatch(sum, /line 8\b/);
  assert.match(buildContext(big, ['a/x.py'], 1), /line 14\b/);
});
