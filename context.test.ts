import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changelog, firstParagraph } from './context.ts';

test('firstParagraph skips the title and badges', () => {
  assert.equal(firstParagraph('# T\n\n[![ci](x)](y)\n\nDoes   things\nacross two lines.\n\nAnother.'), 'Does things across two lines.');
  assert.equal(firstParagraph('# Title only'), 'Title only');
});

test('changelog takes Unreleased and groups', () => {
  const md = '# Changelog\n## [Unreleased]\n### Added\n- uno\n- dos\n### Fixed\n* tres\n## [1.0.0]\n### Added\n- viejo\n';
  assert.deepEqual(changelog(md), [['Added', ['uno', 'dos']], ['Fixed', ['tres']]]);
  assert.equal(changelog('# Changelog\n## [1.0.0]\n- x'), null);
  assert.deepEqual(changelog('## Unreleased\n- suelto\n'), [['Cambios', ['suelto']]]);
});
