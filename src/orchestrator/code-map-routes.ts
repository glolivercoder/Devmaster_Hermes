/**
 * code-map-routes — API dos mapas de código (Archify) do Orquestrador.
 *
 * GET  /api/code-map/status        → skill instalada? nº de mapas
 * POST /api/code-map/generate      → { project?, path?, hint? } gera o mapa
 * GET  /api/code-map/list          → mapas gerados (mais recentes primeiro)
 * GET  /api/code-map/<arquivo>.html → serve o HTML do mapa (anti-traversal)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';
import {
  codeMapStatus, generateCodeMap, listCodeMaps, serveCodeMapFile,
} from './code-map.js';

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new Error('corpo muito grande');
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('JSON inválido'); }
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export async function handleCodeMapRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
): Promise<boolean> {
  const pathname = (url || '').split('?')[0];
  if (!pathname.startsWith('/api/code-map')) return false;
  const method = (req.method || 'GET').toUpperCase();

  try {
    if (pathname === '/api/code-map/status' && method === 'GET') {
      send(res, 200, codeMapStatus());
      return true;
    }

    if (pathname === '/api/code-map/list' && method === 'GET') {
      const maps = listCodeMaps().map((m) => ({
        ...m,
        url: `/api/code-map/${encodeURIComponent(m.file)}`,
      }));
      send(res, 200, { maps });
      return true;
    }

    if (pathname === '/api/code-map/generate' && method === 'POST') {
      const b = await readBody(req);
      const result = await generateCodeMap({
        project: b.project ? String(b.project).trim() : undefined,
        targetPath: b.path ? String(b.path).trim() : undefined,
        hint: b.hint ? String(b.hint).trim() : undefined,
      });
      send(res, 200, result);
      return true;
    }

    // GET /api/code-map/<arquivo>.html → HTML do mapa
    if (pathname.startsWith('/api/code-map/') && method === 'GET') {
      const file = decodeURIComponent(pathname.slice('/api/code-map/'.length));
      const hit = serveCodeMapFile(file);
      if (!hit) { send(res, 404, { error: 'mapa não encontrado' }); return true; }
      const st = statSync(hit.path);
      res.writeHead(200, {
        'Content-Type': extname(hit.path) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream',
        'Content-Length': st.size,
      });
      createReadStream(hit.path).pipe(res);
      return true;
    }

    send(res, 404, { error: 'rota desconhecida' });
    return true;
  } catch (e) {
    send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    return true;
  }
}
