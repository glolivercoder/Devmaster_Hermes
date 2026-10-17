/**
 * optimizer-routes — API do Otimizador de Prompts.
 *
 * POST /api/optimizer/optimize {prompt, pdfUrls?, docUrls?, project?}
 *      → pipeline completo: intent → análise fria → pesquisa → expansão → otimização
 * POST /api/optimizer/discuss  {prompt, optimized, issues[], messages[]}
 *      → discussão interativa (confrontar sugestões; a LLM pode perguntar o projeto)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runOptimizer, discuss } from './pipeline.js';

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 256 * 1024) throw new Error('corpo muito grande');
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

export async function handleOptimizerRoutes(
  req: IncomingMessage, res: ServerResponse, pathname: string,
): Promise<boolean> {
  if (!pathname.startsWith('/api/optimizer/')) return false;
  const method = req.method ?? 'GET';

  try {
    if (pathname === '/api/optimizer/optimize' && method === 'POST') {
      const b = await readBody(req);
      const prompt = String(b.prompt ?? '').trim();
      if (!prompt) { send(res, 400, { error: 'prompt obrigatório' }); return true; }
      const result = await runOptimizer({
        prompt,
        pdfUrls: Array.isArray(b.pdfUrls) ? b.pdfUrls.map(String) : [],
        docUrls: Array.isArray(b.docUrls) ? b.docUrls.map(String) : [],
        project: b.project ? String(b.project) : undefined,
      });
      send(res, 200, result);
      return true;
    }

    if (pathname === '/api/optimizer/discuss' && method === 'POST') {
      const b = await readBody(req);
      const prompt = String(b.prompt ?? '').trim();
      if (!prompt) { send(res, 400, { error: 'prompt obrigatório' }); return true; }
      send(res, 200, await discuss({
        prompt,
        optimized: String(b.optimized ?? ''),
        issues: Array.isArray(b.issues) ? b.issues.map(String) : [],
        messages: Array.isArray(b.messages) ? b.messages : [],
      }));
      return true;
    }

    return false;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /obrigat|inválid|JSON/i.test(msg) ? 400 : 500;
    if (!res.headersSent) send(res, status, { error: msg });
    return true;
  }
}
