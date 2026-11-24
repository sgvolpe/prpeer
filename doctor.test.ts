import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { checks, portFree } from './doctor.ts';

test('doctor: reports Node, git and the build, and flags a busy port', async () => {
  const s = createServer().listen(0, '127.0.0.1');
  await new Promise(r => s.once('listening', r));
  const port = (s.address() as { port: number }).port;
  assert.equal(await portFree(port), false);
  const list = await checks(port);
  s.close();
  assert.equal(list.find(c => c.name === 'Node.js')?.level, 'ok');
  assert.equal(list.find(c => c.name === 'git')?.level, 'ok');
  const busy = list.find(c => c.name === `Port ${port}`)!;
  assert.equal(busy.level, 'warn');
  assert.match(busy.fix!, new RegExp(`--port ${port + 1}`));
  for (const c of list) if (c.level !== 'ok') assert.ok(c.fix, `${c.name} has a fix hint`);
});
