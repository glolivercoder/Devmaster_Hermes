/**
 * version-agent-routes — API do Agente de Versionamento de Projetos.
 *
 *   GET  /api/version/status        → config + monitor + remotes + projetos + log
 *   POST /api/version/config        → {enabled, intervalSec, gitea, github, githubPrivate}
 *   POST /api/version/run           → {project?, message?} — save point agora (push simultâneo)
 *   POST /api/version/github/repo   → {project} — só cria o repositório no GitHub (privado)
 *   GET  /api/version/log           → últimas 60 entradas do agente
 *
 * Os dois servidores (:4010 e :4020) delegam aqui via startsWith('/api/version/').
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  getStatus, getLog, loadConfig, saveConfig, runAll, ghEnsureRepo, redact,
} from './project-version-agent.js';
import { listProjects } from '../orchestrator/project-store.js';
import { auditLogger } from '../core/audit-logger.js';

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(b || '{}') as Record<string, unknown>); }
      catch { resolve({}); }
    });
  });
}

export async function handleVersionAgent(
  req: IncomingMessage,
  res: ServerResponse,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  let url: URL;
  try { url = new URL(rawUrl, 'http://localhost'); }
  catch { return false; }
  const p = url.pathname;
  if (!p.startsWith('/api/version/')) return false;

  try {
    if (p === '/api/version/status' && method === 'GET') {
      json(200, await getStatus());
      return true;
    }

    if (p === '/api/version/log' && method === 'GET') {
      json(200, { log: getLog() });
      return true;
    }

    if (p === '/api/version/config' && method === 'POST') {
      const b = await readBody(req);
      const cfg = saveConfig(b as Partial<import('./project-version-agent.js').VersionAgentConfig>);
      auditLogger.log({ actor: 'USER', event: 'version:config', payload: { ...cfg } });
      json(200, { config: cfg, monitor: (await getStatus()).monitor });
      return true;
    }

    if (p === '/api/version/run' && method === 'POST') {
      const b = await readBody(req);
      const project = b.project ? String(b.project) : undefined;
      const message = b.message ? String(b.message) : undefined;
      if (project && !listProjects().some((x) => x.name === project)) {
        json(404, { error: `projeto desconhecido: ${project}` });
        return true;
      }
      const results = await runAll({ project, message });
      json(200, { results, count: results.length });
      return true;
    }

    if (p === '/api/version/github/repo' && method === 'POST') {
      const b = await readBody(req);
      const project = String(b.project || '').trim();
      if (!project) { json(400, { error: 'project obrigatório' }); return true; }
      const cfg = loadConfig();
      const r = await ghEnsureRepo(project, cfg.githubPrivate);
      auditLogger.log({ actor: 'USER', event: 'version:github:repo', payload: { project, ok: r.ok, detail: redact(r.detail) } });
      json(r.ok ? 200 : 502, r);
      return true;
    }

    json(404, { error: 'rota versionamento desconhecida', path: p });
    return true;
  } catch (e) {
    json(500, { error: redact(e instanceof Error ? e.message : String(e)) });
    return true;
  }
}

/** Chamado no boot do servidor: sobe o monitor se estiver habilitado. */
export function initVersionAgent(): void {
  // applyConfig é importado de dentro do agent (evita ciclo de imports aqui).
  import('./project-version-agent.js').then((m) => m.applyConfig()).catch((e) => {
    console.warn('[VERSION] falha ao iniciar monitor:', e?.message || e);
  });
}
