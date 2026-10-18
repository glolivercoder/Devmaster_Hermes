/**
 * paperclip-routes — API do painel "Show Agents" (aba 🏢 Paperclip & Office).
 *
 * GET /api/paperclip/agents[?since=<ms>] → { agents, feed, stats, serverTime }
 *      feed vem incremental com ?since=<timestamp em ms da última carga> p/ a UI
 *      poliar a 2s sem reenviar o anel inteiro.
 * GET /api/paperclip/tickets             → tickets do PaperclipAdapter (Kanban)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { agentFeed } from './agent-feed.js';
import { paperclipAdapter } from './paperclip-singleton.js';

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export async function handlePaperclipRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
): Promise<boolean> {
  const parsed = new URL(url || '/', 'http://localhost');
  const path = parsed.pathname;
  if (!path.startsWith('/api/paperclip/')) return false;
  const method = (req.method || 'GET').toUpperCase();

  try {
    if (path === '/api/paperclip/agents' && method === 'GET') {
      const since = Number(parsed.searchParams.get('since') ?? 0) || 0;
      send(res, 200, agentFeed.snapshot(since));
      return true;
    }

    if (path === '/api/paperclip/tickets' && method === 'GET') {
      send(res, 200, { tickets: paperclipAdapter.getTickets(), agents: paperclipAdapter.getAgents() });
      return true;
    }

    send(res, 404, { error: 'rota paperclip desconhecida', path });
    return true;
  } catch (e) {
    send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    return true;
  }
}
