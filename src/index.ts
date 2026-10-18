/**
 * Hermes Control Center — Entry Point
 * Module 00: Foundation bootstrap
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { auditLogger } from './core/audit-logger.js';
import { eventBus } from './core/event-bus.js';
import { loadRegistry } from './core/registry.js';
import { TelegramBridge } from './telegram/telegram-bridge.js';
import { ComposioAgent } from './integrations/composio-agent.js';
import { getCenterState, updateRouting, testProviderConnection } from './llm/llm-center.js';
import { setEnvVar } from './llm/env-store.js';
import { loadDotEnv, ENV_PATH } from './llm/env-loader.js';
import { resolveModel, explainModel } from './llm/routing-store.js';
import { benchmarkRanking } from './llm/smart-router.js';
import { LLM_MODELS } from './llm/models.js';
import { handleOpencode } from './opencode/opencode-routes.js';
import { handlePreview } from './preview/preview-routes.js';
import { handleResearchRoutes } from './research/research-routes.js';
import { handleOrchestratorRoutes } from './orchestrator/orchestrator-routes.js';
import { handleCodeMapRoutes } from './orchestrator/code-map-routes.js';
import { handlePaperclipRoutes } from './paperclip/paperclip-routes.js';
import { initAgentFeed } from './paperclip/agent-feed.js';
import { handleMemoryRoutes } from './memory/memory-routes.js';
import { handleMarketRoutes } from './market/market-routes.js';
import { handleOptimizerRoutes } from './optimizer/optimizer-routes.js';
import { handleDeployRoutes } from './deploy/deploy-routes.js';
import { handleN8nRoutes } from './n8n/n8n-routes.js';
import {
  testConnection as giteaTestConnection,
  listRepos as giteaListRepos,
  listWebhooks as giteaListWebhooks,
  createWebhook as giteaCreateWebhook,
  createLocalBackup as giteaCreateBackup,
  listBackups as giteaListBackups,
} from '../scripts/gitea-client.js';
import { getEnvSettings, setEnvSetting, deleteEnvSetting } from './llm/env-db-store.js';
import { readAuditLog } from './core/audit-api.js';
import { GiteaOpsAgent } from './gitea/gitea-ops-agent.js';
import { handleVersionAgent, initVersionAgent } from './gitea/version-agent-routes.js';
import {
  getProcessSnapshot, executeProcessAction, getMcpCategories,
  initProcessAgent, paStatus, savePaConfig, type ProcAction,
} from './guardian/process-agent.js';
import { scanPorts } from './guardian/port-inventory.js';
import { portOwner, type McpRegistry } from './core/registry.js';

const PROCESS_API_PORT = 4010;   // Process Guardian API (health/status)
const DASHBOARD_PORT = 4020;     // Event Bus / Web Dashboard
const UI_PATH = join(process.cwd(), 'src', 'ui', 'index.html');

/** Lê e faz o parse do corpo JSON de uma requisição. Nunca lança — devolve {}. */
function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(b || '{}') as Record<string, unknown>); }
      catch { resolve({}); }
    });
  });
}

/**
 * Manipulador compartilhado das rotas /api/gitea/* (Versionamento & Backup).
 * Devolve `true` se a rota foi reconhecida (e a resposta já foi enviada),
 * para que os dois servidores (:4010 e :4020) apenas deleguem aqui.
 */
async function handleGitea(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  url: string,
  method: string,
): Promise<boolean> {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  // GET /api/gitea/status — teste de conexão com o Gitea
  if (url === '/api/gitea/status' && method === 'GET') {
    const result = await giteaTestConnection();
    auditLogger.log({ actor: 'USER', event: 'gitea:tested', payload: { connected: result.connected } });
    json(result.connected ? 200 : 502, result);
    return true;
  }

  // GET /api/gitea/repos — lista repositórios do owner autenticado
  if (url === '/api/gitea/repos' && method === 'GET') {
    const result = await giteaListRepos();
    json(result.ok ? 200 : 502, result);
    return true;
  }

  // GET /api/gitea/backups — bundles locais já gerados
  if (url === '/api/gitea/backups' && method === 'GET') {
    const result = giteaListBackups();
    json(result.ok ? 200 : 500, result);
    return true;
  }

  // POST /api/gitea/backup — cria um bundle git local (proteção/rollback)
  if (url === '/api/gitea/backup' && method === 'POST') {
    const result = giteaCreateBackup();
    if (result.ok) auditLogger.log({ actor: 'USER', event: 'gitea:backup:created', payload: { file: result.file, bytes: result.bytes } });
    json(result.ok ? 200 : 500, result);
    return true;
  }

  // GET /api/gitea/hooks?repo=X — lista webhooks de um repositório
  if (url.startsWith('/api/gitea/hooks') && method === 'GET') {
    const repo = new URL(url, 'http://localhost').searchParams.get('repo') ?? '';
    const result = await giteaListWebhooks(repo);
    json(result.ok ? 200 : 502, result);
    return true;
  }

  // POST /api/gitea/hooks { repo, url, events } — cria webhook do tipo "gitea"
  if (url === '/api/gitea/hooks' && method === 'POST') {
    const { repo, url: target, events } = await readBody(req) as { repo?: string; url?: string; events?: string[] };
    const result = await giteaCreateWebhook(String(repo ?? ''), String(target ?? ''), events);
    if (result.ok) auditLogger.log({ actor: 'USER', event: 'gitea:hook:created', payload: { repo, url: target } });
    json(result.ok ? 201 : 502, result);
    return true;
  }

  return false;
}

/**
 * Manipulador compartilhado das rotas de Port & Process Guardian.
 * Inventário de portas/processos, MCPs do registro e ações de parar/reiniciar.
 */
async function handlePorts(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  url: string,
  method: string,
): Promise<boolean> {
  const registry = loadRegistry('.');
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  // GET /api/ports — inventário real de portas em escuta (netstat/ss)
  if (url === '/api/ports' && method === 'GET') {
    try {
      const ports = scanPorts().filter(p => p.state === 'LISTEN');
      const registryMap = (registry as McpRegistry).port_allocations ?? {};
      const enriched = ports.map(p => ({
        port: p.port,
        pid: p.pid,
        address: p.address,
        protocol: p.protocol,
        owner: registryMap[String(p.port)] ?? null,
      })).filter(p => p.port !== 0).sort((a, b) => a.port - b.port);
      json(200, { ports: enriched, total: enriched.length, registry: registryMap });
      return true;
    } catch (err) { json(500, { error: String(err) }); return true; }
  }

  // GET /api/mcps — lista de MCPs registrados no mcp-registry.json
  if (url === '/api/mcps' && method === 'GET') {
    json(200, { servers: (registry as McpRegistry).servers ?? [], version: (registry as McpRegistry).version });
    return true;
  }

  // GET /api/processes — processos relevantes (node/python) em execução
  if (url === '/api/processes' && method === 'GET') {
    try {
      let procs: { pid: string; command: string }[] = [];
      if (process.platform === 'win32') {
        const raw = require('node:child_process').execSync('tasklist /FO CSV /NH', { encoding: 'utf8' });
        procs = raw.split('\n').map(function(l: string){ return l.trim(); }).filter(Boolean).map(function(l: string){
          var m = l.match(/^"([^"]+)","(\d+)"/);
          if (!m) return null;
          var name = m[1].toLowerCase();
          if (name.indexOf('node') === -1 && name.indexOf('python') === -1) return null;
          return { pid: m[2], command: m[1] };
        }).filter(Boolean);
      } else {
        const raw = require('node:child_process').execSync('ps -eo pid,comm,args', { encoding: 'utf8' });
        procs = raw.split('\n').map(function(l: string){ return l.trim(); }).filter(Boolean).map(function(l: string){
          var m = l.match(/^(\d+)\s+\S+\s+(.+)$/);
          if (!m) return null;
          var name = m[1] + ' ' + m[2];
          if (name.toLowerCase().indexOf('node') === -1 && name.toLowerCase().indexOf('python') === -1) return null;
          return { pid: m[1], command: m[2].slice(0, 200) };
        }).filter(Boolean);
      }
      json(200, { processes: procs });
      return true;
    } catch (err) { json(200, { processes: [] }); return true; }
  }

  // POST /api/processes/kill - encerra um processo por PID
  if (url === '/api/processes/kill' && method === 'POST') {
    try {
      const body = await readBody(req) as { pid?: string };
      if (!body.pid) { json(400, { error: 'pid é obrigatório' }); return true; }
      const { execSync } = require('node:child_process');
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${body.pid}`, { stdio: 'pipe' });
      } else {
        execSync(`kill -9 ${body.pid}`, { stdio: 'pipe' });
      }
      auditLogger.log({ actor: 'USER', event: 'process:kill:approved', payload: { pid: body.pid } });
      json(200, { ok: true, killed: body.pid });
      return true;
    } catch (err) { json(500, { error: String(err) }); return true; }
  }

  // POST /api/processes/restart - reinicia um processo
  if (url === '/api/processes/restart' && method === 'POST') {
    try {
      const body = await readBody(req) as { pid?: string; command?: string };
      if (!body.pid) { json(400, { error: 'pid é obrigatório' }); return true; }
      const { execSync } = require('node:child_process');
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${body.pid}`, { stdio: 'pipe' });
      } else {
        execSync(`kill -9 ${body.pid}`, { stdio: 'pipe' });
      }
      auditLogger.log({ actor: 'USER', event: 'process:restart:approved', payload: { pid: body.pid, command: body.command } });
      json(200, { ok: true, restarted: body.pid, note: 'Processo encerrado para reinicio.' });
      return true;
    } catch (err) { json(500, { error: String(err) }); return true; }
  }

  // ── ProcessAgent: snapshot rico (PID · portas · CPU% · RAM · suspenso) ──
  if (url === '/api/processes/detail' && method === 'GET') {
    try { json(200, { snapshot: await getProcessSnapshot() }); } catch (e) { json(500, { error: String(e) }); }
    return true;
  }

  // POST /api/processes/action — fechar | pausar | retomar | reiniciar (com PIDs protegidos)
  if (url === '/api/processes/action' && method === 'POST') {
    try {
      const body = await readBody(req) as { pid?: number | string; action?: string; actor?: string };
      const allowed = ['fechar', 'pausar', 'retomar', 'reiniciar'];
      if (!body.pid || !body.action || !allowed.includes(body.action)) {
        json(400, { error: 'pid + action (fechar|pausar|retomar|reiniciar) obrigatórios' });
        return true;
      }
      const r = await executeProcessAction(body.pid, body.action as ProcAction, body.actor ?? 'user-ui');
      json(200, r);
    } catch (e) { json(500, { error: String(e) }); }
    return true;
  }

  // GET /api/mcps/categories — MCPs do Hermes × do OpenCode × ativos no sistema
  if (url === '/api/mcps/categories' && method === 'GET') {
    try { json(200, await getMcpCategories()); } catch (e) { json(500, { error: String(e) }); }
    return true;
  }

  // GET /api/process-agent/status — monitor + eventos + config
  if (url === '/api/process-agent/status' && method === 'GET') {
    json(200, paStatus());
    return true;
  }

  // POST /api/process-agent/config — liga/desliga o monitor e ajusta intervalos/limites
  if (url === '/api/process-agent/config' && method === 'POST') {
    try {
      const body = await readBody(req) as Partial<{ monitorEnabled: boolean; intervalSec: number; highCpu: number; highRamMB: number }>;
      const saved = savePaConfig(body);
      auditLogger.log({ actor: 'USER', event: 'process-agent:config', payload: { monitorEnabled: saved.monitorEnabled, intervalSec: saved.intervalSec } });
      json(200, { ok: true, config: saved });
    } catch (e) { json(500, { error: String(e) }); }
    return true;
  }

  return false;
}
async function bootstrap() {
  // 1) Carrega o .env do disco ANTES de qualquer leitura de env, para que as
  //    chaves gravadas pela UI (aba LiteLLM & Custos) funcionem após reinícios.
  const envInfo = await loadDotEnv();
  console.log(`[HERMES] .env carregado: ${envInfo.loaded} variável(is) de ${envInfo.path}`);

  // Wire audit logger into event bus
  eventBus.setAuditLogger(auditLogger);

  // Load MCP registry
  const registry = loadRegistry('.');
  console.log(`[HERMES] Registry loaded: ${registry.servers.length} MCPs, ${Object.keys(registry.port_allocations).length} ports allocated.`);

  // Signal ready
  // Show Agents (aba 🏢 Paperclip & Office) — assina o event bus ANTES do
  // system:ready p/ registrar o boot no feed.
  initAgentFeed();

  eventBus.publish('system:ready', { timestamp: new Date() });
  auditLogger.log({ event: 'system:boot', payload: { version: registry.version } });

  console.log('[HERMES] Core foundation online. Event bus active.');

  // Monitor de versionamento de pastas de projeto (se habilitado na config).
  initVersionAgent();

  // ProcessAgent — monitor de processos/portas em background + mapa p/ orquestrador.
  initProcessAgent();

  // ── Process Guardian API (4010) — health, status & LLM Center ──
  const apiServer = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    // Versionamento & Backup (Gitea) — mesma API nos dois servidores
    if (req.url && req.url.startsWith('/api/gitea/') && await handleGitea(req, res, req.url, req.method ?? 'GET')) return;
    // Agente de Versionamento de Projetos (Gitea local + GitHub remoto)
    if (req.url && req.url.startsWith('/api/version/') && await handleVersionAgent(req, res, req.url, req.method ?? 'GET')) return;
    // Port & Process Guardian / MCPs — inventário e ações
    if (req.url && (req.url.startsWith('/api/ports') || req.url.startsWith('/api/mcps') || req.url.startsWith('/api/processes') || req.url.startsWith('/api/process-agent')) && await handlePorts(req, res, req.url, req.method ?? 'GET')) return;
    if (req.url === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', uptime_s: Math.round(process.uptime()) }));
      return;
    }
    if (req.url === '/status') {
      res.writeHead(200);
      res.end(JSON.stringify({
        version: registry.version,
        mcps: registry.servers.length,
        ports: registry.port_allocations,
      }));
      return;
    }
    if (req.url === '/api/llm/state' && req.method === 'GET') {
      try {
        const state = await getCenterState();
        res.writeHead(200);
        res.end(JSON.stringify(state));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/llm/routing' && req.method === 'POST') {
      try {
        const raw = await new Promise<string>((resolve) => {
          let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b));
        });
        const patch = JSON.parse(raw || '{}');
        const routing = await updateRouting(patch);
        auditLogger.log({ actor: 'USER', event: 'llm:routing:updated', payload: patch });
        res.writeHead(200);
        res.end(JSON.stringify(routing));
      } catch (err) { res.writeHead(400); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/llm/test' && req.method === 'POST') {
      try {
        const { provider, env: envKey, value } = await readBody(req) as { provider?: string; env?: string; value?: string };
        if (!provider) { res.writeHead(400); res.end(JSON.stringify({ error: 'provider é obrigatório' })); return; }
        const result = await testProviderConnection(provider, envKey, value);
        auditLogger.log({ actor: 'USER', event: 'llm:provider:tested', payload: { provider: result.provider, keyEnv: result.keyEnv, connected: result.connected, httpStatus: result.httpStatus } });
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (err) { res.writeHead(400); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/llm/keys' && req.method === 'POST') {
      try {
        const { env, value } = await readBody(req) as { env?: string; value?: string };
        if (!env || !value) { res.writeHead(400); res.end(JSON.stringify({ error: 'env e value são obrigatórios' })); return; }
        const saved = await setEnvVar(env, value);
        auditLogger.log({ actor: 'USER', event: 'llm:key:saved', payload: { env: saved.env, updated: saved.updated, masked: saved.masked } });
        res.writeHead(200);
        res.end(JSON.stringify(saved));
      } catch (err) { res.writeHead(400); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/llm/models' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify({ models: LLM_MODELS }));
      return;
    }
    if (req.url && req.url.startsWith('/api/llm/explain') && req.method === 'GET') {
      try {
        const url = new URL(req.url, 'http://localhost');
        const target = url.searchParams.get('target');
        if (!target) { res.writeHead(400); res.end(JSON.stringify({ error: 'target é obrigatório' })); return; }
        const decision = await explainModel(target);
        res.writeHead(200);
        res.end(JSON.stringify(decision));
      } catch (err) { res.writeHead(400); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/llm/benchmark' && req.method === 'GET') {
      try {
        res.writeHead(200);
        res.end(JSON.stringify({ ranking: await benchmarkRanking() }));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    // ── API Keys persistidas no BD (env-db-store) ──
    if (req.url === '/api/env-db' && req.method === 'GET') {
      try {
        const settings = await getEnvSettings();
        res.writeHead(200);
        res.end(JSON.stringify(settings));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/env-db' && req.method === 'POST') {
      try {
        const { key, value } = await readBody(req) as { key?: string; value?: string };
        if (!key || !value) { res.writeHead(400); res.end(JSON.stringify({ error: 'key e value são obrigatórios' })); return; }
        const saved = await setEnvSetting(key, value);
        auditLogger.log({ actor: 'USER', event: 'env-db:saved', payload: { key: saved.key, masked: saved.masked } });
        res.writeHead(200);
        res.end(JSON.stringify(saved));
      } catch (err) { res.writeHead(400); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/env-db' && req.method === 'DELETE') {
      try {
        const { key } = await readBody(req) as { key?: string };
        if (!key) { res.writeHead(400); res.end(JSON.stringify({ error: 'key é obrigatória' })); return; }
        const deleted = await deleteEnvSetting(key);
        if (deleted) auditLogger.log({ actor: 'USER', event: 'env-db:deleted', payload: { key } });
        res.writeHead(200);
        res.end(JSON.stringify({ deleted }));
      } catch (err) { res.writeHead(400); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    // ── Histórico / Auditoria ──
    if (req.url === '/api/audit' && req.method === 'GET') {
      try {
        const limit = parseInt(new URL(req.url ?? '/', 'http://localhost').searchParams.get('limit') ?? '100', 10);
        const entries = readAuditLog(limit);
        res.writeHead(200);
        res.end(JSON.stringify({ entries, total: entries.length }));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    // ── GiteaOps Agent (subagente de versionamento) ──
    if (req.url === '/api/gitea-ops/health' && req.method === 'GET') {
      try {
        const project = new URL(req.url ?? '/', 'http://localhost').searchParams.get('project') || 'hermes';
        const agent = new GiteaOpsAgent({ projectName: project, repoName: project, description: `Projeto ${project}` });
        const health = await agent.healthCheck();
        res.writeHead(200);
        res.end(JSON.stringify(health));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/gitea-ops/bootstrap' && req.method === 'POST') {
      try {
        const { project, repo, description } = await readBody(req) as { project?: string; repo?: string; description?: string };
        const name = project || 'hermes';
        const agent = new GiteaOpsAgent({ projectName: name, repoName: repo || name, description: description || `Projeto ${name}` });
        const results = await agent.bootstrap();
        auditLogger.log({ actor: 'SUBAGENT', event: 'gitea-ops:bootstrap:api', payload: { project: name, steps: results.length } });
        res.writeHead(200);
        res.end(JSON.stringify({ results }));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/gitea-ops/commit' && req.method === 'POST') {
      try {
        const { project, message } = await readBody(req) as { project?: string; message?: string };
        const name = project || 'hermes';
        const agent = new GiteaOpsAgent({ projectName: name, repoName: name, description: `Projeto ${name}` });
        const result = await agent.autoCommit(message);
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/gitea-ops/backup' && req.method === 'POST') {
      try {
        const { project } = await readBody(req) as { project?: string };
        const name = project || 'hermes';
        const agent = new GiteaOpsAgent({ projectName: name, repoName: name, description: `Projeto ${name}` });
        const result = await agent.createFullBackup();
        auditLogger.log({ actor: 'SUBAGENT', event: 'gitea-ops:backup:api', payload: { project: name, path: result.backupPath } });
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/gitea-ops/backups' && req.method === 'GET') {
      try {
        const project = new URL(req.url ?? '/', 'http://localhost').searchParams.get('project') || 'hermes';
        const agent = new GiteaOpsAgent({ projectName: project, repoName: project, description: `Projeto ${project}` });
        const backups = agent.listBackups();
        res.writeHead(200);
        res.end(JSON.stringify({ backups }));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/gitea-ops/restore' && req.method === 'POST') {
      try {
        const { project, bundle } = await readBody(req) as { project?: string; bundle?: string };
        const agent = new GiteaOpsAgent({ projectName: project || 'hermes', repoName: project || 'hermes', description: '' });
        const result = agent.restoreBackup(bundle || '');
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  // ── Event Bus / Web Dashboard (4020) ──
  const dashboardServer = createServer(async (req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      try {
        const html = await readFile(UI_PATH);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch {
        res.writeHead(500);
        res.end('dashboard ui not found');
      }
      return;
    }
    // Servir arquivos estáticos da UI (JS, CSS) — ex: /historico.js → src/ui/historico.js
    if (req.url && !req.url.startsWith('/api/') && /\.(js|css|png|svg|ico)$/.test(req.url)) {
      try {
        const filePath = join(process.cwd(), 'src', 'ui', req.url);
        const content = await readFile(filePath);
        const mime: Record<string, string> = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
        const ext = req.url.slice(req.url.lastIndexOf('.'));
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
      return;
    }
    // Versionamento & Backup (Gitea) — mesma API nos dois servidores
    if (req.url && req.url.startsWith('/api/gitea/') && await handleGitea(req, res, req.url, req.method ?? 'GET')) return;
    // Agente de Versionamento de Projetos (Gitea local + GitHub remoto)
    if (req.url && req.url.startsWith('/api/version/') && await handleVersionAgent(req, res, req.url, req.method ?? 'GET')) return;
    // Port & Process Guardian / MCPs — inventário e ações
    if (req.url && (req.url.startsWith('/api/ports') || req.url.startsWith('/api/mcps') || req.url.startsWith('/api/processes') || req.url.startsWith('/api/process-agent')) && await handlePorts(req, res, req.url, req.method ?? 'GET')) return;
    // OpenCode (IDE multi-agente) — ponte para o servidor headless local (:4196)
    if (req.url && req.url.startsWith('/api/opencode/') && await handleOpencode(req, res, req.url, req.method ?? 'GET')) return;
    // Previews — navegador de arquivos + visualizador universal (pdf/md/docx/media/html)
    if (req.url && req.url.startsWith('/api/preview/') && await handlePreview(req, res, req.url, req.method ?? 'GET')) return;
    // Agente Pesquisador — scraping anti-detecção (curl_cffi) + search APIs
    if (req.url && req.url.startsWith('/api/researcher/') && await handleResearchRoutes(req, res, req.url)) return;
    // Orquestrador real — switches de capacidade (pesquisa/CRM/site profissional)
    if (req.url && req.url.startsWith('/api/orchestrator/') && await handleOrchestratorRoutes(req, res, req.url)) return;
    // Mapas de código (Archify) — memória de contexto arquitetura→código
    if (req.url && req.url.startsWith('/api/code-map/') && await handleCodeMapRoutes(req, res, req.url)) return;
    // Show Agents (aba 🏢 Paperclip & Office) — agentes reais + feed ao vivo
    if (req.url && req.url.startsWith('/api/paperclip/') && await handlePaperclipRoutes(req, res, req.url)) return;
    // Memória de contexto por projeto (pgvector) — continuidade entre sessões/LLMs
    if (req.url && req.url.startsWith('/api/memory/') && await handleMemoryRoutes(req, res, req.url)) return;
    // Análise de mercado — pipeline web+notícias+Reddit → dashboard HTML interativo
    if (req.url && req.url.startsWith('/api/market') && await handleMarketRoutes(req, res, req.url)) return;
    // Otimizador de Prompts — intent→análise fria→pesquisa→expansão→otimização
    if (req.url && req.url.startsWith('/api/optimizer/') && await handleOptimizerRoutes(req, res, req.url)) return;
    // Deploy Agent — classificação, ranking, guia, computer use e pós-deploy
    if (req.url && req.url.startsWith('/api/deploy/') && await handleDeployRoutes(req, res, req.url)) return;
    // Automação N8N — wizard guiado, design de workflows, score, templates e chat
    if (req.url && req.url.startsWith('/api/n8n/') && await handleN8nRoutes(req, res, req.url)) return;
    // LLM Center API (same-origin for the dashboard UI; secrets stay masked)
    if (req.url === '/api/llm/state' && req.method === 'GET') {
      try {
        const state = await getCenterState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/llm/routing' && req.method === 'POST') {
      try {
        const raw = await new Promise<string>((resolve) => {
          let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b));
        });
        const patch = JSON.parse(raw || '{}');
        const routing = await updateRouting(patch);
        auditLogger.log({ actor: 'USER', event: 'llm:routing:updated', payload: patch });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(routing));
      } catch (err) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/llm/test' && req.method === 'POST') {
      try {
        const { provider, env: envKey, value } = await readBody(req) as { provider?: string; env?: string; value?: string };
        if (!provider) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'provider é obrigatório' })); return; }
        const result = await testProviderConnection(provider, envKey, value);
        auditLogger.log({ actor: 'USER', event: 'llm:provider:tested', payload: { provider: result.provider, keyEnv: result.keyEnv, connected: result.connected, httpStatus: result.httpStatus } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/llm/keys' && req.method === 'POST') {
      try {
        const { env, value } = await readBody(req) as { env?: string; value?: string };
        if (!env || !value) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'env e value são obrigatórios' })); return; }
        const saved = await setEnvVar(env, value);
        auditLogger.log({ actor: 'USER', event: 'llm:key:saved', payload: { env: saved.env, updated: saved.updated, masked: saved.masked } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(saved));
      } catch (err) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url && req.url.startsWith('/api/llm/explain') && req.method === 'GET') {
      try {
        const url = new URL(req.url, 'http://localhost');
        const target = url.searchParams.get('target');
        if (!target) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'target é obrigatório' })); return; }
        const decision = await explainModel(target);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(decision));
      } catch (err) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/llm/benchmark' && req.method === 'GET') {
      try {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ranking: await benchmarkRanking() }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    // ── API Keys persistidas no BD (env-db-store) ──
    if (req.url === '/api/env-db' && req.method === 'GET') {
      try {
        const settings = await getEnvSettings();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(settings));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/env-db' && req.method === 'POST') {
      try {
        const { key, value } = await readBody(req) as { key?: string; value?: string };
        if (!key || !value) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'key e value são obrigatórios' })); return; }
        const saved = await setEnvSetting(key, value);
        auditLogger.log({ actor: 'USER', event: 'env-db:saved', payload: { key: saved.key, masked: saved.masked } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(saved));
      } catch (err) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/env-db' && req.method === 'DELETE') {
      try {
        const { key } = await readBody(req) as { key?: string };
        if (!key) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'key é obrigatória' })); return; }
        const deleted = await deleteEnvSetting(key);
        if (deleted) auditLogger.log({ actor: 'USER', event: 'env-db:deleted', payload: { key } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ deleted }));
      } catch (err) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    // ── Histórico / Auditoria ──
    if (req.url === '/api/audit' && req.method === 'GET') {
      try {
        const limit = parseInt(new URL(req.url ?? '/', 'http://localhost').searchParams.get('limit') ?? '100', 10);
        const entries = readAuditLog(limit);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ entries, total: entries.length }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    // ── GiteaOps Agent (subagente de versionamento) ──
    if (req.url === '/api/gitea-ops/health' && req.method === 'GET') {
      try {
        const project = new URL(req.url ?? '/', 'http://localhost').searchParams.get('project') || 'hermes';
        const agent = new GiteaOpsAgent({ projectName: project, repoName: project, description: `Projeto ${project}` });
        const health = await agent.healthCheck();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/gitea-ops/bootstrap' && req.method === 'POST') {
      try {
        const { project, repo, description } = await readBody(req) as { project?: string; repo?: string; description?: string };
        const name = project || 'hermes';
        const agent = new GiteaOpsAgent({ projectName: name, repoName: repo || name, description: description || `Projeto ${name}` });
        const results = await agent.bootstrap();
        auditLogger.log({ actor: 'SUBAGENT', event: 'gitea-ops:bootstrap:api', payload: { project: name, steps: results.length } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/gitea-ops/commit' && req.method === 'POST') {
      try {
        const { project, message } = await readBody(req) as { project?: string; message?: string };
        const name = project || 'hermes';
        const agent = new GiteaOpsAgent({ projectName: name, repoName: name, description: `Projeto ${name}` });
        const result = await agent.autoCommit(message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/gitea-ops/backup' && req.method === 'POST') {
      try {
        const { project } = await readBody(req) as { project?: string };
        const name = project || 'hermes';
        const agent = new GiteaOpsAgent({ projectName: name, repoName: name, description: `Projeto ${name}` });
        const result = await agent.createFullBackup();
        auditLogger.log({ actor: 'SUBAGENT', event: 'gitea-ops:backup:api', payload: { project: name, path: result.backupPath } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/gitea-ops/backups' && req.method === 'GET') {
      try {
        const project = new URL(req.url ?? '/', 'http://localhost').searchParams.get('project') || 'hermes';
        const agent = new GiteaOpsAgent({ projectName: project, repoName: project, description: `Projeto ${project}` });
        const backups = agent.listBackups();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ backups }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    if (req.url === '/api/gitea-ops/restore' && req.method === 'POST') {
      try {
        const { project, bundle } = await readBody(req) as { project?: string; bundle?: string };
        const agent = new GiteaOpsAgent({ projectName: project || 'hermes', repoName: project || 'hermes', description: '' });
        const result = agent.restoreBackup(bundle || '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(err) })); }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  dashboardServer.listen(DASHBOARD_PORT, () => {
    console.log(`[HERMES] Web Dashboard listening on :${DASHBOARD_PORT}`);
  });
  apiServer.listen(PROCESS_API_PORT, () => {
    console.log(`[HERMES] Process Guardian API listening on :${PROCESS_API_PORT}`);
  });

  // ── Telegram Bridge (real polling, optional) ──
  const telegram = new TelegramBridge(process.env.TELEGRAM_ALLOWED_CHAT_ID ?? '');
  if (telegram.isConfigured) {
    const llmBase = process.env.LITELLM_BASE_URL ?? 'http://litellm:4000';
    const llmKey = process.env.LITELLM_MASTER_KEY ?? '';

    // Responde comandos simples e encaminha o resto para o LiteLLM
    telegram
      .startPolling(async (req) => {
        const text = req.prompt.trim();
        if (text === '/start' || text === '/help') {
          return '🤖 *Hermes Control Center*\n\nComandos:\n/status — status do sistema\n/conectar <serviço> — gerar link OAuth (ex: /conectar instagram)\n/postar <url_imagem> | <legenda> — publicar foto no Instagram\n/help — esta ajuda\n\nQualquer outra mensagem é encaminhada ao orquestrador Hermes (via LiteLLM).';
        }
        const composioCmd = new ComposioAgent();
        if (text.startsWith('/conectar')) {
          const svc = text.replace('/conectar', '').trim().toLowerCase();
          if (!svc) return 'Uso: /conectar <serviço>\nExemplo: /conectar instagram';
          if (!composioCmd.isConfigured) return '⚠️ COMPOSIO_API_KEY não configurada no .env.';
          const r = await composioCmd.connectToolkit(svc);
          if (r.connected) return `✅ ${r.message}`;
          return r.redirectUrl
            ? `🔗 Para conectar o *${svc}*, abra este link e autorize:\n\n${r.redirectUrl}\n\nDepois me avise com /status ${svc} ou tente o comando novamente.`
            : `⚠️ ${r.message}`;
        }
        if (text.startsWith('/postar')) {
          const payload = text.replace('/postar', '').trim();
          const sep = payload.indexOf('|');
          const imageUrl = (sep >= 0 ? payload.slice(0, sep) : payload).trim();
          const caption = sep >= 0 ? payload.slice(sep + 1).trim() : undefined;
          if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
            return 'Uso: /postar <url_publica_da_imagem> | <legenda opcional>\nExemplo: /postar https://meusite.com/foto.jpg | Lançamento novo!';
          }
          if (!composioCmd.isConfigured) return '⚠️ COMPOSIO_API_KEY não configurada no .env.';
          const r = await composioCmd.postInstagramImage({ imageUrl, caption });
          return r.message;
        }
        if (text.startsWith('/status')) {
          const arg = text.replace('/status', '').trim().toLowerCase();
          if (arg) {
            if (!composioCmd.isConfigured) return '⚠️ COMPOSIO_API_KEY não configurada no .env.';
            const st = await composioCmd.getToolkitStatus(arg);
            return st.connected
              ? `✅ *${arg}*: conectado (conta ${st.connectedAccountId}).`
              : `❌ *${arg}*: não conectado.\n${st.message}`;
          }
          const q = telegram.getQueueStatus();
          const composio = new ComposioAgent();
          const compStatus = composio.isConfigured ? 'configurada' : 'AUSENTE';
          return `📊 *Hermes Status*\n• Uptime: ${Math.round(process.uptime())}s\n• Fila Telegram: ${q.pendingCount} pendente(s)\n• Composio API key: ${compStatus}`;
        }

        // Encaminha para o gateway LiteLLM (modelo do roteamento manual/auto + fallbacks)
        const preferred = await resolveModel('telegram');
        const llmModels = [preferred, process.env.TELEGRAM_LLM_MODEL ?? 'deepseek-code', 'gemini-flash', 'deepseek-code'].filter(
          (m, i, arr) => m && arr.indexOf(m) === i,
        );
        let lastErr = '';
        for (const model of llmModels) {
          try {
            const res = await fetch(`${llmBase}/v1/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmKey}` },
              body: JSON.stringify({
                model,
                messages: [
                  { role: 'system', content: "Você é o Hermes, assistente técnico do DevMaster. Responda de forma direta e concisa em português." },
                  { role: 'user', content: text },
                ],
                max_tokens: 1024,
              }),
            });
            if (!res.ok) {
              const snippet = (await res.text()).slice(0, 200);
              console.error(`[TELEGRAM] LiteLLM modelo ${model} -> HTTP ${res.status}: ${snippet}`);
              lastErr = `HTTP ${res.status} no modelo ${model}`;
              continue;
            }
            const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
            const reply = data.choices?.[0]?.message?.content?.trim();
            if (reply) return reply;
            lastErr = `resposta vazia do modelo ${model}`;
          } catch (err) {
            lastErr = err instanceof Error ? err.message : String(err);
            console.error(`[TELEGRAM] Erro de rede no modelo ${model}:`, lastErr);
          }
        }
        return `⚠️ Nenhum modelo do gateway respondeu (último erro: ${lastErr}). Tente novamente em instantes.`;
      })
      .catch((err) => console.error('[TELEGRAM] Polling encerrado com erro:', err));
  } else {
    console.log('[TELEGRAM] Bridge desativado: defina TELEGRAM_BOT_TOKEN no .env para ativar.');
  }

  // ── Composio API key validation (async, non-blocking) ──
  const composio = new ComposioAgent();
  composio
    .validateApiKey()
    .then((r) => console.log(`[COMPOSIO] ${r.valid ? '✅' : '⚠️'} ${r.message}`))
    .catch((err) => console.error('[COMPOSIO] Erro na validação:', err));
}

bootstrap().catch((err) => {
  console.error('[HERMES FATAL]', err);
  process.exit(1);
});

