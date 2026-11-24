// Connections the user manages from the UI: "disconnect" (prpeer stops using a credential even if the machine has it)
// and "connect with a token/key" (stored locally, readable only by the user). It never goes back to the browser.
// Ids: "github", "jira" or "p:<provider id>". It does not touch `gh` or `claude`: it does not log out of them.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type Entry = { off?: boolean; secret?: string; url?: string; email?: string }; // url and email: data for integrations such as Jira (the token goes in secret)

const file = () => join(process.env.PRPEER_HOME ?? join(homedir(), '.prpeer'), 'connections.json');
const read = (): Record<string, Entry> => {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, Entry>;
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; } // no file or corrupted: nothing stored
};

export const entry = (id: string): Entry => read()[id] ?? {};

export function setEntry(id: string, e: Entry | null) {
  const all = read();
  if (e && (e.off || e.secret)) all[id] = e; else delete all[id];
  const f = file();
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(all, null, 2), { mode: 0o600 });
  try { chmodSync(f, 0o600); } catch { /* Windows: no POSIX permissions */ }
}

// A token/key pasted in the UI: a single line, no spaces, of reasonable length.
export const okSecret = (s: unknown): s is string => typeof s === 'string' && /^\S{8,500}$/.test(s);
