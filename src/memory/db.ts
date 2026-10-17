/**
 * db — pool PostgreSQL (pgvector) da memória de contexto do Hermes.
 *
 * O schema é aplicado sob demanda (ensureSchema) a partir de
 * scripts/memory/schema.sql — idempotente (IF NOT EXISTS em tudo).
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let schemaReady = false;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.MEMORY_PG_HOST || 'localhost',
      port: Number(process.env.MEMORY_PG_PORT || 5434),
      user: process.env.MEMORY_PG_USER || process.env.POSTGRES_USER || 'hermes',
      password: process.env.MEMORY_PG_PASSWORD || process.env.POSTGRES_PASSWORD || '',
      database: process.env.MEMORY_PG_DB || 'hermes_gateway',
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
    });
    // Erros de idle client não podem derrubar o processo.
    pool.on('error', (e) => console.error('[memory] pg idle error:', e.message));
  }
  return pool;
}

/** Aplica o schema (idempotente). Chamado pelos módulos antes de usar. */
export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const sql = readFileSync(join(process.cwd(), 'scripts', 'memory', 'schema.sql'), 'utf8');
  await getPool().query(sql);
  schemaReady = true;
}

/** Saúde da memória (para /api/memory/status). */
export async function pingDb(): Promise<{ ok: boolean; error?: string; version?: string }> {
  try {
    const r = await getPool().query('SELECT version() AS v');
    return { ok: true, version: String(r.rows[0].v).split(' ').slice(0, 2).join(' ') };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = null; schemaReady = false; }
}
