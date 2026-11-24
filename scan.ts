// Local search (no AI, no network) for secrets and dangerous patterns ONLY in the lines the PR adds.
import type { Payload } from './ask.ts';
import { t } from './i18n.ts';

// `level` is a language-neutral code (the UI localizes it); `rule` is already a sentence in the language of the request.
export type Finding = { path: string; line?: number; rule: string; level: 'secret' | 'signal'; sample: string };

// [message key, pattern]: the key is resolved at scan time so each request gets its own language
const SECRETS: [string, RegExp][] = [
  ['aws', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['privateKey', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['github', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['slack', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['google', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['stripe', /\b[sr]k_live_[0-9A-Za-z]{16,}/],
  ['aiKey', /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['urlCreds', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]{3,}@/i],
];
const ASSIGN = /\b(?:pass(?:word|wd)?|secret|token|api[_-]?key|private[_-]?key|client[_-]?secret)\b["']?\s*[:=]\s*["']([^"'\s]{8,})["']/i;
const PLACEHOLDER = /\$\{|\{\{|<[^>]+>|your|change.?me|example|sample|dummy|placeholder|xxx|\*{3}|env|getenv|process\./i;
const SIGNALS: [string, RegExp][] = [
  ['shell', /shell\s*=\s*True/],
  ['tls', /verify\s*=\s*False|rejectUnauthorized\s*:\s*false|InsecureSkipVerify\s*:\s*true/],
  ['eval', /\b(?:eval|exec)\s*\(/],
  ['deser', /\bpickle\.loads?\(|\byaml\.load\((?![^)]*Loader\s*=\s*(?:yaml\.)?Safe)/],
  ['html', /\.innerHTML\s*=|dangerouslySetInnerHTML/],
  ['sql', /\b(?:execute|query)\s*\(\s*(?:f["']|["'][^"']*["']\s*(?:\+|%|\.format))/],
];
const FILES = /(?:^|\/)(?:\.env(?:\.(?!example|sample|template).+)?|id_rsa|id_ed25519|[^/]+\.(?:pem|p12|pfx|key)|credentials(?:\.json)?|\.npmrc|\.pypirc)$/;

const mask = (s: string) => (s.length <= 8 ? '****' : t('scan.masked', { head: s.slice(0, 4), n: s.length })); // the whole secret is never returned
const rule = (k: string) => t(`scan.rule.${k}`);

export function scanPayload(p: Payload): Finding[] {
  const out: Finding[] = [];
  for (const f of p.files) {
    if (f.binary) continue;
    if (f.status !== 'D' && f.status !== 'deleted' && FILES.test(f.path)) out.push({ path: f.path, rule: rule('file'), level: 'secret', sample: f.path });
    for (const s of f.sections) for (const l of s.lines) {
      if (l.k !== '+') continue;
      const text = l.t, at = { path: f.path, line: l.n };
      for (const [k, re] of SECRETS) { const m = re.exec(text); if (m) out.push({ ...at, rule: rule(k), level: 'secret', sample: mask(m[0]) }); }
      const a = ASSIGN.exec(text);
      if (a && !PLACEHOLDER.test(a[1])) out.push({ ...at, rule: rule('assign'), level: 'secret', sample: mask(a[1]) });
      for (const [k, re] of SIGNALS) if (re.test(text)) out.push({ ...at, rule: rule(k), level: 'signal', sample: text.trim().slice(0, 100) });
    }
  }
  const seen = new Set<string>();
  return out.filter(x => { const k = `${x.path}:${x.line}:${x.rule}`; return !seen.has(k) && seen.add(k); }).slice(0, 200);
}
