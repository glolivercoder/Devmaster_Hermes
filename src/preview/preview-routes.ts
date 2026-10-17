/**
 * preview-routes — backend do visualizador universal de arquivos da aba Previews.
 *
 * Fornece o inventário e o conteúdo bruto dos arquivos do workspace para o
 * visualizador client-side (PDF.js, marked, highlight.js, mammoth, mídia nativa
 * e iframe sandbox para HTML). Rotas:
 *   GET /api/preview/tree?path=rel   → {path, entries:[{name,type,size,ext}]}
 *   GET /api/preview/raw?path=rel    → stream do arquivo com Content-Type correto
 *
 * Segurança: tudo resolvido sob PREVIEW_ROOT (cwd por padrão); traversal (..)
 * bloqueado; diretórios e arquivos ocultos (.git, .env, .*) e node_modules
 * nunca listados nem servidos; limite de25 MB por arquivo.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

const ROOT = resolve(process.env.PREVIEW_ROOT || process.cwd());
const MAX_BYTES = 25 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', 'dist', 'build', 'out', 'coverage']);

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', cjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', map: 'application/json; charset=utf-8',
  ts: 'text/plain; charset=utf-8', tsx: 'text/plain; charset=utf-8', jsx: 'text/plain; charset=utf-8',
  txt: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', markdown: 'text/plain; charset=utf-8',
  yaml: 'text/plain; charset=utf-8', yml: 'text/plain; charset=utf-8', toml: 'text/plain; charset=utf-8', ini: 'text/plain; charset=utf-8',
  csv: 'text/plain; charset=utf-8', sh: 'text/plain; charset=utf-8', ps1: 'text/plain; charset=utf-8', py: 'text/plain; charset=utf-8',
  sql: 'text/plain; charset=utf-8', xml: 'text/xml; charset=utf-8', svg: 'image/svg+xml',
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac', m4a: 'audio/mp4',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};

function json(res: ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/** Resolve um caminho relativo com segurança sob ROOT; null se escapar. */
function safePath(rel: string): string | null {
  const abs = resolve(ROOT, rel || '.');
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return null;
  return abs;
}

function isHiddenOrSkipped(name: string): boolean {
  return name.startsWith('.') || SKIP_DIRS.has(name);
}

export async function handlePreview(
  _req: IncomingMessage,
  res: ServerResponse,
  url: string,
  method: string,
): Promise<boolean> {
  const u = new URL(url, 'http://localhost');
  const p = u.pathname;
  if (!p.startsWith('/api/preview/')) return false;

  // Listagem de diretório (1 nível; a UI navega).
  if (p === '/api/preview/tree' && method === 'GET') {
    const rel = u.searchParams.get('path') || '';
    const abs = safePath(rel);
    if (!abs) { json(res, 403, { error: 'caminho fora da raiz permitida' }); return true; }
    try {
      const items = await readdir(abs, { withFileTypes: true });
      const entries = items
        .filter((d) => !isHiddenOrSkipped(d.name))
        .map((d) => ({ name: d.name, type: d.isDirectory() ? 'dir' : 'file' }))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
      // Tamanhos só dos arquivos (async, limitado aos itens de um diretório).
      for (const e of entries) {
        if (e.type === 'file') {
          try {
            const st = await stat(resolve(abs, e.name));
            (e as any).size = st.size;
            (e as any).ext = extname(e.name).slice(1).toLowerCase();
          } catch { /* arquivo pode ter sumido */ }
        }
      }
      json(res, 200, { path: rel, root: ROOT, entries });
    } catch (e) {
      json(res, 404, { error: `diretório não encontrado: ${rel} (${String(e)})` });
    }
    return true;
  }

  // Conteúdo bruto (a UI decide como renderizar pelo .ext).
  if (p === '/api/preview/raw' && method === 'GET') {
    const rel = u.searchParams.get('path') || '';
    if (!rel || isHiddenOrSkipped(rel.split(/[\\/]/).pop() || '')) {
      json(res, 403, { error: 'arquivo oculto/negado ou ausente' });
      return true;
    }
    const abs = safePath(rel);
    if (!abs) { json(res, 403, { error: 'caminho fora da raiz permitida' }); return true; }
    try {
      const st = await stat(abs);
      if (!st.isFile()) { json(res, 400, { error: 'não é um arquivo' }); return true; }
      if (st.size > MAX_BYTES) { json(res, 413, { error: `arquivo > 25MB (${(st.size / 1048576).toFixed(1)} MB) — preview não servido` }); return true; }
      const ext = extname(abs).slice(1).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': String(st.size),
        'Cache-Control': 'no-store',
      });
      res.end(await readFile(abs));
    } catch (e) {
      json(res, 404, { error: `arquivo não encontrado: ${rel} (${String(e)})` });
    }
    return true;
  }

  json(res, 404, { error: `rota preview desconhecida: ${method} ${p}` });
  return true;
}

/** Exposto para testes/introspecção. */
export const PREVIEW_ROOT = ROOT;
export const previewRelative = (abs: string): string => relative(ROOT, abs);
