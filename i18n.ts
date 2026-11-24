import { AsyncLocalStorage } from 'node:async_hooks';
import { messages } from './locales.ts';

export type Lang = 'es' | 'en';
export const LANGS: readonly Lang[] = ['es', 'en'];

let dflt: Lang = 'es';
export const normLang = (x: unknown): Lang => ((LANGS as readonly unknown[]).includes(x) ? (x as Lang) : dflt);
export const setDefaultLang = (x?: unknown) => { dflt = (LANGS as readonly unknown[]).includes(x) ? (x as Lang) : 'es'; };
export const defaultLang = () => dflt;

// The language of the request being served: t() reads it from here so no function has to carry a `lang` parameter.
const als = new AsyncLocalStorage<Lang>();
export const withLang = <T>(lang: unknown, f: () => T): T => als.run(normLang(lang), f);
export const curLang = (): Lang => als.getStore() ?? dflt;

// {name} interpolation. Plural: with a numeric vars.n, a value written 'one|other' picks 'one' when n == 1.
export function t(key: string, vars: Record<string, string | number> = {}): string {
  let s = messages[curLang()][key] ?? messages.es[key] ?? key;
  if (typeof vars.n === 'number' && s.includes('|')) { const p = s.split('|'); s = vars.n === 1 ? p[0] : p[1]; }
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
