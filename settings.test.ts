import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clean, readSettings, writeSettings } from './settings.ts';

test('clean keeps valid folders and limits, drops the rest', () => {
  assert.deepEqual(clean({ repoDirs: ['~/code', 'C:\\src', '/srv/git', 'relative', '', 3, '~/code', 'a\nb'], maxSessions: 6, graphLimit: 10 }),
    { repoDirs: ['~/code', 'C:\\src', '/srv/git'], maxSessions: 6 });
  assert.deepEqual(clean(null), {});
});

test('write merges, null resets, invalid values are refused', () => {
  process.env.PRPEER_HOME = mkdtempSync(join(tmpdir(), 'prpeer-set-'));
  writeSettings({ repoDirs: ['~/code'], graphLimit: 800 });
  writeSettings({ maxSessions: 2 });
  assert.deepEqual(readSettings(), { repoDirs: ['~/code'], maxSessions: 2, graphLimit: 800 });
  writeSettings({ repoDirs: null });
  assert.deepEqual(readSettings(), { maxSessions: 2, graphLimit: 800 });
  assert.throws(() => writeSettings({ maxSessions: 99 }), /maxSessions/);
  assert.equal(readSettings().maxSessions, 2);
});
