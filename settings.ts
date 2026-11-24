// Settings the user edits from the UI (⚙ Ajustes). They live in ~/.prpeer/settings.json, apart from config.json
// (hand-written, needs `providers`), and win over it. Every value is validated here: the file and the body are untrusted.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type Settings = { repoDirs?: string[]; maxSessions?: number; graphLimit?: number };
export const LIMITS = { maxSessions: [1, 20], graphLimit: [50, 5000] } as const;

const file = () => join(process.env.PRPEER_HOME ?? join(homedir(), '.prpeer'), 'settings.json');

// a folder: absolute (C:\x, /x) or under the home (~/x), one line, no control characters
const okDir = (d: unknown): d is string => typeof d === 'string' && d.length <= 500 && !/[\0-\x1f]/.test(d) && /^(~([\\/]|$)|[a-zA-Z]:[\\/]|\/)/.test(d.trim());
const okInt = (v: unknown, [lo, hi]: readonly [number, number]): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

export function clean(raw: unknown): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, s: Settings = {};
  if (Array.isArray(o.repoDirs)) s.repoDirs = [...new Set(o.repoDirs.filter(okDir).map(d => d.trim()))].slice(0, 30);
  if (okInt(o.maxSessions, LIMITS.maxSessions)) s.maxSessions = o.maxSessions;
  if (okInt(o.graphLimit, LIMITS.graphLimit)) s.graphLimit = o.graphLimit;
  return s;
}

export function readSettings(): Settings {
  try { return clean(JSON.parse(readFileSync(file(), 'utf8'))); } catch { return {}; } // no file or corrupted: defaults
}

// `patch` keys set to null go back to the default
export function writeSettings(patch: Record<string, unknown>): Settings {
  const cur = readSettings() as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch ?? {})) if (v === null) delete cur[k]; else cur[k] = v;
  const s = clean(cur);
  const bad = Object.keys(patch ?? {}).filter(k => patch[k] !== null && !(k in s) && ['repoDirs', 'maxSessions', 'graphLimit'].includes(k));
  if (bad.length) throw Object.assign(new Error(`invalid: ${bad.join(', ')}`), { code: 'bad_request', status: 400 });
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(s, null, 2));
  return s;
}
