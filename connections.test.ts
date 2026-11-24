import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.ts';
import { githubCred } from './sources.ts';
import { llmInfo, stream, type Config } from './llm.ts';

// all state goes to a test HOME: never the real ~/.prpeer
const home = mkdtempSync(join(tmpdir(), 'prpeer-home-'));
process.env.PRPEER_HOME = home;
const cfg: Config = { providers: [{ id: 'x', type: 'openai-compat', baseUrl: 'http://127.0.0.1:1', apiKeyEnv: 'PRPEER_TEST_KEY2' }] };
const file = () => join(home, 'connections.json');

test('disconnect GitHub: even with a token in the environment prpeer does not use it; reconnecting brings it back', async () => {
  process.env.GITHUB_TOKEN = 'ghp_env_123456';
  const app = createApp(cfg);
  assert.deepEqual([githubCred().token, githubCred().from], ['ghp_env_123456', 'env']);
  await app.api.disconnect({ target: 'github' });
  assert.equal(githubCred().token, undefined);
  const gh = ((await app.api.sources()) as { id: string; ready: boolean; off: boolean; from?: string }[]).find(s => s.id === 'github')!;
  assert.deepEqual([gh.ready, gh.off, gh.from], [false, true, 'env']); // you can see what it would have used
  await app.api.connect({ target: 'github' });
  assert.equal(githubCred().token, 'ghp_env_123456');
  delete process.env.GITHUB_TOKEN;
});

test('connect with a pasted key: stored with 0600 permissions, wins over the environment and never goes back to the browser', async () => {
  process.env.PRPEER_TEST_KEY2 = 'from-env-123';
  const app = createApp(cfg);
  await app.api.connect({ target: 'p:x', secret: 'sk-pasted-123456' });
  assert.match(readFileSync(file(), 'utf8'), /sk-pasted-123456/);
  if (process.platform !== 'win32') assert.equal(statSync(file()).mode & 0o777, 0o600);
  const info = JSON.stringify(await llmInfo(cfg));
  assert.ok(!info.includes('sk-pasted') && !info.includes('from-env')); // the API never returns secrets
  assert.equal(((await llmInfo(cfg)).providers[0] as { from?: string }).from, 'saved');
  await app.api.disconnect({ target: 'p:x' }); // disconnecting also deletes the saved key
  assert.ok(!readFileSync(file(), 'utf8').includes('sk-pasted'));
  const p = (await llmInfo(cfg)).providers[0] as { ready: boolean; off: boolean };
  assert.deepEqual([p.ready, p.off], [false, true]);
  await assert.rejects(async () => { for await (const _ of stream(cfg, 'x', { system: '', messages: [], model: 'm' })); }, /desconectado/);
  await app.api.connect({ target: 'p:x' });
  assert.equal(((await llmInfo(cfg)).providers[0] as { ready: boolean }).ready, true);
  delete process.env.PRPEER_TEST_KEY2;
});

test('connect validates the target and the secret format', async () => {
  const app = createApp(cfg);
  await assert.rejects(app.api.connect({ target: 'p:nope', secret: 'abcdefgh123' }), /desconocida/);
  await assert.rejects(app.api.disconnect({ target: '../x' }), /desconocida/);
  await assert.rejects(app.api.connect({ target: 'p:x', secret: 'with spaces and\nbreaks' }), /una sola línea/);
  await assert.rejects(app.api.connect({ target: 'p:x', secret: 'short' }), /una sola línea/);
});
