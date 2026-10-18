/**
 * agent-feed — Painel "Show Agents" (aba 🏢 Paperclip & Office).
 *
 * O PaperclipAdapter antigo era SEMENTE ESTÁTICA (7 agentes fake, sem rotas).
 * Este módulo mostra os agentes REAIS do Hermes em ação, consumindo o event bus:
 *
 *   agent:task:started|completed|failed → status WORKING/IDLE por agentId
 *   llm:request|response                → LLM Gateway (pendências + tokens/custo)
 *   research:*                          → Agente Pesquisador
 *   telegram:*                          → Telegram Bridge
 *   security:*                          → Security Scanner
 *   deploy:*                            → Deploy Agent
 *   mcp:*                               → ProcessAgent / Registry
 *   system:ready                        → registro do boot
 *
 * Quem publica agent:task:* com um agentId novo vira agente dinâmico no painel
 * (ex.: hermes-orchestrator, hermes-codemap, subagent-composio).
 */
import { eventBus } from '../core/event-bus.js';

export type LiveStatus = 'WORKING' | 'IDLE';

export interface LiveAgent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  status: LiveStatus;
  currentTask?: string;
  model?: string;
  lastEventAt?: string;
  events: number;
  tokensUsed: number;
  costUsd: number;
  /** true = o agente está definido por eventos reais (não é catálogo estático) */
  dynamic?: boolean;
}

export interface FeedItem {
  ts: string;
  agentId: string;
  agentName: string;
  event: string;
  detail: string;
  level: 'info' | 'ok' | 'warn' | 'error';
  /** Agente de origem/destino da interação (p/ a animação do escritório virtual). */
  from?: string;
  to?: string;
}

/** Catálogo de agentes conhecidos (nome/emoji/papel) — atividade vem dos eventos. */
const CATALOG: Record<string, Pick<LiveAgent, 'name' | 'emoji' | 'role'>> = {
  'hermes-orchestrator': { name: 'Hermes Orchestrator (CEO)', emoji: '🧠', role: 'Orquestra runs, contexto e capacidades' },
  'hermes-codemap': { name: 'Archify Code Mapper', emoji: '🗺', role: 'Gera o mapa de arquitetura do código' },
  'hermes-researcher': { name: 'Agente Pesquisador', emoji: '🔎', role: 'Scraping + search APIs' },
  'hermes-market': { name: 'Analista de Mercado', emoji: '📊', role: 'Concorrentes, dores e veredito' },
  'hermes-llm': { name: 'LLM Gateway (LiteLLM)', emoji: '⚡', role: 'Roteia chamadas aos provedores' },
  'hermes-process-agent': { name: 'ProcessAgent', emoji: '🖥', role: 'Monitora processos e portas' },
  'hermes-version-agent': { name: 'Agente de Versionamento', emoji: '📦', role: 'Save point + push Gitea/GitHub' },
  'hermes-n8n': { name: 'Agente N8N', emoji: '🤖', role: 'Workflows e automações' },
  'hermes-security': { name: 'Security Scanner', emoji: '🛡', role: 'Scan de segredos e vulnerabilidades' },
  'hermes-deploy': { name: 'Deploy Agent', emoji: '🚀', role: 'Comandos de deploy com tiers' },
  'hermes-telegram': { name: 'Telegram Bridge', emoji: '✈️', role: 'Fila de prompts do bot' },
  'subagent-composio': { name: 'Composio Integrator', emoji: '🔌', role: 'Integrações (GitHub, Slack…)' },
  'hermes-computer-use': { name: 'Computer Use', emoji: '🖱', role: 'Uso do computador' },
  'hermes-guardian': { name: 'Process Guardian', emoji: '🔒', role: 'Proteção de núcleo e permissões' },
};

const FEED_MAX = 120;

class AgentFeed {
  private inited = false;
  private readonly agents = new Map<string, LiveAgent>();
  private feed: FeedItem[] = [];
  private pendingLlm = 0;
  /** Último agente que começou uma tarefa (p/ atribuir chamadas de LLM na animação). */
  private lastWorker = 'hermes-orchestrator';
  private readonly startedAt = Date.now();
  private counters = { events: 0, tokens: 0, costUsd: 0, runs: 0 };

  /** Assina o event bus (idempotente). */
  init(): void {
    if (this.inited) return;
    this.inited = true;

    // Semeia o catálogo como IDLE (aparece no painel mesmo antes da 1ª atividade).
    for (const [id, meta] of Object.entries(CATALOG)) {
      this.agents.set(id, { id, ...meta, status: 'IDLE', events: 0, tokensUsed: 0, costUsd: 0 });
    }

    eventBus.subscribe('agent:task:started', (p) => {
      const a = this.ensure(p.agentId);
      a.status = 'WORKING';
      a.currentTask = p.description;
      if (p.agentId !== 'hermes-llm') this.lastWorker = p.agentId;
      this.counters.runs++;
      // CEO delega (ou o próprio agente inicia sem passar pelo CEO).
      this.push(a, `▶ tarefa iniciada (${p.taskId}) — ${p.description}`, 'info',
        { from: p.agentId === 'hermes-orchestrator' ? undefined : 'hermes-orchestrator', to: p.agentId });
    });

    eventBus.subscribe('agent:task:completed', (p) => {
      const a = this.ensure(p.agentId);
      a.status = 'IDLE';
      a.currentTask = undefined;
      if (this.lastWorker === p.agentId) this.lastWorker = 'hermes-orchestrator';
      // Reporte de volta ao CEO (sem auto-loop quando o CEO é o executor).
      this.push(a, `✔ concluída em ${(p.durationMs / 1000).toFixed(1)}s (${p.taskId})`, 'ok',
        { from: p.agentId, to: p.agentId === 'hermes-orchestrator' ? undefined : 'hermes-orchestrator' });
    });

    eventBus.subscribe('agent:task:failed', (p) => {
      const a = this.ensure(p.agentId);
      a.status = 'IDLE';
      a.currentTask = undefined;
      if (this.lastWorker === p.agentId) this.lastWorker = 'hermes-orchestrator';
      this.push(a, `✖ FALHOU (${p.taskId}): ${p.error}`, 'error',
        { from: p.agentId, to: p.agentId === 'hermes-orchestrator' ? undefined : 'hermes-orchestrator' });
    });

    eventBus.subscribe('llm:request', (p) => {
      const a = this.ensure('hermes-llm');
      a.status = 'WORKING';
      this.pendingLlm++;
      // Interação: quem pediu → LLM Gateway.
      this.push(a, `→ ${p.model} · ~${Math.round(p.estimatedTokens)} tokens estimados`, 'info',
        { from: this.lastWorker, to: 'hermes-llm' });
    });

    eventBus.subscribe('llm:response', (p) => {
      const a = this.ensure('hermes-llm');
      this.pendingLlm = Math.max(0, this.pendingLlm - 1);
      if (this.pendingLlm === 0) a.status = 'IDLE';
      a.tokensUsed += p.tokensUsed || 0;
      a.costUsd += p.costUsd || 0;
      this.counters.tokens += p.tokensUsed || 0;
      this.counters.costUsd += p.costUsd || 0;
      // Resposta volta p/ o agente que fez a chamada.
      this.push(a, `← ${p.model} · ${p.tokensUsed} tokens${p.costUsd ? ` · $${p.costUsd.toFixed(4)}` : ''}`, 'ok',
        { from: 'hermes-llm', to: this.lastWorker });
    });

    eventBus.subscribe('research:started', (p) => {
      const a = this.ensure('hermes-researcher');
      a.status = 'WORKING';
      a.currentTask = p.query;
      this.push(a, `🔎 pesquisando: ${p.query}`, 'info',
        { from: 'hermes-orchestrator', to: 'hermes-researcher' });
    });

    eventBus.subscribe('research:completed', (p) => {
      const a = this.ensure('hermes-researcher');
      a.status = 'IDLE';
      a.currentTask = undefined;
      this.push(a, `🔎 pesquisa concluída via ${p.model}: ${p.query}`, 'ok',
        { from: 'hermes-researcher', to: 'hermes-orchestrator' });
    });

    eventBus.subscribe('telegram:message:in', (p) => {
      this.push(this.ensure('hermes-telegram'), `📩 mensagem recebida (chat ${p.chatId}): ${p.text.slice(0, 80)}`, 'info',
        { from: 'hermes-telegram', to: 'hermes-orchestrator' });
    });

    eventBus.subscribe('telegram:queue:enqueue', (p) => {
      const a = this.ensure('hermes-telegram');
      a.status = 'WORKING';
      this.push(a, `📥 prompt enfileirado (${p.promptId}): ${p.text.slice(0, 80)}`, 'info',
        { from: 'hermes-telegram', to: 'hermes-orchestrator' });
    });

    eventBus.subscribe('telegram:queue:dequeue', (p) => {
      this.push(this.ensure('hermes-telegram'), `📤 prompt em processamento (${p.promptId})`, 'ok',
        { from: 'hermes-telegram', to: 'hermes-orchestrator' });
    });

    eventBus.subscribe('security:scan:started', (p) => {
      const a = this.ensure('hermes-security');
      a.status = 'WORKING';
      a.currentTask = `${p.module} (${p.tool})`;
      this.push(a, `🛡 scan iniciado em ${p.module} via ${p.tool}`, 'info',
        { from: 'hermes-orchestrator', to: 'hermes-security' });
    });

    eventBus.subscribe('security:scan:completed', (p) => {
      const a = this.ensure('hermes-security');
      a.status = 'IDLE';
      a.currentTask = undefined;
      this.push(a, `🛡 scan concluído em ${p.module}: ${p.findings} achado(s)`, p.findings ? 'warn' : 'ok',
        { from: 'hermes-security', to: 'hermes-orchestrator' });
    });

    eventBus.subscribe('security:secret:found', (p) => {
      this.push(this.ensure('hermes-security'), `🚨 segredo exposto: ${p.secretType} em ${p.file}:${p.line}`, 'error',
        { from: 'hermes-security', to: 'hermes-orchestrator' });
    });

    eventBus.subscribe('deploy:command:executed', (p) => {
      this.push(this.ensure('hermes-deploy'), `🚀 ${p.command} [${p.tier}] → exit ${p.exitCode}`, p.exitCode ? 'warn' : 'ok',
        { from: 'hermes-orchestrator', to: 'hermes-deploy' });
    });

    eventBus.subscribe('deploy:command:denied', (p) => {
      this.push(this.ensure('hermes-deploy'), `⛔ deploy negado: ${p.command} — ${p.reason}`, 'warn',
        { from: 'hermes-deploy', to: 'hermes-orchestrator' });
    });

    eventBus.subscribe('mcp:started', (p) => {
      this.push(this.ensure('hermes-process-agent'), `🔌 MCP ${p.id} iniciado (pid ${p.pid}${p.port ? `, porta ${p.port}` : ''})`, 'ok',
        { from: 'hermes-process-agent', to: 'hermes-orchestrator' });
    });

    eventBus.subscribe('mcp:stopped', (p) => {
      this.push(this.ensure('hermes-process-agent'), `🔌 MCP ${p.id} parado — ${p.reason}`, 'warn',
        { from: 'hermes-process-agent', to: 'hermes-orchestrator' });
    });

    eventBus.subscribe('mcp:conflict', (p) => {
      this.push(this.ensure('hermes-guardian'), `⚠️ conflito de porta ${p.port}: ${p.id} vs pid ${p.existingPid} (${p.level})`, 'warn',
        { from: 'hermes-guardian', to: 'hermes-orchestrator' });
    });

    eventBus.subscribe('system:ready', () => {
      this.push(this.ensure('hermes-orchestrator'), '🟢 Hermes core online', 'ok');
    });

    console.log('[agent-feed] Show Agents conectado ao event bus');
  }

  /** Garante o agente (catálogo ou dinâmico) e atualiza lastEventAt. */
  private ensure(agentId: string): LiveAgent {
    let a = this.agents.get(agentId);
    if (!a) {
      const meta = CATALOG[agentId];
      a = {
        id: agentId,
        name: meta?.name ?? agentId,
        emoji: meta?.emoji ?? '🤖',
        role: meta?.role ?? 'Agente detectado por eventos',
        status: 'IDLE',
        events: 0,
        tokensUsed: 0,
        costUsd: 0,
        dynamic: true,
      };
      this.agents.set(agentId, a);
    }
    return a;
  }

  private push(a: LiveAgent, detail: string, level: FeedItem['level'], link?: { from?: string; to?: string }): void {
    const ts = new Date().toISOString();
    a.events++;
    a.lastEventAt = ts;
    this.counters.events++;
    this.feed.push({
      ts, agentId: a.id, agentName: `${a.emoji} ${a.name}`, event: level, detail, level,
      from: link?.from, to: link?.to ?? a.id,
    });
    if (this.feed.length > FEED_MAX) this.feed.splice(0, this.feed.length - FEED_MAX);
  }

  /** Snapshot p/ o painel (agentes + feed + estatísticas). */
  snapshot(sinceMs?: number): {
    agents: LiveAgent[];
    feed: FeedItem[];
    stats: Record<string, unknown>;
    serverTime: string;
  } {
    const since = sinceMs && sinceMs > 0 ? sinceMs : 0;
    return {
      agents: Array.from(this.agents.values())
        .sort((a, b) => (a.status === 'WORKING' ? 0 : 1) - (b.status === 'WORKING' ? 0 : 1) || a.name.localeCompare(b.name)),
      feed: since ? this.feed.filter((f) => Date.parse(f.ts) > since) : this.feed,
      stats: {
        working: Array.from(this.agents.values()).filter((a) => a.status === 'WORKING').length,
        total: this.agents.size,
        events: this.counters.events,
        runs: this.counters.runs,
        tokens: this.counters.tokens,
        costUsd: Number(this.counters.costUsd.toFixed(4)),
        pendingLlm: this.pendingLlm,
        uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      },
      serverTime: new Date().toISOString(),
    };
  }
}

export const agentFeed = new AgentFeed();

/** Chamada no boot (src/index.ts) — assina o event bus. */
export function initAgentFeed(): void {
  agentFeed.init();
}
