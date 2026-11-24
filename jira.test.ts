import assert from 'node:assert/strict';
import test from 'node:test';
import { jiraIssues, jiraKeys } from './jira.ts';

test('detects keys in title, branch and commits without repeating them', () => {
  assert.deepEqual(jiraKeys('PROJ-12 fixes payments', 'feature/PROJ-12-payments', 'fix ABC-7, not abc-8 or X-1'), ['PROJ-12', 'ABC-7']);
  assert.deepEqual(jiraKeys(undefined, 'no ticket'), []);
});

test('with no configuration there is only a key; with a URL there is a link; with credentials the ticket is fetched', async () => {
  assert.deepEqual(await jiraIssues(['PROJ-1'], {}), [{ key: 'PROJ-1', url: undefined }]);
  assert.equal((await jiraIssues(['PROJ-1'], { PRPEER_JIRA_URL: 'https://x.atlassian.net/' }))[0].url, 'https://x.atlassian.net/browse/PROJ-1');
  assert.equal((await jiraIssues(['PROJ-1'], { PRPEER_JIRA_URL: 'http://x.atlassian.net' }))[0].url, undefined); // http: no
  let seen = '';
  const f = (async (u: string, o: { headers: Record<string, string> }) => { seen = u + o.headers.authorization; return { ok: true, json: async () => ({ fields: { summary: 'Payments', status: { name: 'In Progress' }, description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Do X' }] }] } } }) }; }) as never;
  const [i] = await jiraIssues(['PROJ-1'], { PRPEER_JIRA_URL: 'https://x.atlassian.net', PRPEER_JIRA_EMAIL: 'a@b.c', PRPEER_JIRA_TOKEN: 't' }, f);
  assert.deepEqual([i.summary, i.status, i.description], ['Payments', 'In Progress', 'Do X']);
  assert.match(seen, /^https:\/\/x\.atlassian\.net\/rest\/api\/3\/issue\/PROJ-1\?/);
});

test('a ticket that Jira rejects comes back with the reason instead of staying silent', async () => {
  const env = { PRPEER_JIRA_URL: 'https://x.atlassian.net', PRPEER_JIRA_EMAIL: 'a@b.c', PRPEER_JIRA_TOKEN: 't' };
  const [a] = await jiraIssues(['PROJ-1'], env, (async () => ({ ok: false, status: 401 })) as never);
  assert.match(a.error!, /sin acceso/);
  const [b] = await jiraIssues(['PROJ-1'], env, (async () => { throw new Error('red'); }) as never);
  assert.match(b.error!, /no pude comunicarme/);
});

test('jiraConfig: what is saved wins over the environment and disconnecting turns both off', async () => {
  const { mkdtempSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const { setEntry } = await import('./connections.ts'), { jiraConfig } = await import('./jira.ts');
  process.env.PRPEER_HOME = mkdtempSync(join(tmpdir(), 'prpeer-j-'));
  assert.equal(jiraConfig().from, undefined);
  setEntry('jira', { secret: 'tokentoken', url: 'https://x.atlassian.net', email: 'a@b.c' });
  assert.deepEqual([jiraConfig().from, jiraConfig().env.PRPEER_JIRA_EMAIL], ['saved', 'a@b.c']);
  setEntry('jira', { off: true });
  assert.deepEqual([jiraConfig().off, jiraConfig().from], [true, undefined]);
});

test('the description is flattened to readable text (paragraphs, bullets) and brings type, priority and assignee', async () => {
  const t = (text: string) => ({ type: 'text', text });
  const doc = { type: 'doc', content: [
    { type: 'heading', content: [t('Goal')] },
    { type: 'paragraph', content: [t('Allow '), t('partial refunds')] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [t('amount below the charge')] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [t('idempotent')] }] }] },
  ] };
  const f = (async () => ({ ok: true, json: async () => ({ fields: { summary: 'S', status: { name: 'Done' }, issuetype: { name: 'Story' }, priority: { name: 'High' }, assignee: { displayName: 'Ana' }, description: doc } }) })) as never;
  const [i] = await jiraIssues(['PROJ-1'], { PRPEER_JIRA_URL: 'https://x.atlassian.net', PRPEER_JIRA_EMAIL: 'a@b.c', PRPEER_JIRA_TOKEN: 't' }, f);
  assert.equal(i.description, 'Goal\n\nAllow partial refunds\n\n• amount below the charge\n• idempotent');
  assert.deepEqual([i.type, i.priority, i.assignee], ['Story', 'High', 'Ana']);
});
