/**
 * gateway-singleton — instância única do GatewayClient + virtual keys por módulo.
 *
 * Evita cada módulo (orquestrador, researcher, …) criar sua própria conexão e
 * key. A virtual key é criada sob demanda com alias único e cacheada em memória
 * (por processo — zera no restart do dev server).
 */
import { GatewayClient } from './gateway-client.js';

let client: GatewayClient | null = null;
const keys = new Map<string, string>();

export function getGateway(): GatewayClient {
  if (!client) {
    const baseUrl = process.env.LITELLM_BASE_URL || 'http://localhost:4000';
    const masterKey = process.env.LITELLM_MASTER_KEY || 'sk-hermes-master';
    client = new GatewayClient(baseUrl, masterKey);
  }
  return client;
}

/** Virtual key cacheada por alias (orçamento configurável via env). */
export async function getVirtualKey(alias: string): Promise<string> {
  const cached = keys.get(alias);
  if (cached) return cached;
  const budget = Number(process.env.HERMES_VIRTUAL_KEY_BUDGET_USD || 20);
  const key = await getGateway().createVirtualKey({
    alias: `hermes-${alias}-${Math.random().toString(36).slice(2, 6)}`,
    models: ['*'],
    maxBudgetUsd: Number.isFinite(budget) && budget > 0 ? budget : 20,
    // sem `tags`: recurso Enterprise-only no LiteLLM (403 sem licença)
  });
  keys.set(alias, key);
  return key;
}
