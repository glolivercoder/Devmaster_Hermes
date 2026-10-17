import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROUTE_TARGETS } from './models.js';
import { routeIntelligently } from './smart-router.js';
import { LLM_PROVIDERS } from './providers-llm.js';

/**
 * Providers com pelo menos uma chave presente no ambiente — sinal de
 * disponibilidade repassado ao smart-router (sem isso, o router considerava
 * até providers sem chave como candidatos e podia rotear para provider morto).
 */
function configuredProviderIds(): Set<string> {
  const set = new Set<string>();
  for (const p of LLM_PROVIDERS) {
    if (p.envKeys.some((k) => (process.env[k] ?? '').trim())) set.add(p.id);
  }
  return set;
}

export interface RoutingState {
  mode: 'auto' | 'manual';
  routes: Record<string, string>;
  freeOnly: boolean;
  updatedAt: string;
}

const DIR = join(process.cwd(), 'data');
const FILE = join(DIR, 'llm-routing.json');

export function defaultRouting(): RoutingState {
  const routes: Record<string, string> = {};
  for (const t of ROUTE_TARGETS) routes[t.id] = t.defaultModel;
  return { mode: 'auto', routes, freeOnly: false, updatedAt: new Date().toISOString() };
}

export async function loadRouting(): Promise<RoutingState> {
  try {
    const raw = await readFile(FILE, 'utf-8');
    const parsed = JSON.parse(raw) as RoutingState;
    const base = defaultRouting();
    return { ...base, ...parsed, routes: { ...base.routes, ...(parsed.routes ?? {}) } };
  } catch {
    return defaultRouting();
  }
}

export async function saveRouting(next: Partial<RoutingState>): Promise<RoutingState> {
  const cur = await loadRouting();
  const merged: RoutingState = {
    mode: next.mode ?? cur.mode,
    routes: { ...cur.routes, ...(next.routes ?? {}) },
    freeOnly: next.freeOnly ?? cur.freeOnly,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(merged, null, 2));
  return merged;
}

/**
 * Resolve which logical model serves a target.
 *
 * Em modo 'manual' o override humano vence incondicionalmente.
 * Em modo 'auto' a decisão é inteligente (smart-router): combina criticidade
 * da tarefa, benchmark local histórico e disponibilidade do provider para
 * escolher o melhor custo/benefício — delegando tarefas secundárias a LLMs
 * gratuitas (ex.: OmniRoute) e reservando modelos pagos para o que é crítico.
 */
export async function resolveModel(targetId: string): Promise<string> {
  const st = await loadRouting();
  if (st.mode === 'manual') return st.routes[targetId] ?? 'deepseek-code';
  const decision = await routeIntelligently(targetId, {
    mode: 'auto',
    override: st.routes[targetId],
    configuredProviders: configuredProviderIds(),
  });
  return decision.modelId;
}

/** Explica o PORQUÊ de uma escolha de modelo (para UI/logs de auditoria). */
export async function explainModel(targetId: string) {
  const st = await loadRouting();
  return routeIntelligently(targetId, {
    mode: st.mode,
    override: st.routes[targetId],
    configuredProviders: configuredProviderIds(),
  });
}
