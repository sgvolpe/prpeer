import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRANCH, buildDemo } from './demo.ts';

const python = ['python3', 'python'].some(c => { try { execFileSync(c, ['-c', '1'], { stdio: 'ignore' }); return true; } catch { return false; } });

test('sample repo: the PR touches 8 files and leaves out the ones that break silently', { skip: !python && 'no Python 3' }, () => {
  const dir = buildDemo(mkdtempSync(join(tmpdir(), 'prpeer-demo-test-')));
  try {
    const out = execFileSync(process.execPath, [join(import.meta.dirname, '..', 'prpeer.ts'), BRANCH, '--base', 'main', '--repo', dir, '--links'], { encoding: 'utf8' });
    assert.equal((out.match(/^(modified|added) /gm) ?? []).length, 8);
    // revenue.py and dashboard.py are not in the diff but depend on what changes: they show up as linked
    assert.match(out, /shop\/reports\/revenue\.py → shop\/payments\/gateway\.py/);
    assert.match(out, /shop\/admin\/dashboard\.py → shop\/orders\/models\.py/);
    assert.doesNotMatch(out, /^(modified|added) .*(revenue|dashboard)\.py/m);
    // refunds.py (the risky one) is imported by service and the routes, and no test imports it
    assert.match(out, /shop\/orders\/service\.py → shop\/payments\/refunds\.py/);
    assert.match(out, /shop\/api\/routes\/orders\.py → shop\/payments\/refunds\.py/);
    assert.doesNotMatch(out, /test\s+\S+ → shop\/payments\/refunds\.py/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('buildDemo does not delete a folder that is not its own', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prpeer-demo-safe-'));
  try {
    writeFileSync(join(dir, 'important.txt'), 'do not delete me');
    assert.throws(() => buildDemo(dir), /is not empty/);
    assert.equal(readFileSync(join(dir, 'important.txt'), 'utf8'), 'do not delete me');
    rmSync(join(dir, 'important.txt'));
    buildDemo(dir); buildDemo(dir); // empty, and then a previous sample repo: both can be replaced
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
