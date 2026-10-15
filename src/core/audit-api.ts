/**
 * audit-api — leitura do log de auditoria (logs/audit.jsonl).
 *
 * Expõe as últimas N entradas para a aba "Histórico" do frontend.
 * Cada entrada contém timestamp, ator, evento e payload.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LOG_PATH = join(process.cwd(), 'logs', 'audit.jsonl');

export interface AuditLogEntry {
  ts: string;
  actor: string;
  event: string;
  payload: unknown;
}

/**
 * Lê as últimas `limit` entradas do log de auditoria (mais recentes primeiro).
 * Nunca lança — retorna array vazio se o arquivo não existir.
 */
export function readAuditLog(limit = 100): AuditLogEntry[] {
  try {
    if (!existsSync(LOG_PATH)) return [];
    const raw = readFileSync(LOG_PATH, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    // Pega as últimas N linhas e reverte (mais recentes primeiro)
    const recent = lines.slice(-limit).reverse();
    return recent.map((line) => {
      try {
        return JSON.parse(line) as AuditLogEntry;
      } catch {
        return { ts: '', actor: 'UNKNOWN', event: 'parse_error', payload: { raw: line.slice(0, 200) } };
      }
    });
  } catch {
    return [];
  }
}