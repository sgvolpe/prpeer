import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { analyze } from './analyze.ts';

const g = (dir: string, ...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('analyze on a mixed repo: per-language sections and links between Terraform, templates, static files, shell, Docker and docs', () => {
  const d = mkdtempSync(join(tmpdir(), 'mixed-repo-'));
  const w = (p: string, t: string) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), t); };
  g(d, 'init', '-q', '-b', 'main');
  const base = {
    'infra/main.tf': 'module "net" {\n  source = "./modules/net"\n}\n',
    'infra/modules/net/main.tf': 'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n\nresource "aws_subnet" "a" {\n  cidr_block = "10.0.1.0/24"\n}\n',
    'app/views.py': 'from django.shortcuts import render\n\ndef index(request):\n    return render(request, "list.html")\n',
    'app/templates/base.html': '<html>{% block content %}{% endblock %}</html>\n',
    'app/templates/list.html': '{% extends "base.html" %}\n{% block content %}\n<p>hola</p>\n<script src="{% static \'js/list.js\' %}"></script>\n{% endblock %}\n',
    'app/static/js/list.js': 'function go() { return 1; }\n',
    'scripts/lib.sh': 'helper() {\n  echo hi\n}\n',
    'scripts/deploy.sh': '#!/bin/bash\nsource ./lib.sh\n\nbuild() {\n  echo build\n}\n\nclean() {\n  echo clean\n}\n',
    'Dockerfile': 'FROM python:3.12\nCOPY app/views.py /srv/\n',
    'docs/README.md': '# Docs\n\n## Deploy\nSee [the script](../scripts/deploy.sh).\n\n## Other\ntext\n',
    'db/0001.sql': 'CREATE TABLE t (id int);\n',
    '.github/workflows/ci.yml': 'name: ci\njobs:\n  build:\n    runs-on: ubuntu\n  test:\n    runs-on: ubuntu\n',
  };
  for (const [p, t] of Object.entries(base)) w(p, t);
  g(d, 'add', '.'); g(d, 'commit', '-qm', 'base');
  g(d, 'checkout', '-q', '-b', 'feat');
  w('infra/modules/net/main.tf', base['infra/modules/net/main.tf'].replace('10.0.1.0/24', '10.0.9.0/24'));
  w('app/templates/list.html', base['app/templates/list.html'].replace('hola', 'chau'));
  w('scripts/deploy.sh', base['scripts/deploy.sh'].replace('echo build', 'echo build2'));
  w('db/0001.sql', base['db/0001.sql'] + 'ALTER TABLE t ADD COLUMN n text;\n');
  w('.github/workflows/ci.yml', base['.github/workflows/ci.yml'].replace('runs-on: ubuntu\n  test', 'runs-on: macos\n  test'));
  w('docs/README.md', base['docs/README.md'].replace('text', 'new text'));
  w('Dockerfile', base['Dockerfile'].replace('/srv/', '/app/'));
  g(d, 'commit', '-qam', 'feat');
  const a = analyze({ repo: d, title: 't', baseRef: 'main', head: 'feat' });
  try {
    const sec = (p: string) => a.payload.files.find(f => f.path === p)!.sections.map(s => s.name);
    assert.deepEqual(sec('infra/modules/net/main.tf'), ['aws_subnet.a']);
    assert.deepEqual(sec('app/templates/list.html'), ['block content']);
    assert.deepEqual(sec('scripts/deploy.sh'), ['build']);
    assert.deepEqual(sec('db/0001.sql'), ['alter table t']);
    assert.deepEqual(sec('.github/workflows/ci.yml'), ['jobs.build']);
    assert.deepEqual(sec('docs/README.md'), ['Docs > Other']);
    assert.deepEqual(sec('Dockerfile'), ['stage 1 (python:3.12)']);
    const edges = a.payload.links.map(l => `${l.from} -> ${l.to}`).sort();
    assert.deepEqual(edges, [
      'Dockerfile -> app/views.py',
      'app/templates/list.html -> app/static/js/list.js',
      'app/templates/list.html -> app/templates/base.html',
      'app/views.py -> app/templates/list.html',
      'docs/README.md -> scripts/deploy.sh',
      'infra/main.tf -> infra/modules/net/main.tf',
      'scripts/deploy.sh -> scripts/lib.sh',
    ]);
  } finally { a.cleanup(); }
});

test('security: a README.md that is a symlink to a file on the machine is not read and does not reach the payload', t => {
  const d = mkdtempSync(join(tmpdir(), 'symlink-repo-'));
  const secret = join(mkdtempSync(join(tmpdir(), 'secret-')), 'id_rsa');
  writeFileSync(secret, 'SECRETO-NO-DEBE-SALIR\n');
  g(d, 'init', '-q', '-b', 'main');
  writeFileSync(join(d, 'a.py'), 'def f():\n    return 1\n'); g(d, 'add', '.'); g(d, 'commit', '-qm', 'base');
  g(d, 'checkout', '-q', '-b', 'feat');
  try { symlinkSync(secret, join(d, 'README.md')); } catch { t.skip('no permission to create symlinks'); return; }
  writeFileSync(join(d, 'a.py'), 'def f():\n    return 2\n'); g(d, 'add', '.'); g(d, 'commit', '-qm', 'feat');
  const a = analyze({ repo: d, baseRef: 'main', head: 'feat', title: 't' });
  try { assert.ok(!JSON.stringify(a.payload).includes('SECRETO-NO-DEBE-SALIR')); } finally { a.cleanup(); }
});
