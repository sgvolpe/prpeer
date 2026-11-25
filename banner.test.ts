import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance } from './banner.ts';

test('advance: newlines, soft wraps of long lines, colors and carriage returns', () => {
  assert.deepEqual(advance('ab\ncd\n', 0, 80), [2, 0]);
  assert.deepEqual(advance('x'.repeat(10) + '\n', 0, 4), [3, 0]); // 10 chars on a 4-wide terminal: 3 rows
  assert.deepEqual(advance('x'.repeat(8) + '\n', 0, 4), [2, 0]); // exactly 2 full rows: the newline does not add a blank one
  assert.deepEqual(advance('\x1b[38;5;214mxx\x1b[0m', 2, 4), [0, 4]); // escapes take no room
  assert.deepEqual(advance('xxxxxx\rab', 0, 80), [0, 2]);
  assert.deepEqual(advance('y', 4, 4), [1, 1]); // continues a full row from an earlier write
});
