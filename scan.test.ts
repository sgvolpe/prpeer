import assert from 'node:assert/strict';
import test from 'node:test';
import { scanPayload } from './scan.ts';
import type { Payload } from './ask.ts';
import { withLang } from './i18n.ts';

const pl = (path: string, lines: string[], status = 'M'): Payload => ({
  title: 't', base: { ref: 'main' }, head: 'h', links: [], linked: [], readmes: {}, changelog: null,
  files: [{ path, status, add: lines.length, del: 0, binary: false, doc: null, sections: [{ name: 's', kind: 'fn', doc: null, add: lines.length, del: 0, first: 1, last: lines.length, lines: lines.map((t, i) => ({ k: t.startsWith('-') ? '-' as const : '+' as const, t: t.replace(/^[+-]/, ''), n: i + 1 })) }] }],
});

test('detects secrets in added lines and never returns the full value', () => {
  const key = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const r = scanPayload(pl('a.py', [`k = "${key}"`, 'password = "hunter2hunter2"', 'password = os.environ["P"]', 'token = "<your-token-here>"', 'db = "postgres://u:secreta@host/db"']));
  assert.deepEqual(r.map(x => x.rule).sort(), ['URL con usuario y contraseña', 'clave de acceso de AWS', 'contraseña o token escrito en el código'].sort());
  assert.ok(r.every(x => !x.sample.includes(key) && !x.sample.includes('hunter2hunter2')));
});

test('the rule text follows the request language; the level is a language-neutral code', () => {
  const p = pl('b.py', ['subprocess.run(c, shell=True)']);
  assert.deepEqual(withLang('en', () => scanPayload(p).map(x => [x.rule, x.level])), [['runs a shell (shell=True)', 'signal']]);
  assert.deepEqual(scanPayload(p).map(x => [x.rule, x.level]), [['ejecuta un shell (shell=True)', 'signal']]);
  const long = withLang('en', () => scanPayload(pl('a.py', ['password = "hunter2hunter2"']))[0].sample);
  assert.equal(long, 'hunt…(14 chars)');
});

test('ignores deleted lines, flags sensitive files and dangerous signals', () => {
  assert.equal(scanPayload(pl('a.py', ['-password = "hunter2hunter2"'])).length, 0);
  assert.equal(scanPayload(pl('.env', ['A=1']))[0].rule, 'archivo que suele contener secretos');
  assert.equal(scanPayload(pl('.env.example', ['A=1'])).length, 0);
  assert.equal(scanPayload(pl('b.py', ['subprocess.run(c, shell=True)']))[0].level, 'signal');
});
