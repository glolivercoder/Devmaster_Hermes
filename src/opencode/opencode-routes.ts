/**
 * opencode-routes — expõe a API do OpenCode no dashboard do Hermes.
 *
 * Rotas (mesmo padrão dos handlers handleGitea/handlePorts):
 *   GET    /api/opencode/status                    → {running, port, baseUrl, bin, workdir}
 *   GET    /api/opencode/models                    → {models:[{id:'prov/model', name}]}
 *   GET    /api/opencode/sessions                  → {sessions:[...]}
 *   POST   /api/opencode/sessions                  → cria {title} → sessão
 *   DELETE /api/opencode/sessions?id=...           → remove
 *   GET    /api/opencode/sessions/:id/messages     → {messages:[{info,parts}]}
 *   POST   /api/opencode/sessions/:id/messages     → {text, model} → dispara agente
 *                                                    (síncrono no OpenCode; timeout5min)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ensureServer, ocFetch, opencodeStatus } from './opencode-bridge.js';
import { auditLogger } from '../core/audit-logger.js';

function json(res: ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

export async function handleOpencode(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  method: string,
): Promise<boolean> {
  const u = new URL(url, 'http://localhost');
  const p = u.pathname;
  if (!p.startsWith('/api/opencode/')) return false;

  // Status (só reporta; a UI pode pedir start implícito via qualquer outra rota).
  if (p === '/api/opencode/status' && method === 'GET') {
    json(res, 200, await opencodeStatus());
    return true;
  }

  // Iniciar manualmente (botão da UI quando offline).
  if (p === '/api/opencode/start' && method === 'POST') {
    const started = await ensureServer();
    auditLogger.log({ actor: 'USER', event: 'opencode:server:start', payload: { started } });
    json(res, started ? 200 : 502, { started, ...(await opencodeStatus()) });
    return true;
  }

  // Catálogo de modelos para o seletor (omniroute grátis primeiro).
  if (p === '/api/opencode/models' && method === 'GET') {
    const r = await ocFetch('/provider', { timeoutMs: 20_000 });
    if (!r.ok) { json(res, 502, r.json); return true; }
    const models: Array<{ id: string; name: string; provider: string }> = [];
    for (const prov of (r.json?.all ?? []) as any[]) {
      for (const m of Object.values(prov.models ?? {}) as any[]) {
        models.push({ id: `${prov.id}/${m.id}`, name: m.name || m.id, provider: prov.id });
      }
    }
    // Prioridade: OmniRoute (grátis) → hermes (fallback Control Center) → resto.
    // Os 235 providers com catálogo builtin têm 9k+ modelos; sem a prioridade
    // fixa de `hermes`, o corte em 500 engolia o provider inteiro (só 5/25
    // apareciam — os "Cheaper*" que sortiam cedo no alfabeto).
    const prio = (prov: string): number =>
      prov === 'opencode-omniroute' ? 0 : prov === 'hermes' ? 1 : 2;
    models.sort((a, b) => prio(a.provider) - prio(b.provider) || a.name.localeCompare(b.name));
    // O catálogo completo tem9k+ variações — o seletor da UI fica leve com os
    // omniroute (grátis) primeiro e corte em500.
    json(res, 200, { total: models.length, models: models.slice(0, 500) });
    return true;
  }

  // Sessões.
  if (p === '/api/opencode/sessions' && method === 'GET') {
    const r = await ocFetch('/session', { timeoutMs: 20_000 });
    json(res, r.ok ? 200 : 502, r.ok ? { sessions: r.json } : r.json);
    return true;
  }
  if (p === '/api/opencode/sessions' && method === 'POST') {
    let body: any = {};
    try { body = await readBody(req); } catch { /* vazio ok */ }
    const r = await ocFetch('/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: body?.title || undefined }),
    });
    if (r.ok) auditLogger.log({ actor: 'USER', event: 'opencode:session:created', payload: { id: r.json?.id, slug: r.json?.slug } });
    json(res, r.ok ? 200 : 502, r.json);
    return true;
  }
  const mDel = p.match(/^\/api\/opencode\/sessions\/([^/]+)$/);
  if (mDel && method === 'DELETE') {
    const id = mDel[1];
    const r = await ocFetch(`/session/${encodeURIComponent(id)}`, { method: 'DELETE' });
    auditLogger.log({ actor: 'USER', event: 'opencode:session:deleted', payload: { id } });
    json(res, r.ok ? 200 : 502, r.json ?? { deleted: true });
    return true;
  }

  // Mensagens (transcript + prompt).
  const mMsg = p.match(/^\/api\/opencode\/sessions\/([^/]+)\/messages$/);
  if (mMsg && method === 'GET') {
    const id = mMsg[1];
    const r = await ocFetch(`/session/${encodeURIComponent(id)}/message`, { timeoutMs: 30_000 });
    json(res, r.ok ? 200 : 502, r.ok ? { messages: r.json } : r.json);
    return true;
  }
  if (mMsg && method === 'POST') {
    const id = mMsg[1];
    let body: any = {};
    try { body = await readBody(req); } catch { /* ok */ }
    if (!body?.text) { json(res, 400, { error: 'text é obrigatório' }); return true; }
    // "prov/model" (modelID pode conter '/', ex.: kr/auto).
    const full = String(body.model || 'opencode-omniroute/kr/auto');
    const idx = full.indexOf('/');
    const providerID = idx > 0 ? full.slice(0, idx) : 'opencode-omniroute';
    const modelID = idx > 0 ? full.slice(idx + 1) : 'kr/auto';
    const payload = {
      model: { providerID, modelID },
      parts: [{ type: 'text', text: String(body.text) }],
    };
    auditLogger.log({ actor: 'USER', event: 'opencode:prompt', payload: { sessionID: id, model: full, chars: String(body.text).length } });
    // OpenCode executa o agente síncronamente nesta rota — timeout generoso.
    const r = await ocFetch(`/session/${encodeURIComponent(id)}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: 300_000,
    });
    json(res, r.ok ? 200 : 502, r.json);
    return true;
  }

  json(res, 404, { error: `rota OpenCode desconhecida: ${method} ${p}` });
  return true;
}
