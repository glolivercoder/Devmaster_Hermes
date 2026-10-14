/** LLM Control Center backend — providers status, spend, routing. No secrets leave the server (masked only). */
import { LLM_MODELS, ROUTE_TARGETS } from './models.js';
import { LLM_PROVIDERS, maskSecret, type ProviderInfo } from './providers-llm.js';
import { OTHER_PROVIDERS } from './providers-other.js';
import { loadRouting, saveRouting, type RoutingState } from './routing-store.js';

export interface ProviderStatus extends ProviderInfo {
  configured: boolean;
  keysPresent: string[];
  keysMasked: Record<string, string>;
  baseUrl: string;
}

const LITELLM_BASE = () => process.env.LITELLM_BASE_URL ?? 'http://litellm:4000';
const LITELLM_KEY = () => process.env.LITELLM_MASTER_KEY ?? '';

/**
 * How to reach each LLM provider's "list models" health endpoint.
 * Every probe is a cheap GET that validates the key without spending tokens.
 */
interface ProbeSpec {
  /** Path appended to the resolved base URL. */
  path: string;
  /** Header name carrying the credential (Gemini uses a query param instead). */
  header?: string;
  /** Prefix prepended to the key value (e.g. 'Bearer '). */
  prefix?: string;
  /** Put the key in a query-string parameter instead of a header. */
  queryParam?: string;
  /** Extra static headers required by the provider. */
  extraHeaders?: Record<string, string>;
  /** Literal value used when the credential comes from GCP ADC instead of a key. */
  note?: string;
}

const PROVIDER_PROBES: Record<string, ProbeSpec> = {
  ANTHROPIC: {
    path: '/models',
    header: 'x-api-key',
    extraHeaders: { 'anthropic-version': '2023-06-01' },
  },
  GEMINI: {
    path: '/models',
    queryParam: 'key',
  },
  OPENAI: { path: '/models', header: 'Authorization', prefix: 'Bearer ' },
  OPENROUTER: { path: '/models', header: 'Authorization', prefix: 'Bearer ' },
  DEEPSEEK: { path: '/models', header: 'Authorization', prefix: 'Bearer ' },
  NVIDIA: { path: '/models', header: 'Authorization', prefix: 'Bearer ' },
  VERTEX_AI: { path: '/models', note: 'auth via GCP (ADC/service account), não via API key' },
};

export interface ProviderTestResult {
  provider: string;
  label: string;
  connected: boolean;
  /** Qual env var de credencial foi efetivamente usada no teste. */
  keyEnv: string | null;
  /** HTTP status of the probe, when the provider was actually reached. */
  httpStatus?: number;
  statusText?: string;
  latencyMs: number;
  message: string;
  maskedKey: string | null;
  baseUrl: string;
  testedAt: string;
}

/**
 * Resolve the credential env var for a provider.
 * If `preferEnv` is given (and the provider declares it), that exact key is
 * used — this lets the UI test a specific ALT key. Otherwise falls through in
 * declaration order (primary first, then ALT1..ALTn).
 */
function resolveCredential(
  p: ProviderInfo,
  preferEnv?: string,
): { env: string; value: string } | null {
  if (preferEnv) {
    const value = (process.env[preferEnv] ?? '').trim();
    return value ? { env: preferEnv, value } : null;
  }
  for (const env of p.envKeys) {
    const value = (process.env[env] ?? '').trim();
    if (value) return { env, value };
  }
  return null;
}

/** Resolve the effective base URL the same way `statusOf` does. */
function baseUrlOf(p: ProviderInfo): string {
  return (p.baseUrlEnv && process.env[p.baseUrlEnv]?.trim()) || p.defaultBaseUrl;
}

/**
 * Live connection test for one catalog provider.
 * Reaches the provider directly with the configured key — never returns a
 * canned success. Failures always carry an actionable message.
 *
 * @param envKey Optional specific env var to test (e.g. GEMINI_API_KEY_ALT3).
 *               When omitted, the first configured key is used and reported.
 */
export async function testProviderConnection(
  providerId: string,
  envKey?: string,
  valueOverride?: string,
): Promise<ProviderTestResult> {
  const id = String(providerId ?? '').toUpperCase();
  const all = [...LLM_PROVIDERS, ...OTHER_PROVIDERS];
  const p = all.find((x) => x.id === id);
  const testedAt = new Date().toISOString();

  // When a specific key is requested, make sure the provider actually declares it.
  if (envKey && p && !p.envKeys.includes(envKey)) {
    return {
      provider: p.id,
      label: p.label,
      connected: false,
      keyEnv: envKey,
      latencyMs: 0,
      message: `"${envKey}" não pertence ao provedor ${p.id}. Chaves válidas: ${p.envKeys.join(', ')}.`,
      maskedKey: null,
      baseUrl: baseUrlOf(p),
      testedAt,
    };
  }

  if (!p) {
    return {
      provider: id,
      label: id,
      connected: false,
      keyEnv: null,
      latencyMs: 0,
      message: `Provedor "${id}" não existe no catálogo.`,
      maskedKey: null,
      baseUrl: '',
      testedAt,
    };
  }

  const base = baseUrlOf(p);
  // Inline value (from the UI input) takes precedence — lets the operator test a
  // freshly-pasted key before committing it to the .env.
  const inline = valueOverride && valueOverride.trim() ? { env: envKey ?? p.envKeys[0], value: valueOverride.trim() } : null;
  const cred = inline ?? resolveCredential(p, envKey);

  if (!cred) {
    return {
      provider: p.id,
      label: p.label,
      connected: false,
      keyEnv: envKey ?? null,
      latencyMs: 0,
      message: envKey
        ? `Chave "${envKey}" está vazia — defina-a no .env ou cole o valor na UI.`
        : `Chave não configurada — defina ${p.envKeys[0]} no .env.`,
      maskedKey: null,
      baseUrl: base,
      testedAt,
    };
  }

  const spec = PROVIDER_PROBES[p.id];
  if (!spec) {
    return {
      provider: p.id,
      label: p.label,
      connected: false,
      keyEnv: cred.env,
      latencyMs: 0,
      message: 'Teste ao vivo não aplicável a este serviço (categoria não-LLM).',
      maskedKey: maskSecret(cred.value),
      baseUrl: base,
      testedAt,
    };
  }

  const url = new URL(base + spec.path);
  const headers: Record<string, string> = { ...(spec.extraHeaders ?? {}) };
  if (spec.queryParam) url.searchParams.set(spec.queryParam, cred.value);
  if (spec.header) headers[spec.header] = `${spec.prefix ?? ''}${cred.value}`;

  const started = Date.now();
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });
    const latencyMs = Date.now() - started;
    const httpStatus = res.status;
    const statusText = res.statusText || undefined;

    if (res.ok) {
      return {
        provider: p.id,
        label: p.label,
        connected: true,
        keyEnv: cred.env,
        httpStatus,
        statusText,
        latencyMs,
        message: `Conexão OK via ${cred.env} (${latencyMs}ms).`,
        maskedKey: maskSecret(cred.value),
        baseUrl: base,
        testedAt,
      };
    }

    // Body is small and never contains the key we sent — safe to excerpt.
    const body = (await res.text().catch(() => '')).slice(0, 200).trim();
    const reason =
      httpStatus === 401 || httpStatus === 403
        ? 'chave recusada pelo provedor'
        : httpStatus === 429
          ? 'rate limit / cota excedida'
          : 'provedor respondeu com erro';
    return {
      provider: p.id,
      label: p.label,
      connected: false,
      keyEnv: cred.env,
      httpStatus,
      statusText,
      latencyMs,
      message: `${reason} (HTTP ${httpStatus})${body ? `: ${body}` : ''}`,
      maskedKey: maskSecret(cred.value),
      baseUrl: base,
      testedAt,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = /timeout|abort/i.test(msg);
    return {
      provider: p.id,
      label: p.label,
      connected: false,
      keyEnv: cred.env,
      latencyMs,
      message: timedOut
        ? `Timeout após 10s alcançando ${base} — verifique rede/firewall/proxy.`
        : `Falha de rede ao alcançar ${base}: ${msg}`,
      maskedKey: maskSecret(cred.value),
      baseUrl: base,
      testedAt,
    };
  }
}


function statusOf(p: ProviderInfo): ProviderStatus {
  const keysPresent: string[] = [];
  const keysMasked: Record<string, string> = {};
  for (const k of p.envKeys) {
    const v = (process.env[k] ?? '').trim();
    if (v) {
      keysPresent.push(k);
      keysMasked[k] = maskSecret(v);
    }
  }
  const baseUrl = (p.baseUrlEnv && process.env[p.baseUrlEnv]?.trim()) || p.defaultBaseUrl;
  return { ...p, configured: keysPresent.length > 0, keysPresent, keysMasked, baseUrl };
}

export function listProviders(): { llm: ProviderStatus[]; other: ProviderStatus[]; models: typeof LLM_MODELS; targets: typeof ROUTE_TARGETS } {
  return {
    llm: LLM_PROVIDERS.map(statusOf),
    other: OTHER_PROVIDERS.map(statusOf),
    models: LLM_MODELS,
    targets: ROUTE_TARGETS,
  };
}

export interface CenterState {
  llm: ProviderStatus[];
  other: ProviderStatus[];
  models: typeof LLM_MODELS;
  targets: typeof ROUTE_TARGETS;
  routing: RoutingState;
  spend: SpendSummary;
  envCoverage: { totalKeys: number; configured: number; missing: string[] };
  publicIp: string;
}

function envCoverage(llm: ProviderStatus[], other: ProviderStatus[]): CenterState['envCoverage'] {
  const all = [...llm, ...other];
  const keys = new Set<string>();
  let configured = 0;
  const missing: string[] = [];
  for (const p of all) {
    for (const k of p.envKeys) {
      if (keys.has(k)) continue;
      keys.add(k);
      const v = (process.env[k] ?? '').trim();
      // TELEGRAM_ALLOWED_CHAT_ID é ID, não segredo — conta como configurado mas nunca é segredo
      if (v) configured++;
      else missing.push(k);
    }
  }
  return { totalKeys: keys.size, configured, missing };
}

/** Best-effort public egress IP (used to guide IP-allowlist setup). Never throws. */
async function publicIp(): Promise<string> {
  for (const url of ['https://api.ipify.org?format=text', 'https://ifconfig.me/ip']) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const ip = (await res.text()).trim();
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || /^[0-9a-f:]+$/i.test(ip)) return ip;
      }
    } catch { /* try next */ }
  }
  return 'indisponível';
}
export interface SpendByModel { spend: number; tokens: number }

export interface SpendSummary {
  byModel: Record<string, SpendByModel>;
  byProvider: Record<string, SpendByModel>;
  totalSpend: number;
  totalTokens: number;
  note: string;
}
export async function spendSummary(): Promise<SpendSummary> {
  const byModel: Record<string, SpendByModel> = {};
  const byProvider: Record<string, SpendByModel> = {};
  let totalSpend = 0;
  let totalTokens = 0;
  let note = '';
  const key = LITELLM_KEY();
  if (!key) return { byModel, byProvider, totalSpend, totalTokens, note: 'LITELLM_MASTER_KEY ausente — sem leitura de gastos.' };
  try {
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const res = await fetch(`${LITELLM_BASE()}/spend/logs?start_date=${since}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      note = `LiteLLM /spend/logs respondeu HTTP ${res.status} — gastos zerados nesta visão.`;
      return { byModel, byProvider, totalSpend, totalTokens, note };
    }
    const body = (await res.json()) as unknown;
    const items: Array<Record<string, unknown>> = Array.isArray(body)
      ? (body as Array<Record<string, unknown>>)
      : ((body as Record<string, unknown>)?.['logs'] as Array<Record<string, unknown>>) ?? [];
    for (const it of items) {
      const model = String(it['model'] ?? it['model_id'] ?? 'unknown');
      const spend = Number(it['spend'] ?? it['total_cost'] ?? 0) || 0;
      const tokens = Number((it['usage'] as Record<string, unknown> | undefined)?.['total_tokens'] ?? it['total_tokens'] ?? 0) || 0;
      const cur = byModel[model] ?? { spend: 0, tokens: 0 };
      cur.spend += spend;
      cur.tokens += tokens;
      byModel[model] = cur;
      totalSpend += spend;
      totalTokens += tokens;
      // Provider: prefer explicit path prefix, else resolve via the logical model catalog
      const catalogHit = LLM_MODELS.find((m) => m.id === model);
      const prov = model.includes('/') ? model.split('/')[0] : (catalogHit?.provider ?? 'other');
      const pc = byProvider[prov] ?? { spend: 0, tokens: 0 };
      pc.spend += spend;
      pc.tokens += tokens;
      byProvider[prov] = pc;
    }
    note = `${items.length} registro(s) de gasto (30d) via LiteLLM.`;
  } catch (err) {
    note = `Falha ao ler gastos do LiteLLM: ${(err as Error).message}`;
  }
  return { byModel, byProvider, totalSpend, totalTokens, note };
}

export async function getCenterState(): Promise<CenterState> {
  const [base, routing, spend, ip] = await Promise.all([
    Promise.resolve(listProviders()),
    loadRouting(),
    spendSummary(),
    publicIp(),
  ]);
  return { ...base, routing, spend, envCoverage: envCoverage(base.llm, base.other), publicIp: ip };
}

export async function updateRouting(patch: Partial<RoutingState>): Promise<RoutingState> {
  return saveRouting(patch);
}
