// LLM usage log: one JSON line per answered request in ~/.prpeer/usage.jsonl (tokens and estimated dollars).
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type Usage = { in: number; out: number; cr: number; cw: number; cost?: number }; // cr/cw: cache read/write input tokens; cost set by the provider when it reports one (claude-cli)
export type Rec = Usage & { ts: string; pr: string; title: string; task: string; provider: string; model: string; cost: number | null };

// USD per million tokens [input, output, cache read]. Cache write = 1.25x input.
// shortcut: Anthropic list prices as of 2026-11; unknown models (openai-compat, local) count tokens with cost null. Add a config override if needed.
const PRICES: Record<string, [number, number, number]> = {
  'claude-fable-5-2': [8, 40, 0.2], 'claude-opus-5-5': [4, 20, 0.2], 'claude-sonnet-5-5': [2, 10, 0.1], 'claude-haiku-5-5': [0.1, 0.5, 0.01],
  'claude-opus-5': [5, 25, 0.5], 'claude-sonnet-5': [2, 10, 0.2],
};
export const newUsage = (): Usage => ({ in: 0, out: 0, cr: 0, cw: 0 });
export function costOf(model: string, u: Usage): number | null {
  if (u.cost != null) return u.cost;
  const p = PRICES[model];
  return p ? (u.in * p[0] + u.out * p[1] + u.cr * p[2] + u.cw * p[0] * 1.25) / 1e6 : null;
}

const file = () => join(process.env.PRPEER_HOME ?? join(homedir(), '.prpeer'), 'usage.jsonl');

export function record(r: Omit<Rec, 'ts' | 'cost'>) {
  if (!r.in && !r.out) return; // cached answer or failed before any token
  const f = file();
  mkdirSync(dirname(f), { recursive: true });
  const { cost: _c, ...rest } = r;
  appendFileSync(f, JSON.stringify({ ts: new Date().toISOString(), ...rest, cost: costOf(r.model, r) }) + '\n');
}

export function readAll(): Rec[] {
  try { return readFileSync(file(), 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l) as Rec]; } catch { return []; } }); }
  catch { return []; }
}

export const totals = (rs: Rec[]) => rs.reduce((a, r) => ({ n: a.n + 1, in: a.in + r.in + r.cr + r.cw, out: a.out + r.out, cost: a.cost + (r.cost ?? 0), unpriced: a.unpriced + (r.cost == null ? 1 : 0) }), { n: 0, in: 0, out: 0, cost: 0, unpriced: 0 });
