import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, indexRepo, langOf, resolveRef, templateRefs } from './langs.ts';

const L = (id: string) => LANGS.find(l => l.id === id)!;
const syms = (id: string, text: string) => L(id).analyze(text).symbols.map(s => [s.name, s.kind, s.start, s.end]);
const refs = (id: string, text: string, path = 'x') => L(id).refs!(text, path).map(r => `${r.mode}:${r.spec}`);

test('langOf picks the analyzer by file name', () => {
  const pick = (p: string) => langOf(p)?.id;
  assert.deepEqual(['a.md', 'a.sh', 'main.tf', 'm/0069.sql', 'ci.yml', 'Dockerfile', 'svc/Dockerfile.prod', 't.html', 'a.scss', 'a.py', 'a.min.css'].map(pick),
    ['markdown', 'shell', 'hcl', 'sql', 'yaml', 'dockerfile', 'dockerfile', 'html', 'css', undefined, undefined]);
});

test('markdown: heading with its path, ignores # inside code blocks; relative links', () => {
  const md = '# Title\nintro\n## Setup\ntext\n```bash\n# not a heading\n```\n### Deep\n## Usage\nend\n';
  assert.deepEqual(syms('markdown', md), [['Title', 'heading', 1, 10], ['Title > Setup', 'heading', 3, 8], ['Title > Setup > Deep', 'heading', 8, 8], ['Title > Usage', 'heading', 9, 10]]);
  assert.deepEqual(refs('markdown', '[a](./x.md) [b](https://x.com) [c](docs/y.py#L3) [d](#anchor) [e](mailto:a@b) ![i](img/p.png)'), ['rel:./x.md', 'rel:docs/y.py', 'rel:img/p.png']);
});

const SH = `#!/usr/bin/env bash
# Deploys the app.
# Usage: deploy.sh

source ./lib.sh

# Construye.
build() {
  echo "\${NAME} {x}"
  if [ -n "$X" ]; then
    ./scripts/run.sh
  fi
}

function clean {
  rm -rf "$DIR"
}
echo \${VAR} {a,b}
`;
test('shell: functions with their comment, ${var} and {a,b} are not blocks; source and scripts as references', () => {
  assert.deepEqual(syms('shell', SH), [['build', 'fn', 8, 13], ['clean', 'fn', 15, 17]]);
  assert.equal(L('shell').analyze(SH).symbols[0].doc, 'Construye.');
  assert.equal(L('shell').analyze(SH).doc, 'Deploys the app.\nUsage: deploy.sh');
  assert.deepEqual(refs('shell', SH), ['rel:./lib.sh', 'rel:./scripts/run.sh']);
});

const TF = `terraform {
  required_version = ">= 1.5"
}

# Log bucket
resource "aws_s3_bucket" "logs" {
  bucket = "x-\${var.env}-logs"
  tags = { Name = "\${upper("a")}" }
  lifecycle {
    prevent_destroy = true
  }
}

variable "env" {
  type = string
}
module "net" {
  source = "./modules/net"
}
locals {
  a = <<EOT
text { unbalanced
EOT
}
`;
test('terraform: one top-level block per section; strings with interpolation and heredocs do not break the braces', () => {
  assert.deepEqual(syms('hcl', TF), [['terraform', 'terraform', 1, 3], ['aws_s3_bucket.logs', 'resource', 6, 12], ['var.env', 'variable', 14, 16], ['module.net', 'module', 17, 19], ['locals', 'locals', 20, 24]]);
  assert.equal(L('hcl').analyze(TF).symbols[1].doc, 'Log bucket');
  assert.deepEqual(refs('hcl', TF + 'x = file("${path.module}/q.sql")\n# source = "./comentado"\n'), ['dir:./modules/net', 'rel:q.sql']);
});

const SQL = `-- Creates the table
CREATE TABLE public.fees (
  id int primary key,
  note text default 'a;b'
);

CREATE OR REPLACE FUNCTION public.f()
RETURNS int AS $$
BEGIN RETURN 1; END;
$$ LANGUAGE plpgsql;
ALTER TABLE ONLY public.fees ADD x int;
INSERT INTO public.fees VALUES (1);
`;
test('sql: one section per statement; ; inside strings and $$ does not split', () => {
  assert.deepEqual(syms('sql', SQL), [['create table public.fees', 'table', 2, 5], ['create function public.f', 'function', 7, 10], ['alter table public.fees', 'table', 11, 11], ['insert into public.fees', 'statement', 12, 12]]);
  assert.equal(L('sql').analyze(SQL).symbols[0].doc, 'Creates the table');
});

const YML = `# CI
name: ci
on: [push]
jobs:
  build:
    runs-on: ubuntu
    steps:
      - run: make
  test:
    runs-on: ubuntu
services:
  api:
    image: x
`;
test('yaml: first- and second-level keys with their range', () => {
  assert.deepEqual(syms('yaml', YML), [['name', 'key', 2, 2], ['on', 'key', 3, 3], ['jobs', 'key', 4, 10], ['jobs.build', 'key', 5, 8], ['jobs.test', 'key', 9, 10], ['services', 'key', 11, 13], ['services.api', 'key', 12, 13]]);
  assert.equal(L('yaml').analyze(YML).symbols[0].doc, 'CI');
});

test('dockerfile: stages and the files it copies (no --from, no destination nor URLs)', () => {
  const df = '# Build stage\nFROM python:3.12 AS build\nCOPY requirements.txt .\nCOPY src/ /app/src/\nRUN pip install .\n\nFROM python:3.12-slim\nCOPY --from=build /app /app\nADD https://x.io/a.tgz /a\n';
  assert.deepEqual(syms('dockerfile', df), [['stage build', 'stage', 2, 5], ['stage 2 (python:3.12-slim)', 'stage', 7, 9]]);
  assert.equal(L('dockerfile').analyze(df).symbols[0].doc, 'Build stage');
  assert.deepEqual(refs('dockerfile', df), ['rel:requirements.txt', 'rel:src/']);
});

const HTML = `{% extends "base.html" %}
{% load static %}
{# comentario #}
{% block content %}
<form id="filters" class="f">
  <input name="q">
</form>
<script src="{% static 'js/x.js' %}"></script>
<script>
  var a = "<div>";
</script>
{% endblock %}
<link rel="stylesheet" href="css/site.css"><script src="https://cdn.x/y.js"></script>
`;
test('html/templates: blocks, landmarks and inline scripts; extends, static, link and script src as references', () => {
  assert.deepEqual(syms('html', HTML), [['block content', 'block', 4, 12], ['form#filters', 'element', 5, 7], ['script', 'script', 9, 11]]);
  assert.deepEqual(refs('html', HTML), ['suffix:base.html', 'suffix:js/x.js', 'rel:css/site.css']);
});

test('css: top-level rules and @-rules; @import', () => {
  const c = '/* Botones */\n.btn, .btn-primary {\n  color: red;\n}\n@media (max-width: 600px) {\n  .btn { color: blue }\n}\n@import \'base.css\';\n';
  assert.deepEqual(syms('css', c), [['.btn, .btn-primary', 'rule', 2, 4], ['@media (max-width: 600px)', 'at-rule', 5, 7]]);
  assert.deepEqual(refs('css', c), ['rel:base.css']);
});

test('resolveRef: templates by the closest (without guessing ties), static files, Terraform modules, relatives and scss partials', () => {
  const ix = indexRepo(['templates/base.html', 'app/templates/base.html', 'app/templates/list.html', 'app/static/js/x.js', 'scripts/run.sh', 'scripts/lib.sh',
    'infra/main.tf', 'infra/modules/net/main.tf', 'infra/modules/net/vars.tf', 'infra/modules/net/outputs.tf', 'infra/modules/net/z.tf', 'css/_p.scss']);
  const r = (from: string, spec: string, mode: 'rel' | 'suffix' | 'dir') => resolveRef(from, { spec, mode }, ix);
  assert.deepEqual(r('app/templates/list.html', 'base.html', 'suffix'), ['app/templates/base.html']);
  assert.deepEqual(r('otro/x.html', 'base.html', 'suffix'), []); // tie: no guess
  assert.deepEqual(r('app/templates/list.html', 'js/x.js', 'suffix'), ['app/static/js/x.js']);
  assert.deepEqual(r('infra/main.tf', './modules/net', 'dir'), ['infra/modules/net/main.tf']); // a module = its main.tf
  assert.deepEqual(resolveRef('infra/main.tf', { spec: './modules/net', mode: 'dir' }, ix, new Set(['infra/modules/net/vars.tf', 'infra/modules/net/z.tf'])), ['infra/modules/net/vars.tf', 'infra/modules/net/z.tf']); // …unless other files of the module changed
  assert.deepEqual(r('scripts/deploy.sh', './lib.sh', 'rel'), ['scripts/lib.sh']);
  assert.deepEqual(r('scripts/deploy.sh', './scripts/run.sh', 'rel'), ['scripts/run.sh']); // relative to the repo root
  assert.deepEqual(r('css/site.scss', 'p', 'rel'), ['css/_p.scss']);
  assert.deepEqual(r('scripts/deploy.sh', './nada.sh', 'rel'), []);
});

test('templateRefs: Python views point at their templates', () => {
  assert.deepEqual(templateRefs('return render(request, "app/list.html", ctx)\nt = env.get_template(\'mail.jinja2\')\nx = "a.txt"').map(r => r.spec), ['app/list.html', 'mail.jinja2']);
});

test('json / toml / makefile: keys, tables and targets with their comment', () => {
  assert.deepEqual(syms('json', '{\n  "name": "x",\n  "scripts": {\n    "build": "tsc",\n    "test": "node"\n  },\n  "dep": 1\n}\n'),
    [['name', 'key', 2, 2], ['scripts', 'key', 3, 6], ['scripts.build', 'key', 4, 4], ['scripts.test', 'key', 5, 6], ['dep', 'key', 7, 7]]);
  assert.deepEqual(syms('json', '[\n  {"a": 1}\n]\n'), []);
  assert.deepEqual(syms('toml', '# deps\n[package]\nname = "x"\ns = """\n[not.a.table]\n"""\n\n[[bin]]\nname = "y"\n'), [['package', 'table', 2, 6], ['bin', 'table', 8, 9]]);
  assert.equal(L('toml').analyze('# deps\n[package]\n').symbols[0].doc, 'deps');
  assert.deepEqual(syms('make', '# build\nall: dep\n\tcc x\n\n.PHONY: all\nclean:\n\trm x\nX := 1\n'), [['all', 'target', 2, 5], ['clean', 'target', 6, 8]]);
  assert.deepEqual(refs('make', 'include a.mk $(B)\n-include c.mk\n'), ['rel:a.mk', 'rel:c.mk']);
});

test('graphql / proto: types, operations, messages and rpc; proto imports', () => {
  assert.deepEqual(syms('graphql', '# user\ntype User {\n  id: ID!\n}\nquery GetUser {\n  user { id }\n}\n'), [['type User', 'type', 1, 4], ['query GetUser', 'query', 5, 7]]);
  const pb = 'syntax = "proto3";\nimport "a/b.proto";\nmessage A {\n  message B {}\n  int32 x = 1;\n}\nservice S {\n  rpc F(A) returns (A) {}\n}\n';
  assert.deepEqual(syms('proto', pb), [['A', 'message', 3, 6], ['A.B', 'message', 4, 4], ['S', 'service', 7, 9], ['S.F', 'rpc', 8, 8]]);
  assert.deepEqual(refs('proto', pb), ['suffix:a/b.proto']);
});

test('go / rust: functions with receiver, types, impl blocks; rust mod files', () => {
  assert.deepEqual(syms('go', '// Run it.\nfunc (s *Svc) Run(a int,\n\tb int) error {\n\treturn nil\n}\n\ntype T struct {\n\tX int\n}\nfunc main() {\n\tx := "}"\n}\n'),
    [['Svc.Run', 'fn', 1, 5], ['T', 'type', 7, 9], ['main', 'fn', 10, 12]]);
  assert.equal(L('go').analyze('// Run it.\nfunc F() {\n}\n').symbols[0].doc, 'Run it.');
  assert.deepEqual(syms('rust', '/// S\nstruct S {\n}\nimpl S {\n    pub fn new() -> Self {\n        S {}\n    }\n}\nfn main() {\n}\n'),
    [['S', 'struct', 1, 3], ['impl S', 'impl', 4, 8], ['impl S.new', 'method', 5, 7], ['main', 'fn', 9, 10]]);
  assert.deepEqual(refs('rust', 'mod a;\npub mod b;\nmod c { }\n// mod d;\n', 'src/lib.rs'), ['rel:a.rs', 'rel:a/mod.rs', 'rel:b.rs', 'rel:b/mod.rs']);
  assert.deepEqual(refs('rust', 'mod x;\n', 'src/a.rs'), ['rel:a/x.rs', 'rel:a/x/mod.rs']);
});

test('java / kotlin / c# / php: types and methods (not if/for), annotations and doc included in the section', () => {
  assert.deepEqual(syms('java', 'package a;\n/** Foo. */\n@Service\npublic class Foo {\n  @Test\n  public void bar(int a) throws X {\n    if (a) {\n    }\n  }\n  Foo() {\n  }\n}\n'),
    [['Foo', 'class', 2, 12], ['Foo.bar', 'method', 5, 9], ['Foo.Foo', 'method', 10, 11]]);
  assert.equal(L('java').analyze('/** Foo. */\nclass Foo {\n}\n').symbols[0].doc, 'Foo.');
  assert.deepEqual(refs('java', 'import a.b.C;\nimport static a.D.f;\n').slice(0, 2), ['suffix:a/b/C.java', 'suffix:a/b/C.kt']);
  assert.deepEqual(syms('kotlin', 'class A {\n  fun b(): Int {\n    return "${1}".length\n  }\n}\nfun top() {\n}\n'), [['A', 'class', 1, 5], ['A.b', 'method', 2, 4], ['top', 'fn', 6, 7]]);
  assert.deepEqual(syms('csharp', 'namespace N\n{\n  public class C\n  {\n    public void M()\n    {\n    }\n  }\n}\n'), [['C', 'class', 3, 8], ['C.M', 'method', 5, 7]]);
  assert.deepEqual(syms('csharp', 'namespace N;\nclass C {\n  void M() {\n  }\n}\n'), [['C', 'class', 2, 5], ['C.M', 'method', 3, 4]]);
  assert.deepEqual(syms('php', '<?php\nclass A {\n  public function b() {\n  }\n}\nfunction f() {\n}\n'), [['A', 'class', 2, 5], ['A.b', 'method', 3, 4], ['f', 'fn', 6, 7]]);
  assert.deepEqual(refs('php', String.raw`<?php
use App\Models\User;
require __DIR__ . "/x.php";
`), ['suffix:App/Models/User.php', 'suffix:Models/User.php', 'rel:x.php']);
});

test('ruby: modules, classes and methods closed by their `end`; require', () => {
  assert.deepEqual(syms('ruby', '# Mod\nmodule M\n  class A\n    def b\n      1\n    end\n    def self.c = 2\n  end\nend\n'),
    [['M', 'module', 2, 9], ['A', 'class', 3, 8], ['A.b', 'method', 4, 6], ['A.c', 'method', 7, 7]]);
  assert.deepEqual(refs('ruby', "require_relative 'lib/x'\nrequire 'json'\n"), ['rel:lib/x.rb', 'suffix:json.rb']);
});

test('terraform AWS: Lambda zip and archive_file sources are references', () => {
  assert.deepEqual(refs('hcl', 'resource "aws_lambda_function" "f" {\n  filename = "${path.module}/build/f.zip"\n}\ndata "archive_file" "a" {\n  source_dir = "src"\n}\n'), ['rel:build/f.zip', 'rel:src']);
});

test('langOf: the new languages', () => {
  assert.deepEqual(['a.json', 'package-lock.json', 'a.toml', 'Makefile', 'x.mk', 'a.graphql', 'a.proto', 'a.go', 'a.pb.go', 'A.java', 'A.kt', 'A.cs', 'a.php', 'a.rs', 'a.rb'].map(p => langOf(p)?.id),
    ['json', undefined, 'toml', 'make', 'make', 'graphql', 'proto', 'go', undefined, 'java', 'kotlin', 'csharp', 'php', 'rust', 'ruby']);
});
