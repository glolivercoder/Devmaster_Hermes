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
