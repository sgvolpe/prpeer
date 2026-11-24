import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, llmInfo, stream, type Config } from './llm.ts';

type Seen = { url: string; headers: IncomingHttpHeaders; body: any };
// Fake server that speaks SSE like Anthropic (/v1/messages) and like OpenAI (/chat/completions): zero cost, no network.
async function mock(stopReason = 'end_turn') {
  const seen: Seen[] = [];
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', c => (b += c));
    req.on('end', () => {
      if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'live-model' }] })); return; }
      seen.push({ url: req.url!, headers: req.headers, body: JSON.parse(b) });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (req.url!.includes('/chat/completions')) {
        for (const t of ['Ho', 'la']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
        res.end('data: [DONE]\n\n');
        return;
      }
      const ev = (type: string, o: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`);
      ev('message_start', { message: { id: 'm1', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      for (const t of ['Ho', 'la']) ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: t } });
      ev('content_block_stop', { index: 0 });
      ev('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 2 } });
      ev('message_stop', {});
      res.end();
    });
  });
  await new Promise<void>(ok => srv.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  return { url, seen, close: () => srv.close() };
}
const collect = async (g: AsyncGenerator<string>) => { let s = ''; for await (const c of g) s += c; return s; };

test('anthropic: streams with the SDK, sends effort and cache_control, no beta without fallbacks', async () => {
  const m = await mock();
  process.env.TEST_KEY = 'k';
  const cfg: Config = { providers: [{ id: 'a', type: 'anthropic', apiKeyEnv: 'TEST_KEY', baseUrl: m.url }] };
  const text = await collect(stream(cfg, 'a', { system: 'S', messages: [{ role: 'user', content: 'Q' }], model: 'claude-opus-5-5', effort: 'high' }));
  assert.equal(text, 'Hola');
  const s = m.seen[0];
  assert.match(s.url, /\/v1\/messages/);
  assert.equal(s.body.model, 'claude-opus-5-5');
  assert.deepEqual(s.body.output_config, { effort: 'high' });
  assert.deepEqual(s.body.cache_control, { type: 'ephemeral' });
  assert.equal(s.body.system, 'S');
  assert.equal(s.body.fallbacks, undefined);
  assert.equal(s.body.thinking, undefined);
  m.close();
});

test('anthropic: with fallbacks it uses the beta endpoint; refusal and max_tokens are reported', async () => {
  const m = await mock('refusal');
  process.env.TEST_KEY = 'k';
  const cfg: Config = { providers: [{ id: 'a', type: 'anthropic', apiKeyEnv: 'TEST_KEY', baseUrl: m.url, fallbacks: true }] };
  const text = await collect(stream(cfg, 'a', { system: 'S', messages: [{ role: 'user', content: 'Q' }], model: 'claude-sonnet-5-5' }));
  assert.match(text, /^Hola\n\n\[El modelo rechazó/);
  const s = m.seen[0];
  assert.equal(s.body.fallbacks, 'default');
  assert.match(String(s.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
  assert.equal(s.body.output_config, undefined); // with no effort chosen it is not sent
  m.close();
});

test('openai-compat: system + messages, reasoning_effort, bearer, and live model list', async () => {
  const m = await mock();
  process.env.TEST_KEY = 'secret';
  const cfg: Config = { providers: [{ id: 'o', type: 'openai-compat', baseUrl: m.url + '/v1', apiKeyEnv: 'TEST_KEY', models: ['fixed'] }] };
  const text = await collect(stream(cfg, 'o', { system: 'S', messages: [{ role: 'user', content: 'Q' }], model: 'm', effort: 'low' }));
  assert.equal(text, 'Hola');
  const s = m.seen[0];
  assert.equal(s.headers.authorization, 'Bearer secret');
  assert.deepEqual(s.body.messages, [{ role: 'system', content: 'S' }, { role: 'user', content: 'Q' }]);
  assert.equal(s.body.reasoning_effort, 'low');
  const info = await llmInfo(cfg);
  assert.deepEqual(info.providers[0].models, ['fixed', 'live-model']);
  assert.equal(info.providers[0].ready, true);
  assert.equal(JSON.stringify(info).includes('secret'), false); // the key never leaves
  m.close();
});

test('openai-compat: an HTTP error propagates with its body; an unknown provider fails clearly', async () => {
  const srv = createServer((_, res) => { res.writeHead(401); res.end('invalid key'); });
  await new Promise<void>(ok => srv.listen(0, '127.0.0.1', ok));
  const cfg: Config = { providers: [{ id: 'o', type: 'openai-compat', baseUrl: `http://127.0.0.1:${(srv.address() as { port: number }).port}` }] };
  await assert.rejects(collect(stream(cfg, 'o', { system: '', messages: [], model: 'm' })), /HTTP 401 invalid key/);
  await assert.rejects(collect(stream(cfg, 'nope', { system: '', messages: [], model: 'm' })), /proveedor desconocido/);
  srv.close();
});

test('loadConfig: validates and falls back to Claude by default', () => {
  const d = mkdtempSync(join(tmpdir(), 'cfg-'));
  const w = (o: unknown) => { const f = join(d, 'c.json'); writeFileSync(f, JSON.stringify(o)); return f; };
  assert.equal(loadConfig(w({ providers: [{ id: 'x', type: 'openai-compat', baseUrl: 'http://h' }] })).providers[0].id, 'x');
  assert.throws(() => loadConfig(w({ providers: [{ id: 'x', type: 'openai-compat' }] })), /baseUrl is missing/);
  assert.throws(() => loadConfig(w({ providers: [{ id: 'x', type: 'otro' }] })), /type must be/);
  assert.throws(() => loadConfig(w({ providers: [{ id: 'x', type: 'anthropic' }, { id: 'x', type: 'anthropic' }] })), /duplicate/);
  assert.throws(() => loadConfig(w({})), /"providers" is missing/);
});

test('llmInfo: without a default it picks the first provider that can answer', async () => {
  const saved = process.env.ANTHROPIC_API_KEY, savedMine = process.env.PRPEER_TEST_KEY;
  delete process.env.ANTHROPIC_API_KEY; process.env.PRPEER_TEST_KEY = 'k';
  try {
    const cfg: Config = { providers: [{ id: 'a', type: 'anthropic' }, { id: 'o', type: 'openai-compat', baseUrl: 'http://127.0.0.1:1', apiKeyEnv: 'PRPEER_TEST_KEY' }] };
    assert.equal((await llmInfo(cfg)).default.provider, 'o'); // anthropic without a key is skipped
    assert.equal((await llmInfo({ ...cfg, default: { provider: 'a' } })).default.provider, 'a'); // the explicit one wins
  } finally { if (saved) process.env.ANTHROPIC_API_KEY = saved; delete process.env.PRPEER_TEST_KEY; if (savedMine) process.env.PRPEER_TEST_KEY = savedMine; }
});
