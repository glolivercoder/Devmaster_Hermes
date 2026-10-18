/**
 * Hermes Control Center — Core Event Bus
 * Module 00: Foundation
 *
 * Central publish/subscribe event bus using Node.js EventEmitter.
 * All modules communicate ONLY through this bus — never direct coupling.
 */

import { EventEmitter } from 'node:events';
import { AuditLogger } from './audit-logger.js';

// ─── Event Catalog ─────────────────────────────────────────────────────────
export type HermesEventMap = {
  // MCP / Process lifecycle
  'mcp:started':    [{ id: string; pid: number; port: number | null }];
  'mcp:stopped':    [{ id: string; pid: number; reason: string }];
  'mcp:conflict':   [{ id: string; port: number; existingPid: number; level: 'LOW' | 'MEDIUM' | 'HIGH' }];
  'mcp:permission': [{ id: string; port: number; action: 'start' | 'stop' | 'restart'; requestId: string }];

  // Agent lifecycle
  'agent:task:started':    [{ agentId: string; taskId: string; description: string }];
  'agent:task:completed':  [{ agentId: string; taskId: string; durationMs: number }];
  'agent:task:failed':     [{ agentId: string; taskId: string; error: string }];

  // LLM Gateway (LiteLLM)
  'llm:request':   [{ model: string; virtualKey: string; estimatedTokens: number }];
  'llm:response':  [{ model: string; virtualKey: string; tokensUsed: number; costUsd: number }];

  // Agente Pesquisador (scraping + search APIs)
  'research:started':   [{ query: string }];
  'research:completed': [{ query: string; model: string }];

  // Telegram bridge
  'telegram:message:in':  [{ chatId: string; text: string; timestamp: Date }];
  'telegram:message:out': [{ chatId: string; text: string; timestamp: Date }];
  'telegram:queue:enqueue': [{ promptId: string; text: string }];
  'telegram:queue:dequeue': [{ promptId: string }];

  // Security gates
  'security:scan:started':  [{ module: string; tool: 'semgrep' | 'trufflehog' }];
  'security:scan:completed':[{ module: string; tool: 'semgrep' | 'trufflehog'; findings: number }];
  'security:secret:found':  [{ file: string; line: number; secretType: string }];

  // Deploy Agent (aba 🚀 DEPLOY)
  'deploy:command:denied':   [{ command: string; reason: string }];
  'deploy:command:executed': [{ command: string; tier: string; exitCode: number | null }];

  // System
  'system:error': [{ source: string; error: string; stack?: string }];
  'system:ready': [{ timestamp: Date }];
};

export type HermesEventName = keyof HermesEventMap;
export type HermesEventPayload<K extends HermesEventName> = HermesEventMap[K][0];

// ─── Typed Event Bus ─────────────────────────────────────────────────────────
class HermesEventBus {
  private static instance: HermesEventBus;
  private readonly emitter = new EventEmitter();
  private auditLogger!: AuditLogger;

  private constructor() {
    this.emitter.setMaxListeners(50);
  }

  static getInstance(): HermesEventBus {
    if (!HermesEventBus.instance) {
      HermesEventBus.instance = new HermesEventBus();
    }
    return HermesEventBus.instance;
  }

  setAuditLogger(logger: AuditLogger): void {
    this.auditLogger = logger;
  }

  /** Type-safe publish — logs every event to audit trail */
  publish<K extends HermesEventName>(event: K, payload: HermesEventPayload<K>): void {
    this.auditLogger?.log({ event: String(event), payload });
    this.emitter.emit(event, payload);
  }

  /** Type-safe subscribe — returns unsubscribe fn */
  subscribe<K extends HermesEventName>(
    event: K,
    handler: (payload: HermesEventPayload<K>) => void
  ): () => void {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
    return () => this.emitter.off(event, handler as (...args: unknown[]) => void);
  }
}

export const eventBus = HermesEventBus.getInstance();
