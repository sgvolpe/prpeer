import { existsSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { entry } from './connections.ts';
import { t } from './i18n.ts';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import type { Usage } from './usage.ts';

export type Msg = { role: 'user' | 'assistant'; content: string };
export type Req = { system: string; messages: Msg[]; model: string; effort?: string; signal?: AbortSignal; usage?: Usage; maxTokens?: number }; // usage: filled in by the provider as tokens are reported
export type ProviderCfg = {
  id: string;
  label?: string;
  type: 'anthropic' | 'openai-compat' | 'claude-cli'; // claude-cli: the `claude` binary in -p mode, uses your login/subscription (no API key). openai-compat: OpenAI, Ollama, LM Studio, OpenRouter, vLLM, Gemini (compatible endpoint)…
  apiKeyEnv?: string; // name of the environment variable holding the key; the key never reaches the browser
  baseUrl?: string;
  models?: string[];
  efforts?: string[];
  command?: string; // claude-cli: binary to run (default: claude)
  fallbacks?: boolean; // anthropic: server-side fallback on refusals (default: yes, unless baseUrl is custom)
};
export type Config = { providers: ProviderCfg[]; default?: { provider: string; model?: string; effort?: string }; lang?: 'es' | 'en'; // UI and model-reply language (default 'es')
  language?: string; // optional override for the language NAME the model is told to reply in (e.g. 'português')
  mood?: unknown;
  repoDirs?: string[]; // where to look for local clones (default: ~/repos, ~/code, ~/projects, ~/src, ~/dev, ~/git, ~/source/repos, ~/Documents/GitHub, ~/Desktop)
  repos?: Record<string, string>; // owner/name -> clone folder, if it is not discovered by itself
  cacheDir?: string; // where prpeer clones the repos you do not have (default ~/.prpeer/repos)
  github?: { tokenEnv?: string; apiUrl?: string; cloneUrl?: string }; // cloneUrl carries {repo}
};

const DEFAULTS: Config = {
  providers: [{
    id: 'anthropic', label: 'Claude (Anthropic)', type: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  }, {
    id: 'claude-cli', type: 'claude-cli',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  }],
  default: { provider: 'anthropic', model: 'claude-opus-5-5' },
};

// Search order: --config, $PRPEER_CONFIG, ./prpeer.config.json, ~/.prpeer/config.json. No file: Claude only.
export function loadConfig(explicit?: string): Config {
  const f = [explicit, process.env.PRPEER_CONFIG, 'prpeer.config.json', join(homedir(), '.prpeer', 'config.json')].find(p => p && existsSync(p));
  if (!f) return DEFAULTS;
  const c = JSON.parse(readFileSync(f, 'utf8')) as Partial<Config>;
  if (!Array.isArray(c.providers) || !c.providers.length) throw new Error(`${f}: "providers" is missing`);
  const ids = new Set<string>();
  for (const p of c.providers) {
    if (!p.id || ids.has(p.id)) throw new Error(`${f}: provider without an id, or duplicate id (${p.id})`);
    ids.add(p.id);
    if (!['anthropic', 'openai-compat', 'claude-cli'].includes(p.type)) throw new Error(`${f}: provider "${p.id}": type must be "anthropic", "openai-compat" or "claude-cli"`);
    if (p.type === 'openai-compat' && !p.baseUrl) throw new Error(`${f}: provider "${p.id}": baseUrl is missing`);
  }
  return { ...DEFAULTS, ...c, providers: c.providers };
}

const find = (cfg: Config, id: string) => {
  const p = cfg.providers.find(x => x.id === id);
  if (!p) throw new Error(t('llm.unknownProvider', { id }));
  return p;
};
const envKey = (p: ProviderCfg) => process.env[p.apiKeyEnv ?? (p.type === 'anthropic' ? 'ANTHROPIC_API_KEY' : '')];
const keyOf = (p: ProviderCfg) => { const c = entry('p:' + p.id); return c.off ? undefined : c.secret ?? envKey(p); }; // key pasted in the UI > environment
const isOff = (p: ProviderCfg) => !!entry('p:' + p.id).off;
const anthropicClient = (p: ProviderCfg) => new Anthropic({ ...(keyOf(p) ? { apiKey: keyOf(p) } : {}), ...(p.baseUrl ? { baseURL: p.baseUrl } : {}) });

// What the UI sees: providers, models (configured + the ones the provider lists, if it answers) and efforts.
export async function llmInfo(cfg: Config) {
  const providers = await Promise.all(cfg.providers.map(async p => {
    let live: string[] = [];
    try {
      const signal = AbortSignal.timeout(3000);
      if (p.type === 'openai-compat') {
        const res = await fetch(`${p.baseUrl!.replace(/\/$/, '')}/models`, { signal, headers: keyOf(p) ? { authorization: `Bearer ${keyOf(p)}` } : {} });
        if (res.ok) live = ((await res.json()) as { data?: { id: string }[] }).data?.map(m => m.id) ?? [];
      } else if (keyOf(p)) {
        live = (await anthropicClient(p).models.list({ limit: 100 }, { signal })).data.map(m => m.id);
      }
    } catch { /* no live list: the configured models remain */ }
    return {
      id: p.id, label: p.label ?? (p.id === 'claude-cli' ? t('llm.cliLabel') : p.id), type: p.type,
      ready: !isOff(p) && (p.type === 'anthropic' ? !!keyOf(p) : p.type === 'claude-cli' ? cliInstalled(p) : !p.apiKeyEnv || !!keyOf(p)), // no key = the SDK fails on the first click, so not ready
      off: isOff(p),
      from: p.type === 'claude-cli' ? (cliInstalled(p) ? 'cli' : undefined) : entry('p:' + p.id).secret ? 'saved' : envKey(p) ? 'env' : undefined,
      needsKey: p.type !== 'claude-cli' && (p.type === 'anthropic' || !!p.apiKeyEnv),
      keyEnv: p.apiKeyEnv && !keyOf(p) ? p.apiKeyEnv : undefined,
      models: [...new Set([...(p.models ?? []), ...live])],
      efforts: p.efforts ?? (p.type !== 'openai-compat' ? ['low', 'medium', 'high', 'xhigh', 'max'] : ['low', 'medium', 'high']),
    };
  }));
  // no default in the config: the first one that can really answer (with a key or the CLI installed), not one that will fail on the first click
  const usable = cfg.providers.find(p => !isOff(p) && (p.type === 'claude-cli' ? cliInstalled(p) : p.type === 'anthropic' ? !!keyOf(p) : p.apiKeyEnv ? !!keyOf(p) : true));
  return { providers, default: cfg.default ?? { provider: (usable ?? cfg.providers[0]).id }, language: cfg.language };
}

export async function* stream(cfg: Config, providerId: string, r: Req): AsyncGenerator<string> {
  const p = find(cfg, providerId);
  if (isOff(p)) throw new Error(t('llm.off', { label: p.label ?? p.id }));
  yield* p.type === 'anthropic' ? anthropicStream(p, r) : p.type === 'claude-cli' ? cliStream(p, r) : openaiStream(p, r);
}

async function* anthropicStream(p: ProviderCfg, r: Req): AsyncGenerator<string> {
  const client = anthropicClient(p);
  // thinking is left out on purpose: in the 5.x family it is already adaptive and on other models it forces budget_tokens
  const params = {
    model: r.model, max_tokens: r.maxTokens ?? 16000, system: r.system, messages: r.messages,
    cache_control: { type: 'ephemeral' as const },
    ...(r.effort ? { output_config: { effort: r.effort } } : {}),
  };
  const fallbacks = p.fallbacks ?? !p.baseUrl;
  const useFb = fallbacks && /^claude-(fable-5|opus-5|sonnet-5-5)/.test(r.model);
  const s = useFb
    ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as never, { signal: r.signal })
    : client.messages.stream(params as never, { signal: r.signal });
  for await (const ev of s as AsyncIterable<{ type: string; delta?: { type: string; text?: string } }>)
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') yield ev.delta.text ?? '';
  const m = await s.finalMessage();
  const u = m.usage as { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
  if (r.usage) Object.assign(r.usage, { in: u.input_tokens, out: u.output_tokens, cr: u.cache_read_input_tokens ?? 0, cw: u.cache_creation_input_tokens ?? 0 });
  if (m.stop_reason === 'refusal') yield '\n\n' + t('llm.refusal');
  else if (m.stop_reason === 'max_tokens') yield '\n\n' + t('llm.maxTokens');
}

async function* openaiStream(p: ProviderCfg, r: Req): AsyncGenerator<string> {
  const res = await fetch(`${p.baseUrl!.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    signal: r.signal,
    headers: { 'content-type': 'application/json', ...(keyOf(p) ? { authorization: `Bearer ${keyOf(p)}` } : {}) },
    body: JSON.stringify({
      model: r.model, stream: true, stream_options: { include_usage: true }, ...(r.maxTokens ? { max_tokens: r.maxTokens } : {}),
      messages: [{ role: 'system', content: r.system }, ...r.messages],
      ...(r.effort ? { reasoning_effort: r.effort } : {}),
    }),
  });
  if (!res.ok || !res.body) throw new Error(`${p.id}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      if (j.usage && r.usage) Object.assign(r.usage, { in: j.usage.prompt_tokens ?? 0, out: j.usage.completion_tokens ?? 0 });
      const t = j.choices?.[0]?.delta?.content;
      if (t) yield t;
    }
  }
}

const cliCmd = (p: ProviderCfg) => p.command ?? 'claude';
// On Windows only a real claude.exe counts (official installer or winget): Node refuses to spawn the npm claude.cmd shim
// without a shell, and a shell would parse the model name that comes from the browser.
const cliInstalled = (p: ProviderCfg) => spawnSync(cliCmd(p), ['--version'], { timeout: 5000, stdio: 'ignore' }).status === 0;

// Claude Code in non-interactive mode. Isolated on purpose: no tools, no MCP, no skills, no user settings
// (no hooks or CLAUDE.md) and in an empty folder, because the PR diff is untrusted text and must not be able to run anything.
// The prompt goes through stdin (the command-line length limit is not enough for the context).
async function* cliStream(p: ProviderCfg, r: Req): AsyncGenerator<string> {
  const args = ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose', '--model', r.model,
    ...(r.effort ? ['--effort', r.effort] : []),
    '--system-prompt', t('llm.cliSystem'),
    '--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--setting-sources', ''];
  // without a key in the environment the CLI uses the subscription login; with a key it would bill the API
  const { ANTHROPIC_API_KEY: _k, ANTHROPIC_AUTH_TOKEN: _t, ...env } = process.env;
  const child = spawn(cliCmd(p), args, { cwd: tmpdir(), env, stdio: ['pipe', 'pipe', 'pipe'] });
  const onAbort = () => child.kill('SIGTERM');
  r.signal?.addEventListener('abort', onAbort);
  const convo = r.messages.map(m => `${m.role === 'user' ? t('llm.cliUser') : t('llm.cliAssistant')}: ${m.content}`).join('\n\n');
  child.stdin.on('error', () => {});
  child.stdin.end(`${r.system}\n\n${t('llm.cliConvo')}\n${convo}\n\n${t('llm.cliReply')}`);
  let err = '';
  child.stderr.on('data', c => (err += c));
  const exit = new Promise<number | null>(ok => child.on('close', ok));
  child.on('error', e => { err += (e as Error).message; });
  let any = false, final: { is_error?: boolean; result?: string; total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } | undefined, buf = '';
  try {
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        const j = JSON.parse(line) as { type?: string; event?: { type?: string; delta?: { type?: string; text?: string } }; is_error?: boolean; result?: string };
        if (j.type === 'stream_event' && j.event?.type === 'content_block_delta' && j.event.delta?.type === 'text_delta' && j.event.delta.text) { any = true; yield j.event.delta.text; }
        else if (j.type === 'result') final = j as typeof final;
      }
    }
    const code = await exit;
    const u = final?.usage; // the CLI reports its own cost (on a subscription: what the API would have charged)
    if (u && r.usage) Object.assign(r.usage, { in: u.input_tokens ?? 0, out: u.output_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0, cw: u.cache_creation_input_tokens ?? 0, cost: final?.total_cost_usd });
    if (final?.is_error) throw new Error(`${final.result ?? t('llm.cliError')}${/authenticat|OAuth|login/i.test(final.result ?? '') ? t('llm.cliLogin') : ''}`);
    if (!any && final?.result) yield final.result; // no partial deltas: at least the final text
    else if (!any && code !== 0) throw new Error(t('llm.cliExit', { code: String(code), err: err.trim().slice(0, 300) }));
  } finally {
    r.signal?.removeEventListener('abort', onAbort);
    if (child.exitCode === null) child.kill('SIGTERM');
  }
}
