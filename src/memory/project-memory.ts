/**
 * project-memory — memória de contexto por projeto (pgvector).
 *
 * Objetivo: dar continuidade às sessões dos LLMs SEM importar qual modelo está
 * no cargo. O histórico de "onde o código parou" fica no Postgres (texto +
 * embedding), não na janela de contexto de um provider específico — trocar de
 * Claude → Gemini → Cheaper não zera nada.
 *
 * Três operações:
 *  1. remember  — grava um fato/checkpoint/decisão (com embedding).
 *  2. recall    — busca semântica (cosseno) + recência → trechos relevantes.
 *  3. continuity— o "onde paramos": estado atual + últimos marcos.
 */
import { ensureSchema, getPool } from './db.js';
import { embed, toVectorLiteral } from './embeddings.js';
import { auditLogger } from '../core/audit-logger.js';

export type MemoryKind = 'checkpoint' | 'decision' | 'code' | 'context' | 'task' | 'doc';

export interface MemoryRow {
  id: number;
  project: string;
  kind: MemoryKind;
  title: string | null;
  content: string;
  tags: string[];
  createdAt: string;
  score?: number;
}

export interface RememberInput {
  project: string;
  kind: MemoryKind;
  content: string;
  title?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ContinuityState {
  lastTask: string | null;
  lastFiles: string[];
  nextSteps: string | null;
  updatedAt: string | null;
}

/** Normaliza o nome do projeto (chave estável de agrupamento). */
export function normProject(p: string): string {
  return (p || 'default').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 80);
}

async function projectId(name: string): Promise<number> {
  const pool = getPool();
  const r = await pool.query(
    `INSERT INTO projects (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [name],
  );
  return r.rows[0].id as number;
}

/**
 * Grava uma memória. Se o embedding falhar, grava mesmo assim (embedding nulo)
 * — recall por similaridade ignora a linha, mas nada se perde.
 */
export async function remember(input: RememberInput): Promise<{ id: number; embedded: boolean }> {
  await ensureSchema();
  const name = normProject(input.project);
  const pid = await projectId(name);
  const content = (input.content ?? '').trim();
  if (!content) throw new Error('content obrigatório');

  let vector: string | null = null;
  let embedded = false;
  try {
    // Embedding do título+conteúdo (título ajuda a ancorar o significado).
    const e = await embed(`${input.title ?? ''}\n${content}`);
    vector = toVectorLiteral(e.vector);
    embedded = true;
  } catch { /* segue sem vetor */ }

  const r = await getPool().query(
    `INSERT INTO project_memories (project_id, kind, title, content, tags, embedding, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
     RETURNING id`,
    [pid, input.kind, input.title ?? null, content, input.tags ?? [], vector,
     JSON.stringify(input.metadata ?? {})],
  );
  await getPool().query(`UPDATE projects SET updated_at = now() WHERE id = $1`, [pid]);

  auditLogger.log({ actor: 'SUBAGENT', event: 'memory:remember',
    payload: { project: name, kind: input.kind, embedded, chars: content.length } });
  return { id: r.rows[0].id as number, embedded };
}

/**
 * Busca semântica num projeto. Mistura similaridade de cosseno com um leve
 * bônus de recência (memórias novas pontuam um pouco mais).
 */
export async function recall(
  project: string,
  query: string,
  topK = 6,
  kinds?: MemoryKind[],
): Promise<MemoryRow[]> {
  await ensureSchema();
  const name = normProject(project);
  const pidRes = await getPool().query(`SELECT id FROM projects WHERE name = $1`, [name]);
  if (!pidRes.rows.length) return [];
  const pid = pidRes.rows[0].id as number;

  const hasQuery = (query ?? '').trim().length > 0;
  let vec: string | null = null;
  if (hasQuery) {
    try { vec = toVectorLiteral((await embed(query)).vector); } catch { vec = null; }
  }

  const kindFilter = kinds && kinds.length ? `AND m.kind = ANY($4)` : '';
  const params: unknown[] = [pid];
  if (kinds && kinds.length) params.push(kinds);

  // Sem query/vector → apenas os mais recentes (continuidade pura).
  if (!vec) {
    const r = await getPool().query(
      `SELECT m.id, m.kind, m.title, m.content, m.tags, m.created_at
       FROM project_memories m WHERE m.project_id = $1 ${kindFilter}
       ORDER BY m.created_at DESC LIMIT $2`,
      [...params, topK],
    );
    return mapRows(r.rows);
  }

  // Com vetor → cosseno + bônus de recência (exponencial, meia-vida ~30 dias).
  const r = await getPool().query(
    `SELECT m.id, m.kind, m.title, m.content, m.tags, m.created_at,
            (1 - (m.embedding <=> $2::vector)) AS sim,
            EXTRACT(EPOCH FROM (now() - m.created_at)) / 2592000.0 AS age_months
     FROM project_memories m
     WHERE m.project_id = $1 AND m.embedding IS NOT NULL ${kindFilter}
     ORDER BY (1 - (m.embedding <=> $2::vector)) * (1 + 0.15 * EXP(-EXTRACT(EPOCH FROM (now() - m.created_at)) / 2592000.0)) DESC
     LIMIT $3`,
    vec ? [pid, vec, topK, ...(kinds && kinds.length ? [kinds] : [])] : params,
  );
  return mapRows(r.rows);
}

function mapRows(rows: Record<string, unknown>[]): MemoryRow[] {
  return rows.map((x) => ({
    id: Number(x.id),
    project: String(x.project ?? ''),
    kind: x.kind as MemoryKind,
    title: x.title == null ? null : String(x.title),
    content: String(x.content),
    tags: Array.isArray(x.tags) ? (x.tags as string[]) : [],
    createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : String(x.created_at ?? ''),
    score: x.sim == null ? undefined : Number(x.sim),
  }));
}

/** Grava/atualiza o estado de continuidade ("onde o código parou"). */
export async function saveState(
  project: string,
  state: Partial<ContinuityState>,
): Promise<ContinuityState> {
  await ensureSchema();
  const name = normProject(project);
  const pid = await projectId(name);

  const cur = await getState(name);
  const next: ContinuityState = {
    lastTask: state.lastTask ?? cur.lastTask,
    lastFiles: state.lastFiles ?? cur.lastFiles,
    nextSteps: state.nextSteps ?? cur.nextSteps,
    updatedAt: new Date().toISOString(),
  };

  let vec: string | null = null;
  try {
    vec = toVectorLiteral((await embed(
      `Tarefa: ${next.lastTask ?? ''}\nArquivos: ${next.lastFiles.join(', ')}\nPróximos passos: ${next.nextSteps ?? ''}`,
    )).vector);
  } catch { /* sem vetor */ }

  await getPool().query(
    `INSERT INTO project_state (project_id, last_task, last_files, next_steps, embedding, updated_at)
     VALUES ($1, $2, $3, $4, $5::vector, now())
     ON CONFLICT (project_id) DO UPDATE SET
       last_task = EXCLUDED.last_task, last_files = EXCLUDED.last_files,
       next_steps = EXCLUDED.next_steps, embedding = EXCLUDED.embedding, updated_at = now()`,
    [pid, next.lastTask, next.lastFiles, next.nextSteps, vec],
  );
  auditLogger.log({ actor: 'SUBAGENT', event: 'memory:state', payload: { project: name, task: next.lastTask } });
  return next;
}

export async function getState(project: string): Promise<ContinuityState> {
  await ensureSchema();
  const name = normProject(project);
  const r = await getPool().query(
    `SELECT s.last_task, s.last_files, s.next_steps, s.updated_at
     FROM project_state s JOIN projects p ON p.id = s.project_id
     WHERE p.name = $1`, [name]);
  if (!r.rows.length) return { lastTask: null, lastFiles: [], nextSteps: null, updatedAt: null };
  const x = r.rows[0];
  return {
    lastTask: x.last_task == null ? null : String(x.last_task),
    lastFiles: Array.isArray(x.last_files) ? (x.last_files as string[]) : [],
    nextSteps: x.next_steps == null ? null : String(x.next_steps),
    updatedAt: x.updated_at instanceof Date ? x.updated_at.toISOString() : String(x.updated_at),
  };
}

/** Lista projetos com contagem de memórias (para UI). */
export async function listProjects(): Promise<Array<{
  name: string; description: string | null; memories: number; lastActivity: string | null;
}>> {
  await ensureSchema();
  const r = await getPool().query(
    `SELECT p.name, p.description, p.updated_at, COUNT(m.id)::int AS memories
     FROM projects p LEFT JOIN project_memories m ON m.project_id = p.id
     GROUP BY p.id ORDER BY p.updated_at DESC`);
  return r.rows.map((x) => ({
    name: String(x.name),
    description: x.description == null ? null : String(x.description),
    memories: Number(x.memories),
    lastActivity: x.updated_at == null ? null :
      (x.updated_at instanceof Date ? x.updated_at.toISOString() : String(x.updated_at)),
  }));
}

/** Histórico completo de um projeto (timeline para UI). */
export async function history(project: string, limit = 50): Promise<MemoryRow[]> {
  await ensureSchema();
  const name = normProject(project);
  const r = await getPool().query(
    `SELECT m.id, m.kind, m.title, m.content, m.tags, m.created_at, p.name AS project
     FROM project_memories m JOIN projects p ON p.id = m.project_id
     WHERE p.name = $1 ORDER BY m.created_at DESC LIMIT $2`, [name, limit]);
  return mapRows(r.rows);
}

/** Remove uma memória específica, limitada ao projeto informado. */
export async function deleteMemory(project: string, id: number): Promise<boolean> {
  await ensureSchema();
  const r = await getPool().query(
    `DELETE FROM project_memories m USING projects p
     WHERE m.project_id = p.id AND p.name = $1 AND m.id = $2`,
    [normProject(project), id],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Monta o bloco de contexto de continuidade para injetar num prompt de LLM.
 * É o coração do "continuar sem alucinar": diz ao modelo exatamente onde paramos.
 */
export async function continuityBlock(project: string, question?: string): Promise<string> {
  const name = normProject(project);
  const state = await getState(name);
  const rel = question ? await recall(name, question, 5) : await recall(name, '', 5);

  const lines: string[] = [`CONTEXTO DE CONTINUIDADE DO PROJETO "${name}"`, ''];

  if (state.updatedAt) {
    lines.push('## Onde paramos (estado atual)');
    lines.push(`Última atividade: ${state.updatedAt}`);
    if (state.lastTask) lines.push(`- Última tarefa: ${state.lastTask}`);
    if (state.lastFiles.length) lines.push(`- Arquivos tocados: ${state.lastFiles.join(', ')}`);
    if (state.nextSteps) lines.push(`- Próximos passos registrados: ${state.nextSteps}`);
    lines.push('');
  } else {
    lines.push('(sem estado de continuidade registrado para este projeto ainda)');
    lines.push('');
  }

  if (rel.length) {
    lines.push('## Memórias relevantes');
    for (const m of rel) {
      const when = m.createdAt.slice(0, 16).replace('T', ' ');
      lines.push(`- [${m.kind}] ${when}${m.title ? ` — ${m.title}` : ''}: ${m.content.slice(0, 700)}`);
    }
    lines.push('');
  }

  lines.push('Use estes fatos como verdade. NÃO repita trabalho já feito, NÃO invente estado ');
  lines.push('não listado acima, e siga dos "próximos passos" quando houver.');
  return lines.join('\n');
}

/** Deleta todas as memórias + estado de um projeto. */
export async function deleteProject(project: string): Promise<boolean> {
  await ensureSchema();
  const name = normProject(project);
  const r = await getPool().query(`DELETE FROM projects WHERE name = $1`, [name]);
  return (r.rowCount ?? 0) > 0;
}
