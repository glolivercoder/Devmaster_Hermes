/**
 * market-routes — API da Análise de Mercado
 *
 * POST /api/market/analyze {topic, provider?, project?} → roda o pipeline e
 *       retorna o relatório (com dashboardPath para abrir na aba Previews)
 * GET  /api/market/reports → lista dashboards gerados (data/market-reports/)
 * GET  /api/market/report/:file → devolve o HTML do dashboard (p/ preview inline)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { runMarketAnalysis, type MarketReport } from './market-analysis.js';
import type { SearchProvider } from '../research/researcher.js';

const OUT_DIR = join(process.cwd(), 'data', 'market-reports');

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
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

/** Handler único: retorna true se a rota foi tratada. */
export async function handleMarketRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (!pathname.startsWith('/api/market')) return false;
  const method = req.method ?? 'GET';

  try {
    // POST /api/market/analyze {topic, provider?, project?}
    if (pathname === '/api/market/analyze' && method === 'POST') {
      const b = await readBody(req);
      const topic = String(b.topic ?? '').trim();
      if (!topic) { send(res, 400, { error: 'topic obrigatório' }); return true; }
      const report: MarketReport = await runMarketAnalysis(topic, {
        provider: b.provider as SearchProvider | undefined,
        project: b.project ? String(b.project) : undefined,
      });
      send(res, 200, report);
      return true;
    }

    // GET /api/market/reports → lista dashboards salvos (mais recentes primeiro)
    if (pathname === '/api/market/reports' && method === 'GET') {
      let files: string[] = [];
      try { files = readdirSync(OUT_DIR).filter((f) => f.endsWith('.html')).sort().reverse(); }
      catch { /* dir ainda não existe */ }
      send(res, 200, files.map((f) => ({
        file: f,
        path: `data/market-reports/${f}`,
        url: `/api/market/report/${encodeURIComponent(f)}`,
      })));
      return true;
    }

    // GET /api/market/report/:file → serve o HTML bruto (com validação anti-traversal)
    if (pathname.startsWith('/api/market/report/') && method === 'GET') {
      const file = basename(decodeURIComponent(pathname.slice('/api/market/report/'.length)));
      const full = join(OUT_DIR, file);
      if (!file.endsWith('.html') || !existsSync(full)) { send(res, 404, { error: 'relatório não encontrado' }); return true; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(readFileSync(full, 'utf8'));
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
