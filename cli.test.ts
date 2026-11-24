import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stream, llmInfo, type Config } from './llm.ts';

// A fake `claude`: records arguments/stdin/environment and emits the same stream-json as the real CLI.
function fake(mode: 'ok' | 'nodeltas' | 'auth') {
  const d = mkdtempSync(join(tmpdir(), 'fakeclaude-'));
  const bin = join(d, 'claude');
  const out = {
    ok: [
      '{"type":"system","subtype":"init","tools":[]}',
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Ho"}}}',
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"la"}}}',
      '{"type":"result","is_error":false,"result":"Hola"}',
    ],
    nodeltas: ['{"type":"result","is_error":false,"result":"Solo final"}'],
    auth: ['{"type":"result","is_error":true,"result":"Failed to authenticate: OAuth session expired"}'],
  }[mode];
  writeFileSync(bin, `#!/bin/sh
if [ "$1" = "--version" ]; then echo 2.0.0; exit 0; fi
printf '%s\\n' "$@" > "${d}/args.txt"
cat > "${d}/stdin.txt"
echo "key=\${ANTHROPIC_API_KEY:-vacia} cwd=$(pwd)" > "${d}/env.txt"
${out.map(l => `echo '${l}'`).join('\n')}
`);
  chmodSync(bin, 0o755);
  return { d, bin };
}
const collect = async (g: AsyncGenerator<string>) => { let s = ''; for await (const c of g) s += c; return s; };
const skip = process.platform === 'win32' ? 'claude-cli does not run on native Windows' : false;

test('claude-cli: deltas, isolation (no tools/MCP/settings), prompt through stdin and no key in the environment', { skip }, async () => {
  const { d, bin } = fake('ok');
  process.env.ANTHROPIC_API_KEY = 'no-debe-llegar';
  const cfg: Config = { providers: [{ id: 'c', type: 'claude-cli', command: bin }] };
  const text = await collect(stream(cfg, 'c', { system: 'SYSTEM', messages: [{ role: 'user', content: 'question' }], model: 'claude-haiku-5-5', effort: 'low' }));
  assert.equal(text, 'Hola');
  const args = readFileSync(join(d, 'args.txt'), 'utf8').split('\n');
  for (const a of ['-p', '--include-partial-messages', '--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands']) assert.ok(args.includes(a), a);
  assert.equal(args[args.indexOf('--model') + 1], 'claude-haiku-5-5');
  assert.equal(args[args.indexOf('--effort') + 1], 'low');
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.equal(args[args.indexOf('--setting-sources') + 1], '');
  const stdin = readFileSync(join(d, 'stdin.txt'), 'utf8');
  assert.ok(stdin.includes('SYSTEM') && stdin.includes('Usuario: question'));
  assert.ok(!args.join(' ').includes('SYSTEM')); // the context does not travel through argv
  const env = readFileSync(join(d, 'env.txt'), 'utf8');
  assert.match(env, /key=vacia/);
  assert.ok(env.includes(tmpdir().replace(/\/$/, '')));
  delete process.env.ANTHROPIC_API_KEY;
});

test('claude-cli: with no deltas it uses the final result; a login error gives the hint; llmInfo detects the binary', { skip }, async () => {
  const req = { system: '', messages: [{ role: 'user' as const, content: 'q' }], model: 'm' };
  const a = fake('nodeltas'), b = fake('auth');
  assert.equal(await collect(stream({ providers: [{ id: 'c', type: 'claude-cli', command: a.bin }] }, 'c', req)), 'Only final');
  await assert.rejects(collect(stream({ providers: [{ id: 'c', type: 'claude-cli', command: b.bin }] }, 'c', req)), /OAuth session expired.*claude auth login/);
  const info = await llmInfo({ providers: [{ id: 'c', type: 'claude-cli', command: a.bin }, { id: 'x', type: 'claude-cli', command: '/no/existe' }] });
  assert.deepEqual(info.providers.map(p => p.ready), [true, false]);
});
