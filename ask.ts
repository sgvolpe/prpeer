import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { posix } from 'node:path';
import { curLang, t } from './i18n.ts';
import { stream, type Config, type Msg } from './llm.ts';
import type { Usage } from './usage.ts';

type Sec = { name: string; kind: string; doc: string | null; add: number; del: number; first: number; last: number; lines: { k: '+' | '-'; t: string; o?: number; n?: number }[] };
type PFile = { path: string; oldPath?: string; status: string; add: number; del: number; binary: boolean; doc: string | null; sections: Sec[] };
export type Payload = {
  title: string; url?: string; base: { ref: string }; head: string; files: PFile[];
  links: { from: string; to: string; kind: string }[]; linked: { path: string }[];
  readmes: Record<string, string>; changelog: [string, string[]][] | null;
};
export type AskBody = {
  task: 'chat' | 'summary' | 'explain' | 'story' | 'review';
  tool?: ReviewTool; // with task 'review': which review to run
  provider: string; model: string; effort?: string;
  files?: string[]; // paths chosen in the UI; empty = the whole PR
  level?: 0 | 1 | 2; // 0 general, 1 file, 2 function/line (the zoom)
  messages?: Msg[];
  view?: { path: string; w: number }[]; // files on screen in the map and the focus each has (0..1): extra context, more detail the higher it is
  target?: { path: string; section?: string; line?: number; text?: string; whole?: boolean };
};

export const REVIEW_TOOLS = ['coherence', 'comments', 'security', 'tests', 'breaking'] as const;
export type ReviewTool = (typeof REVIEW_TOOLS)[number];
const CAP = 80_000; // context characters (~20k tokens)
export const SUMMARY_CAP = 40_000, SUMMARY_LINES = 8; // whole-PR summary: half the context, shorter sections (token savings)
const churn = (f: PFile) => f.add + f.del;
const secChurn = (s: Sec) => s.add + s.del;

export function buildContext(p: Payload, files: string[] | undefined, level: number, levels?: Map<string, number>, cap = CAP, lines = 15): string {
  const out: string[] = [];
  let used = 0, omitted = 0;
  const push = (s: string) => (used + s.length > cap ? (omitted++, false) : (out.push(s), (used += s.length), true));
  const A = p.files.reduce((s, f) => s + f.add, 0), D = p.files.reduce((s, f) => s + f.del, 0);
  push(t('ai.ctx.pr', { title: p.title, base: p.base.ref, head: p.head.slice(0, 8), files: t('ai.ctx.files', { n: p.files.length }), add: A, del: D }));

  const sel = files?.length ? new Set(files) : null;
  const chosen = p.files.filter(f => !sel || sel.has(f.path)).sort((a, b) => churn(b) - churn(a));
  if (!sel) {
    push(t('ai.ctx.changedFiles'));
    for (const f of chosen)
      push(`${f.status} ${f.path} +${f.add} −${f.del}${f.sections.length ? ' — ' + [...f.sections].sort((a, b) => secChurn(b) - secChurn(a)).slice(0, 3).map(s => s.name).join(', ') : ''}\n`);
  }
  const conn = (path: string) => {
    const uses = [...new Set(p.links.filter(l => l.from === path).map(l => l.to))].slice(0, 10);
    const by = [...new Set(p.links.filter(l => l.to === path).map(l => l.from))].slice(0, 10);
    return (uses.length ? t('ai.ctx.uses', { list: uses.join(', ') }) : '') + (by.length ? t('ai.ctx.usedBy', { list: by.join(', ') }) : '');
  };
  const maxOf = (path: string) => [0, lines, 80][levels?.get(path) ?? level] ?? lines;
  if (sel || level > 0 || levels) {
    for (const f of chosen) {
      if (!push(t('ai.ctx.fileHead', { path: f.path, status: f.status, add: f.add, del: f.del, old: f.oldPath ? t('ai.ctx.before', { path: f.oldPath }) : '', doc: f.doc ? t('ai.ctx.moduleDoc', { doc: f.doc }) : '', conn: conn(f.path) }))) continue;
      if (f.binary) { push(t('ai.ctx.binary')); continue; }
      const secs = [...f.sections].sort((a, b) => secChurn(b) - secChurn(a)), maxLines = maxOf(f.path);
      for (const s of secs) {
        const body = s.lines.slice(0, maxLines).map(l => `${l.k} ${l.n ?? l.o} | ${l.t.length > 200 ? l.t.slice(0, 200) + '…' : l.t}`).join('\n');
        const more = s.lines.length - maxLines;
        if (!push(t('ai.ctx.secHead', { kind: s.kind, name: s.name, first: s.first, last: s.last, add: s.add, del: s.del, doc: s.doc ? t('ai.ctx.secDoc', { doc: s.doc.split('\n')[0] }) : '', body: maxLines ? body + (more > 0 ? t('ai.ctx.moreLines', { n: more }) : '') + '\n' : '' }))) break;
      }
    }
  }
  if (sel) {
    const extra = [...sel].filter(f => !p.files.some(x => x.path === f));
    if (extra.length) push(t('ai.ctx.selectedUnchanged') + extra.map(f => `${f}\n${conn(f)}`).join(''));
  }
  const dirs = [...new Set((sel ? chosen : p.files).map(f => posix.dirname(f.path)).concat(sel ? [] : ['.']))];
  const rd = dirs.filter(d => p.readmes[d]).map(d => t('ai.ctx.readme', { dir: d, text: p.readmes[d] })).join('');
  if (rd) push(t('ai.ctx.readmes') + rd);
  if (p.changelog && (!sel || level === 0)) push(t('ai.ctx.changelog') + p.changelog.map(([g, xs]) => `${g}:\n${xs.map(x => '- ' + x).join('\n')}`).join('\n') + '\n');
  if (omitted) out.push(t('ai.ctx.trimmed', { n: omitted }));
  return out.join('');
}

export function buildPrompt(cfg: Config, p: Payload, b: AskBody, extra = ''): { system: string; messages: Msg[] } {
  const level = b.task === 'story' || (b.task === 'review' && b.tool !== 'security') ? 1 : b.task === 'review' ? 2 : b.level ?? 1;
  const task = {
    review: REVIEW_TOOLS.includes(b.tool as ReviewTool) ? t(`ai.review.${b.tool}`) : '',
    story: t('ai.story'),
    chat: t('ai.chat'),
    summary: b.files?.length ? t('ai.summary.selection', { level: t(`ai.level.${level}`) }) : t('ai.summary.all'),
    explain: t('ai.explain'),
  }[b.task as 'chat'];
  // what is on screen is context too: the more focus a file has, the more of its code the model sees (selected files keep the zoom level)
  const view = (b.view ?? []).filter(v => v && typeof v.path === 'string' && v.w > 0).sort((x, y) => y.w - x.w).slice(0, 40);
  const levels = view.length && b.task !== 'story' && b.task !== 'review' && (b.task !== 'summary' || b.files?.length) ? new Map(view.map(v => [v.path, v.w >= 0.66 ? 2 : v.w >= 0.33 ? 1 : 0])) : undefined;
  const files = levels ? [...new Set([...(b.files ?? []), ...levels.keys()])] : b.files;
  if (levels) for (const f of b.files ?? []) levels.set(f, Math.max(levels.get(f) ?? 0, level));
  const system = [
    t('ai.role'),
    t('ai.replyIn', { language: cfg.language ?? t('lang.name') }),
    t('ai.untrusted'),
    task,
    // grouping by feature needs to see each file's sections, even when the zoom is at general level
    t('ai.contextHeader') + (b.task === 'summary' && !files?.length ? buildContext(p, files, Math.max(level, 1), levels, SUMMARY_CAP, SUMMARY_LINES) : buildContext(p, b.task === 'story' || b.task === 'review' ? undefined : files, level, levels)) + extra,
  ].join('\n');
  if (b.task === 'review') {
    if (!REVIEW_TOOLS.includes(b.tool as ReviewTool)) throw new Error(t('ai.err.badReview', { tool: String(b.tool) }));
    return { system, messages: [{ role: 'user', content: t('ai.msg.review') }] };
  }
  if (b.task === 'story') return { system, messages: [{ role: 'user', content: t('ai.msg.story') }] };

  if (b.task === 'chat') {
    const m = (b.messages ?? []).filter(x => (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string').slice(-20);
    if (!m.length || m.at(-1)!.role !== 'user') throw new Error(t('ai.err.noQuestion'));
    return { system, messages: m };
  }
  if (b.task === 'summary') return { system, messages: [{ role: 'user', content: t('ai.msg.summary') }] };
  const tg = b.target;
  if (!tg?.path) throw new Error(t('ai.err.noTarget'));
  const sec = p.files.find(f => f.path === tg.path)?.sections.find(s => s.name === tg.section);
  const code = sec ? sec.lines.slice(0, 120).map(l => `${l.k} ${l.n ?? l.o} | ${l.t}`).join('\n') : '';
  return {
    system,
    messages: [{
      role: 'user',
      content: t('ai.explainReq.head', { what: t(tg.whole || !tg.text ? 'ai.explainReq.section' : 'ai.explainReq.line'), path: tg.path })
        + (tg.section ? t('ai.explainReq.sectionName', { section: tg.section }) : '') + (tg.line ? t('ai.explainReq.lineNo', { line: tg.line }) : '') + '.'
        + (tg.text ? t('ai.explainReq.lineText', { text: tg.text.slice(0, 400) }) : '') + (code ? t('ai.explainReq.fullSection', { code }) : ''),
    }],
  };
}

// summaries and explanations: same request, same answer. Kept on disk so reopening a PR (or restarting prpeer) costs nothing.
// shortcut: one file per answer, never pruned; add an LRU cleanup if ~/.prpeer/answers grows too much
const ansDir = () => join(process.env.PRPEER_HOME ?? join(homedir(), '.prpeer'), 'answers');
const cache = {
  get: (k: string) => { try { return readFileSync(join(ansDir(), k + '.md'), 'utf8'); } catch { return undefined; } },
  set: (k: string, v: string) => { try { mkdirSync(ansDir(), { recursive: true }); writeFileSync(join(ansDir(), k + '.md'), v); } catch { /* cache is best effort */ } },
};
export async function* ask(cfg: Config, p: Payload, b: AskBody, signal?: AbortSignal, extra = '', usage?: Usage): AsyncGenerator<string> {
  if (!['chat', 'summary', 'explain', 'story', 'review'].includes(b.task)) throw new Error(t('ai.err.badTask', { task: String(b.task) }));
  if (!b.provider || !b.model) throw new Error(t('ai.err.pickModel'));
  const { system, messages } = buildPrompt(cfg, p, b, extra);
  const key = b.task === 'chat' ? '' : createHash('sha1').update(JSON.stringify([curLang(), b.task, b.provider, b.model, b.effort, b.files, b.view, b.level, b.target, b.tool, p.head, extra])).digest('hex');
  const hit = key ? cache.get(key) : undefined;
  if (hit) { yield hit; return; }
  let text = '';
  for await (const c of stream(cfg, b.provider, { system, messages, model: b.model, effort: b.effort || (b.task === 'summary' ? 'low' : undefined), maxTokens: b.task === 'summary' ? 4000 : undefined, signal, usage })) { text += c; yield c; }
  // answers that ended in a refusal or a cut-off (or that are an error) are not worth remembering
  if (key && text && !text.startsWith('[') && !text.includes(t('llm.refusal')) && !text.includes(t('llm.maxTokens'))) cache.set(key, text);
}
