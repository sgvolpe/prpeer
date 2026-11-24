// Jira tickets cited in the title, the branch or the commits. With PRPEER_JIRA_URL they are linked; with PRPEER_JIRA_EMAIL and PRPEER_JIRA_TOKEN their summary, status and description are fetched too.
import { entry } from './connections.ts';
import { t } from './i18n.ts';

export type JiraIssue = { key: string; url?: string; summary?: string; status?: string; type?: string; priority?: string; assignee?: string; description?: string; error?: string };

// Credentials: what was saved from Connections > the PRPEER_JIRA_URL / PRPEER_JIRA_EMAIL / PRPEER_JIRA_TOKEN variables. Disconnected = none is used.
export function jiraConfig(): { env: Record<string, string | undefined>; from?: 'saved' | 'env'; off?: boolean } {
  const e = entry('jira');
  if (e.off) return { env: {}, off: true };
  if (e.secret && e.url && e.email) return { env: { PRPEER_JIRA_URL: e.url, PRPEER_JIRA_EMAIL: e.email, PRPEER_JIRA_TOKEN: e.secret }, from: 'saved' };
  const p = process.env;
  return { env: p, from: p.PRPEER_JIRA_URL && p.PRPEER_JIRA_EMAIL && p.PRPEER_JIRA_TOKEN ? 'env' : undefined };
}
export const okJiraUrl = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/[^/\s]+$/.test(u);

export async function jiraGet(env: Record<string, string | undefined>, path: string, f: typeof fetch = fetch): Promise<Response> {
  const url = env.PRPEER_JIRA_URL!.replace(/\/+$/, '');
  return f(url + path, { headers: { authorization: 'Basic ' + Buffer.from(`${env.PRPEER_JIRA_EMAIL}:${env.PRPEER_JIRA_TOKEN}`).toString('base64'), accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
}

const KEY = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g;
export const jiraKeys = (...texts: (string | undefined)[]): string[] => [...new Set(texts.flatMap(x => x?.match(KEY) ?? []))].slice(0, 5);

// the description arrives as ADF (a node tree): it is flattened to readable text (separate paragraphs, bulleted lists)
const adfText = (n: unknown): string => {
  const x = n as { text?: string; content?: unknown[]; type?: string; attrs?: { text?: string } } | null;
  if (!x || typeof x !== 'object') return '';
  const inner = x.content?.map(adfText).join('') ?? '';
  switch (x.type) {
    case 'text': return x.text ?? '';
    case 'hardBreak': return '\n';
    case 'mention': case 'emoji': return x.attrs?.text ?? '';
    case 'paragraph': case 'heading': case 'codeBlock': case 'blockquote': return inner + '\n\n';
    case 'listItem': return '• ' + inner.trim() + '\n';
    case 'bulletList': case 'orderedList': return inner + '\n';
    default: return (x.text ?? '') + inner;
  }
};

export async function jiraIssues(keys: string[], env: Record<string, string | undefined> = jiraConfig().env, f: typeof fetch = fetch): Promise<JiraIssue[]> {
  const base = env.PRPEER_JIRA_URL?.replace(/\/+$/, '');
  const url = base && /^https:\/\/[^/\s]+$/.test(base) ? base : undefined; // https only and no path: the token never travels in the clear or anywhere else
  const auth = env.PRPEER_JIRA_EMAIL && env.PRPEER_JIRA_TOKEN ? 'Basic ' + Buffer.from(`${env.PRPEER_JIRA_EMAIL}:${env.PRPEER_JIRA_TOKEN}`).toString('base64') : undefined;
  return Promise.all(keys.map(async (key): Promise<JiraIssue> => {
    const out: JiraIssue = { key, url: url && `${url}/browse/${key}` };
    if (!url || !auth) return out;
    try {
      const r = await jiraGet(env, `/rest/api/3/issue/${key}?fields=summary,status,description,issuetype,priority,assignee`, f);
      if (!r.ok) return { ...out, error: r.status === 401 || r.status === 403 ? t('jira.noAccess') : r.status === 404 ? t('jira.notFound') : t('jira.http', { status: r.status }) };
      const j = await r.json() as { fields?: { summary?: string; status?: { name?: string }; issuetype?: { name?: string }; priority?: { name?: string }; assignee?: { displayName?: string } | null; description?: unknown } };
      return { ...out, summary: j.fields?.summary, status: j.fields?.status?.name, type: j.fields?.issuetype?.name, priority: j.fields?.priority?.name, assignee: j.fields?.assignee?.displayName, description: adfText(j.fields?.description).replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000) || undefined };
    } catch { return { ...out, error: t('jira.unreachable') }; }
  }));
}
