/**
 * Hermes Control Center — LiteLLM Gateway Client
 * Module 01: AI Gateway
 *
 * Thin client that talks to the self-hosted LiteLLM proxy.
 * Every call uses a virtual key — real provider keys never leave the gateway.
 */

import { eventBus } from '../core/event-bus.js';
import { recordBenchmark } from '../llm/smart-router.js';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface CompletionRequest {
  model: string;           // logical model name from litellm-config.yaml
  messages: { role: 'user' | 'assistant' | 'system'; content: string | ContentPart[] }[];
  virtualKey: string;      // sk-virtual-xxx (module-scoped virtual key)
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResponse {
  content: string;
  model: string;
  tokensUsed: number;
  costUsd: number;
}

export interface VirtualKeyInfo {
  key: string;
  spend: number;
  maxBudget: number | null;
  models: string[];
  tags: string[];
}

export class GatewayClient {
  private readonly baseUrl: string;
  private readonly masterKey: string;

  constructor(baseUrl = 'http://localhost:4000', masterKey: string) {
    this.baseUrl = baseUrl;
    this.masterKey = masterKey;
  }

  /** Chat completion via virtual key — logs cost to event bus. */
  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const started = Date.now();
    eventBus.publish('llm:request', {
      model: req.model,
      estimatedTokens: req.messages.reduce((acc, m) =>
        acc + (typeof m.content === 'string' ? m.content.length / 4 : 800), 0), // imagem ≈ 800 tok
    });

    // Resposta VAZIA com HTTP 200 já aconteceu (provedor devolve content: null):
    // virava reply em branco na UI e quebrava o salvamento do run (null.slice).
    // Agora: 1 retry automático e, se persistir, erro CLARO p/ o chamador.
    const MAX_TRIES = 2;
    let lastShape = '';
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${req.virtualKey}`,
        },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          max_tokens: req.maxTokens ?? 4096,
          temperature: req.temperature ?? 0.2,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        // Alimenta o benchmark local com a falha para o smart-router aprender.
        void recordBenchmark(req.model, {
          success: false,
          latencyMs: Date.now() - started,
        }).catch(() => {});
        throw new Error(`LiteLLM [${res.status}]: ${err}`);
      }

      const data = await res.json() as {
        choices?: { message?: { content?: string | null } }[];
        model?: string;
        usage?: { total_tokens: number };
        _hidden_params?: { response_cost?: number };
      };

      const content = data.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim().length > 0) {
        const tokensUsed = data.usage?.total_tokens ?? 0;
        const costUsd    = data._hidden_params?.response_cost ?? 0;
        const model      = data.model || req.model;

        // Registra sucesso no benchmark: aprende latência e custo reais por modelo,
        // permitindo que o smart-router reavalie custo/benefício continuamente.
        void recordBenchmark(req.model, {
          success: true,
          latencyMs: Date.now() - started,
          costUsd,
        }).catch(() => {});

        eventBus.publish('llm:response', {
          model,
          tokensUsed,
          costUsd,
        });

        return { content, model, tokensUsed, costUsd };
      }

      // Vazio: conta como falha no benchmark e re-tenta 1x antes de desistir.
      lastShape = `choices=${data.choices?.length ?? 0}`;
      void recordBenchmark(req.model, {
        success: false,
        latencyMs: Date.now() - started,
      }).catch(() => {});
      console.warn(`[gateway] resposta VAZIA do modelo ${req.model} (tentativa ${attempt}/${MAX_TRIES}, ${lastShape}) — re-tentando`);
    }

    throw new Error(
      `LiteLLM devolveu RESPOSTA VAZIA após ${MAX_TRIES} tentativas (model=${req.model}, ${lastShape}) — ` +
      'o provedor aceitou a chamada mas não retornou conteúdo.'
    );
  }

  /** Create a virtual key scoped to a module or agent. */
  async createVirtualKey(opts: {
    alias: string;
    models: string[];
    maxBudgetUsd?: number;
    tags?: string[];
  }): Promise<string> {
    const res = await fetch(`${this.baseUrl}/key/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.masterKey}`,
      },
      body: JSON.stringify({
        key_alias: opts.alias,
        models: opts.models,
        max_budget: opts.maxBudgetUsd ?? null,
        tags: opts.tags ?? [],
      }),
    });

    if (!res.ok) throw new Error(`createVirtualKey failed [${res.status}]`);
    const data = await res.json() as { key: string };
    return data.key;
  }

  /** Fetch current spend and limits for a virtual key. */
  async keyInfo(virtualKey: string): Promise<VirtualKeyInfo> {
    const res = await fetch(`${this.baseUrl}/key/info?key=${virtualKey}`, {
      headers: { 'Authorization': `Bearer ${this.masterKey}` },
    });
    if (!res.ok) throw new Error(`keyInfo failed [${res.status}]`);
    const data = await res.json() as {
      info: {
        key: string;
        spend: number;
        max_budget: number | null;
        models: string[];
        metadata?: { tags?: string[] };
      };
    };
    return {
      key: data.info.key,
      spend: data.info.spend,
      maxBudget: data.info.max_budget,
      models: data.info.models,
      tags: data.info.metadata?.tags ?? [],
    };
  }

  /** Health check — resolves true if gateway is reachable. */
  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }
}
