/**
 * Hermes Control Center — Audit Logger
 * Module 00: Foundation
 *
 * Append-only structured log of every event, action and permission decision.
 * Written to: logs/audit.jsonl (newline-delimited JSON for easy streaming/grep).
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type AuditActor = 'USER' | 'ORCHESTRATOR' | 'SUBAGENT' | 'GUARDIAN' | 'SYSTEM';

export interface AuditEntry {
  ts: string;          // ISO-8601
  actor: AuditActor;
  event: string;       // e.g. "mcp:started", "process:kill:approved"
  payload: unknown;
}

export class AuditLogger {
  private readonly logPath: string;

  constructor(logDir = 'logs') {
    mkdirSync(logDir, { recursive: true });
    this.logPath = join(logDir, 'audit.jsonl');
  }

  log(
    entry: Omit<AuditEntry, 'ts' | 'actor'> & { actor?: AuditActor }
  ): void {
    const record: AuditEntry = {
      ts:     new Date().toISOString(),
      actor:  entry.actor ?? 'SYSTEM',
      event:  entry.event,
      payload: entry.payload,
    };
    appendFileSync(this.logPath, JSON.stringify(record) + '\n', 'utf8');
  }

  /** Log a permission decision (approve/deny) for irreversible actions. */
  logPermission(opts: {
    actor: AuditActor;
    action: string;
    target: string;
    decision: 'APPROVED' | 'DENIED' | 'AUTO_APPROVED';
    reason?: string;
  }): void {
    this.log({
      actor:  opts.actor,
      event:  `permission:${opts.decision.toLowerCase()}`,
      payload: {
        action: opts.action,
        target: opts.target,
        decision: opts.decision,
        reason: opts.reason ?? null,
      },
    });
  }
}

/** Singleton — module scope */
export const auditLogger = new AuditLogger();
