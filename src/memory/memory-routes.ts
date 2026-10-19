/**
 * memory-routes — API da memória de contexto por projeto.
 *
 * GET  /api/memory/status              → saúde (pg + embeddings) e projetos
 * GET  /api/memory/projects            → lista de projetos
 * POST /api/memory/remember            {project, kind, content, title?, tags?}
 * POST /api/memory/recall              {project, query?, topK?, kinds?}
 * POST /api/memory/continuity          {project, question?} → bloco p/ prompt
 * POST /api/memory/state               {project, lastTask?, lastFiles?, nextSteps?}
 * GET  /api/memory/state/:project
 * GET  /api/memory/history/:project?limit=50
 * DELETE /api/memory/project/:project
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pingDb } from './db.js';
import { embeddingStatus } from './embeddings.js';
import {
  remember, recall, continuityBlock, saveState, getState,
  listProjects, history, deleteProject, normProject, type MemoryKind,
} from './project-memory.js';
import { seedApiCatalog } from './api-catalog.js';
import { listAgencyAgentReferences, seedAgencyAgents } from './agency-agents.js';

const MAX_BODY = 1024 * 1024;

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('JSON inválido'); }
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const KINDS: MemoryKind[] = ['checkpoint', 'decision', 'code', 'context', 'task', 'doc'];

export async function handleMemoryRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (!pathname.startsWith('/api/memory/')) return false;
  const method = req.method ?? 'GET';

  try {
    if (pathname === '/api/memory/status' && method === 'GET') {
      const db = await pingDb();
      send(res, 200, { db, embeddings: embeddingStatus() });
      return true;
    }

    if (pathname === '/api/memory/projects' && method === 'GET') {
      send(res, 200, await listProjects());
      return true;
    }

    // POST /api/memory/seed-apis — semeia o catálogo de APIs no RAG (idempotente)
    if (pathname === '/api/memory/seed-apis' && method === 'POST') {
      send(res, 200, await seedApiCatalog());
      return true;
    }

    if (pathname === '/api/memory/agency-agents' && method === 'GET') {
      const agents = await listAgencyAgentReferences();
      send(res, 200, { project: 'agency-agents', count: agents.length, agents });
      return true;
    }

    if (pathname === '/api/memory/seed-agency-agents' && method === 'POST') {
      send(res, 200, await seedAgencyAgents());
      return true;
    }

    if (pathname === '/api/memory/remember' && method === 'POST') {
      const b = await readBody(req);
      if (!b.project || !b.content) { send(res, 400, { error: 'project e content obrigatórios' }); return true; }
      const kind = (KINDS.includes(b.kind) ? b.kind : 'context') as MemoryKind;
      send(res, 200, await remember({
        project: String(b.project), kind,
        content: String(b.content), title: b.title ? String(b.title) : undefined,
        tags: Array.isArray(b.tags) ? b.tags.map(String) : [],
        metadata: b.metadata,
      }));
      return true;
    }

    if (pathname === '/api/memory/recall' && method === 'POST') {
      const b = await readBody(req);
      if (!b.project) { send(res, 400, { error: 'project obrigatório' }); return true; }
      const kinds = Array.isArray(b.kinds) ? b.kinds.filter((k: string) => KINDS.includes(k as MemoryKind)) as MemoryKind[] : undefined;
      send(res, 200, await recall(String(b.project), String(b.query ?? ''), Number(b.topK) || 6, kinds));
      return true;
    }

    if (pathname === '/api/memory/continuity' && method === 'POST') {
      const b = await readBody(req);
      if (!b.project) { send(res, 400, { error: 'project obrigatório' }); return true; }
      send(res, 200, { block: await continuityBlock(String(b.project), b.question ? String(b.question) : undefined) });
      return true;
    }

    if (pathname === '/api/memory/state' && method === 'POST') {
      const b = await readBody(req);
      if (!b.project) { send(res, 400, { error: 'project obrigatório' }); return true; }
      send(res, 200, await saveState(String(b.project), {
        lastTask: b.lastTask ? String(b.lastTask) : undefined,
        lastFiles: Array.isArray(b.lastFiles) ? b.lastFiles.map(String) : undefined,
        nextSteps: b.nextSteps ? String(b.nextSteps) : undefined,
      }));
      return true;
    }

    const stateMatch = pathname.match(/^\/api\/memory\/state\/([^/]+)$/);
    if (stateMatch && method === 'GET') {
      send(res, 200, await getState(normProject(decodeURIComponent(stateMatch[1]))));
      return true;
    }

    const histMatch = pathname.match(/^\/api\/memory\/history\/([^/]+)$/);
    if (histMatch && method === 'GET') {
      const limit = Number(new URL(req.url ?? '', 'http://x').searchParams.get('limit')) || 50;
      send(res, 200, await history(normProject(decodeURIComponent(histMatch[1])), limit));
      return true;
    }

    const delMatch = pathname.match(/^\/api\/memory\/project\/([^/]+)$/);
    if (delMatch && method === 'DELETE') {
      const ok = await deleteProject(normProject(decodeURIComponent(delMatch[1])));
      send(res, ok ? 200 : 404, ok ? { deleted: true } : { error: 'projeto não encontrado' });
      return true;
    }

    send(res, 404, { error: 'rota memory desconhecida', path: pathname });
    return true;
  } catch (e) {
    send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    return true;
  }
}
