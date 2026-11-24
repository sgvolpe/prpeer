import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff } from './diff.ts';

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -3 +3,2 @@ function foo() {
-  return 1;
+  return 2;
+  // --- not a file header
@@ -10,0 +12 @@ class X {
+  y = 1;
diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+a
+b
diff --git a/old.ts b/gone.ts
similarity index 90%
rename from old.ts
rename to gone.ts
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
diff --git a/dead.ts b/dead.ts
deleted file mode 100644
--- a/dead.ts
+++ /dev/null
@@ -1 +0,0 @@
-x
`;

test('parseDiff', () => {
  const [a, n, r, b, d] = parseDiff(SAMPLE);
  assert.equal(a.hunks.length, 2);
  assert.deepEqual([a.add, a.del], [3, 1]);
  assert.equal(a.hunks[0].header, 'function foo() {');
  assert.deepEqual([a.hunks[0].oldLines, a.hunks[0].newLines], [1, 2]);
  assert.deepEqual([a.hunks[1].oldLines, a.hunks[1].newStart], [0, 12]);
  assert.deepEqual([n.status, n.add, n.hunks[0].newStart], ['added', 2, 1]);
  assert.deepEqual([r.status, r.oldPath, r.path], ['renamed', 'old.ts', 'gone.ts']);
  assert.equal(b.binary, true);
  assert.deepEqual([d.status, d.del], ['deleted', 1]);
});
