/**
 * research-routes — API do Agente Pesquisador
 *
 * GET  /api/researcher/status   → ferramentas (curl_cffi/seleniumbase/botasaurus) + search APIs
 * POST /api/researcher/search   {query, provider?, max?}
 * POST /api/researcher/scrape   {url, tool?, maxChars?}
 * POST /api/researcher/research {query, maxResults?, tool?, provider?} → síntese completa
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import {
  researcherStatus, searchWeb, scrapeUrl, researchTask,
  type SearchProvider, type ScrapeTool,
} from './researcher.js';

const MAX_BODY = 512 * 1024;
const PYTHON = process.env.PYTHON_BIN || 'python';
const PDF2MD_PY = join(process.cwd(), 'scripts', 'research', 'pdf2md.py');

/** Camada 1: PDF/DOCX/... → Markdown econômico via MarkItDown (worker Python). */
function runPdf2Md(file: string, maxChars = 200_000): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [PDF2MD_PY, '--file', file, '--max-chars', String(maxChars)], { windowsHide: true });
    let out = ''; let err = '';
    const timer = setTimeout(() => child.kill(), 120_000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: `python indisponível: ${String(e)}` }); });
    child.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(out.trim())); }
      catch { resolve({ ok: false, error: `saída inválida do worker: ${(out || err).slice(0, 300)}` }); }
    });
  });
}

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
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

/** Handler único: retorna true se a rota foi tratada. */
export async function handleResearchRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (!pathname.startsWith('/api/researcher/')) return false;
  const method = req.method ?? 'GET';

  try {
    // GET /api/researcher/status
    if (pathname === '/api/researcher/status' && method === 'GET') {
      send(res, 200, await researcherStatus());
      return true;
    }

    // POST /api/researcher/search
    if (pathname === '/api/researcher/search' && method === 'POST') {
      const b = await readBody(req);
      const query = String(b.query ?? '').trim();
      if (!query) { send(res, 400, { error: 'query obrigatória' }); return true; }
      const out = await searchWeb(query, b.provider as SearchProvider | undefined, Number(b.max) || 6);
      send(res, 200, out);
      return true;
    }

    // POST /api/researcher/scrape
    if (pathname === '/api/researcher/scrape' && method === 'POST') {
      const b = await readBody(req);
      const url = String(b.url ?? '').trim();
      if (!url) { send(res, 400, { error: 'url obrigatória' }); return true; }
      const out = await scrapeUrl(
        url,
        (b.tool as ScrapeTool) || 'curl_cffi',
        Number(b.maxChars) || 24_000,
      );
      send(res, out.ok ? 200 : 422, out);
      return true;
    }

    // POST /api/researcher/pdf — Camada 1: documento → Markdown (MarkItDown)
    if (pathname === '/api/researcher/pdf' && method === 'POST') {
      const b = await readBody(req);
      const file = String(b.file ?? '').trim();
      if (!file) { send(res, 400, { error: 'file obrigatório' }); return true; }
      const out = await runPdf2Md(file, Number(b.maxChars) || 200_000);
      send(res, out.ok ? 200 : 422, out);
      return true;
    }

    // POST /api/researcher/research — pipeline completo com síntese LLM
    if (pathname === '/api/researcher/research' && method === 'POST') {
      const b = await readBody(req);
      const query = String(b.query ?? '').trim();
      if (!query) { send(res, 400, { error: 'query obrigatória' }); return true; }
      const report = await researchTask(query, {
        maxResults: Number(b.maxResults) || 3,
        tool: b.tool as ScrapeTool | undefined,
        provider: b.provider as SearchProvider | undefined,
      });
      send(res, 200, report);
      return true;
    }

    send(res, 404, { error: 'rota researcher desconhecida', path: pathname });
    return true;
  } catch (e) {
    send(res, 500, { error: String(e instanceof Error ? e.message : e) });
    return true;
  }
}
