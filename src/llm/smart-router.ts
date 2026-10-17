/**
 * smart-router — coordenação inteligente de LLMs por custo/benefício.
 *
 * Objetivo: usar a LLM CERTA para cada função, com o MENOR custo possível:
 *   • Tarefas PRIMÁRIAS/críticas (orquestrador, coder, security, pentest)
 *     → modelo pago de maior qualidade (fallback garantido).
 *   • Tarefas SECUNDÁRIAS (QA, integrator, pipelines, telegram)
 *     → delega a LLMs GRATUITAS/baratas (OmniRoute, free tiers).
 *
 * A decisão combina 3 sinais:
 *   1. Criticidade do alvo (ROUTE_TARGETS kind + tier de custo do modelo).
 *   2. Histórico de benchmark LOCAL (data/llm-benchmark.json) — latência,
 *      taxa de sucesso e custo acumulado por modelo, aprendidos a cada chamada.
 *   3. Disponibilidade (só considera modelos cujo provider está configurado).
 *
 * O LiteLLM pode estar fora do ar; por isso o histórico vive localmente e o
 * router degrada com graça: sem dados, escolhe pelo custo declarado; com dados,
 * rankeia por score = sucesso × 1 / (latência × custo-relativo).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LLM_MODELS, ROUTE_TARGETS, type LlmModelOption } from './models.js';

const DIR = join(process.cwd(), 'data');
const FILE = join(DIR, 'llm-benchmark.json');

/** Peso relativo de custo por tier (menor = mais barato). 'free' é o mínimo. */
const COST_WEIGHT: Record<LlmModelOption['costTier'], number> = {
  free: 1,
  $: 3,
  $$: 8,
  $$$: 20,
};

export interface ModelBenchmark {
  /** Amostras observadas (chamadas registradas). */
  calls: number;
  success: number;
  failures: number;
  /** Latência média em ms (média móvel). */
  avgLatencyMs: number;
  /** Custo acumulado em USD (0 para modelos free). */
  totalSpend: number;
  updatedAt: string;
}

export interface BenchmarkStore {
  models: Record<string, ModelBenchmark>;
}

async function loadStore(): Promise<BenchmarkStore> {
  try {
    const raw = await readFile(FILE, 'utf-8');
    const parsed = JSON.parse(raw) as BenchmarkStore;
    return { models: parsed.models ?? {} };
  } catch {
    return { models: {} };
  }
}

async function saveStore(store: BenchmarkStore): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(store, null, 2));
}

/**
 * Registra o resultado de uma chamada real para aprender o benchmark.
 * Chamado pelo orquestrador após cada inferência (sucesso ou falha).
 */
export async function recordBenchmark(
  modelId: string,
  opts: { success: boolean; latencyMs: number; costUsd?: number },
): Promise<void> {
  const store = await loadStore();
  const prev = store.models[modelId] ?? {
    calls: 0,
    success: 0,
    failures: 0,
    avgLatencyMs: 0,
    totalSpend: 0,
    updatedAt: new Date().toISOString(),
  };
  const calls = prev.calls + 1;
  // Média móvel exponencial (α=0.3) para reagir a mudanças sem descartar histórico.
  const alpha = 0.3;
  const avgLatencyMs = prev.avgLatencyMs === 0
    ? opts.latencyMs
    : Math.round(alpha * opts.latencyMs + (1 - alpha) * prev.avgLatencyMs);
  const success = prev.success + (opts.success ? 1 : 0);
  const failures = prev.failures + (opts.success ? 0 : 1);
  store.models[modelId] = {
    calls,
    success,
    failures,
    avgLatencyMs,
    totalSpend: prev.totalSpend + (opts.costUsd ?? 0),
    updatedAt: new Date().toISOString(),
  };
  await saveStore(store);
}

export interface RouteDecision {
  targetId: string;
  modelId: string;
  /** Por que este modelo foi escolhido (exibido na UI / logs). */
  reason: string;
  /** true quando a tarefa foi delegada a um modelo gratuito. */
  delegatedFree: boolean;
  /** Score de confiança 0..1 (baseado no histórico; 0.5 sem dados). */
  confidence: number;
  /** Todos os candidatos rankeados (debug/auditoria). */
  candidates: Array<{ modelId: string; score: number; free: boolean; configured: boolean }>;
}

/** Score de qualidade do benchmark (0..1). Sem dados → neutro (0.5). */
function benchmarkScore(b: ModelBenchmark | undefined): number {
  if (!b || b.calls === 0) return 0.5;
  const successRate = b.success / b.calls;
  // Penaliza latência alta: normaliza por 4000ms como "lento demais".
  const latencyPenalty = 1 / (1 + b.avgLatencyMs / 4000);
  return successRate * latencyPenalty;
}

/** Indica se o provider de um modelo está configurado (tem chave no env). */
function isProviderConfigured(model: LlmModelOption, configuredProviders: Set<string>): boolean {
  return configuredProviders.has(model.provider);
}

/**
 * Decide o melhor modelo para um alvo, considerando criticidade, benchmark
 * local e disponibilidade. Em modo 'auto' a decisão é inteligente; em 'manual'
 * o override humano sempre vence.
 *
 * @param configuredProviders Set de ids de provider que têm chave configurada.
 *                            Se omitido, todos são considerados disponíveis
 *                            (útil quando a checagem é cara ou irrelevante).
 */
export async function routeIntelligently(
  targetId: string,
  opts: { mode?: 'auto' | 'manual'; override?: string; configuredProviders?: Set<string> } = {},
): Promise<RouteDecision> {
  const target = ROUTE_TARGETS.find((t) => t.id === targetId);
  const mode = opts.mode ?? 'auto';

  // Override manual tem precedência absoluta.
  if (mode === 'manual' && opts.override) {
    return {
      targetId,
      modelId: opts.override,
      reason: 'Roteamento manual (override humano).',
      delegatedFree: LLM_MODELS.find((m) => m.id === opts.override)?.free ?? false,
      confidence: 1,
      candidates: [],
    };
  }

  const store = await loadStore();
  const configured = opts.configuredProviders;

  // Criticidade: alvos primários exigem qualidade; secundários priorizam custo.
  const isPrimary = ['orchestrator', 'coder', 'security', 'pentest'].includes(targetId);

  // Disponibilidade (sinal 3): só modelos cujo provider tem chave no env.
  let pool = LLM_MODELS.filter((m) => !configured || isProviderConfigured(m, configured));
  // Tarefa crítica: exige modelo PAGO quando existe pago configurado — o
  // benchmark decide entre eles. Free só entra como último recurso (nenhum
  // pago disponível). Sem esta regra, o custo baixo do free (COST_WEIGHT 1 ×
  // penalidade 2.5) vencia o pago mesmo sem histórico, violando a política
  // "crítico → pago".
  if (isPrimary && pool.some((m) => !m.free)) pool = pool.filter((m) => !m.free);

  // Pontuação composta: qualidade_do_benchmark / (peso_de_custo).
  // Tarefas secundárias recebem BÔNUS em modelos free (multiplicador < 1 no
  // custo), empurrando a delegação para LLMs gratuitas.
  const candidates = pool
    .map((m) => {
      const bench = benchmarkScore(store.models[m.id]);
      const cost = COST_WEIGHT[m.costTier];
      // Bônus de delegação: free conta 0.4× o custo quando a tarefa é secundária.
      const effectiveCost = (!isPrimary && m.free) ? cost * 0.4 : cost;
      // Tarefa primária penaliza modelos free (qualidade incerta para crítico).
      const primaryPenalty = isPrimary && m.free ? 2.5 : 1;
      const score = (bench * 100) / (effectiveCost * primaryPenalty);
      return { modelId: m.id, score, free: m.free, configured: !configured || isProviderConfigured(m, configured) };
    })
    .sort((a, b) => b.score - a.score);

  const winner = candidates[0];
  const chosen = LLM_MODELS.find((m) => m.id === winner?.modelId);
  const bench = store.models[winner?.modelId ?? ''];

  // Razão legível.
  let reason: string;
  if (!winner) {
    reason = 'Nenhum modelo disponível (nenhum provider configurado).';
  } else if (isPrimary && chosen?.free) {
    reason = `Tarefa crítica sem pago configurado — usando gratuito ${chosen.id}.`;
  } else if (!isPrimary && chosen?.free) {
    reason = `Tarefa secundária delegada a LLM gratuita (${chosen.id}) — custo zero.`;
  } else if (bench && bench.calls > 0) {
    reason = `Melhor score custo/benefício: ${winner.modelId} (sucesso ${(bench.success / bench.calls * 100).toFixed(0)}%, latência ${bench.avgLatencyMs}ms).`;
  } else {
    reason = `Melhor custo/benefício sem histórico: ${winner.modelId} (tier ${chosen?.costTier}).`;
  }

  return {
    targetId,
    modelId: winner?.modelId ?? opts.override ?? target?.defaultModel ?? 'deepseek-code',
    reason,
    delegatedFree: chosen?.free ?? false,
    confidence: bench && bench.calls > 0 ? benchmarkScore(bench) : 0.5,
    candidates: candidates.slice(0, 8),
  };
}

/** Visão do benchmark para a UI (mais usados primeiro). */
export async function benchmarkRanking(): Promise<Array<ModelBenchmark & { modelId: string }>> {
  const store = await loadStore();
  return Object.entries(store.models)
    .map(([modelId, b]) => ({ modelId, ...b }))
    .sort((a, b) => b.calls - a.calls);
}
