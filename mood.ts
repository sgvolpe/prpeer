// "Mood" rules (risk per file). Layers, lowest to highest priority: defaults < user config < the repo's `.prpeer.json`.
// Validation errors are English-only on purpose: they are about config files and are read by developers.
export type MoodCfg = {
  riskWords: string[]; // regex (case-insensitive) over docstrings and descriptions; a match adds riskWeight
  riskPaths: { match: string; weight: number }[]; // regex over the file path; adds its weight
  ignore: string[]; // regex over the path: those files do not score (tests, docs…)
  riskWeight: number; churnPer: number; churnMax: number; // changed lines / churnPer, capped at churnMax
  fanInWeight: number; fanInMax: number; // per file that uses it, capped
  noTestWeight: number; // no test imports it
  thresholds: [number, number]; // score < t0: calm; < t1: attention; otherwise risky
};

export const DEFAULT_MOOD: MoodCfg = {
  riskWords: ['auth', 'password', 'secret', 'token', 'payment', 'pago', 'billing', 'migration', 'security', 'seguridad'],
  riskPaths: [],
  ignore: ['spec', '(^|/)tests?/', '(^|/)test_', 'CHANGELOG'],
  riskWeight: 0.8, churnPer: 150, churnMax: 3, fanInWeight: 0.7, fanInMax: 2, noTestWeight: 1,
  thresholds: [2, 3.5],
};

const MAX_RE = 200; // max regex length: bounds the ReDoS risk in the browser
const NUMS = ['riskWeight', 'churnPer', 'churnMax', 'fanInWeight', 'fanInMax', 'noTestWeight'] as const;

function checkRe(src: string, where: string, re: unknown) {
  if (typeof re !== 'string' || !re || re.length > MAX_RE) throw new Error(`${src}: ${where} must be a regex of up to ${MAX_RE} characters`);
  try { new RegExp(re, 'i'); } catch (e) { throw new Error(`${src}: ${where} is not a valid regex (${(e as Error).message})`); }
}

export function resolveMood(...layers: { src: string; cfg?: unknown }[]): MoodCfg {
  const out: MoodCfg = structuredClone(DEFAULT_MOOD);
  for (const { src, cfg } of layers) {
    if (cfg == null) continue;
    if (typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error(`${src}: "mood" must be an object`);
    for (const [k, v] of Object.entries(cfg)) {
      if (k === 'riskWords' || k === 'ignore') {
        if (!Array.isArray(v)) throw new Error(`${src}: mood.${k} must be a list`);
        v.forEach((re, i) => checkRe(src, `mood.${k}[${i}]`, re));
        out[k] = v as string[];
      } else if (k === 'riskPaths') {
        if (!Array.isArray(v)) throw new Error(`${src}: mood.riskPaths must be a list`);
        v.forEach((r: { match?: unknown; weight?: unknown }, i) => {
          checkRe(src, `mood.riskPaths[${i}].match`, r?.match);
          if (typeof r.weight !== 'number' || !Number.isFinite(r.weight)) throw new Error(`${src}: mood.riskPaths[${i}].weight must be a number`);
        });
        out.riskPaths = v as MoodCfg['riskPaths'];
      } else if ((NUMS as readonly string[]).includes(k)) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (k === 'churnPer' && v === 0)) throw new Error(`${src}: mood.${k} must be a number ≥ 0 (churnPer > 0)`);
        out[k as (typeof NUMS)[number]] = v;
      } else if (k === 'thresholds') {
        if (!Array.isArray(v) || v.length !== 2 || !v.every(n => typeof n === 'number') || v[0] >= v[1]) throw new Error(`${src}: mood.thresholds must be [calm, risky] with the first one lower`);
        out.thresholds = v as [number, number];
      } else throw new Error(`${src}: mood.${k} does not exist (valid keys: riskWords, riskPaths, ignore, ${NUMS.join(', ')}, thresholds)`);
    }
  }
  return out;
}
