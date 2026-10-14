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

const PROCESS_API_PORT = 4010;   // Process Guardian API (health/status)
const DASHBOARD_PORT = 4020;     // Event Bus / Web Dashboard
const UI_PATH = join(process.cwd(), 'src', 'ui', 'index.html');

async function bootstrap() {
  // Wire audit logger into event bus
  eventBus.setAuditLogger(auditLogger);

  // Load MCP registry
  const registry = loadRegistry('.');
  console.log(`[HERMES] Registry loaded: ${registry.servers.length} MCPs, ${Object.keys(registry.port_allocations).length} ports allocated.`);

  // Signal ready
  eventBus.publish('system:ready', { timestamp: new Date() });
  auditLogger.log({ event: 'system:boot', payload: { version: registry.version } });

  console.log('[HERMES] Core foundation online. Event bus active.');

  // ── Process Guardian API (4010) — health & status endpoints ──
  const apiServer = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
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
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });
  apiServer.listen(PROCESS_API_PORT, () => {
    console.log(`[HERMES] Process Guardian API listening on :${PROCESS_API_PORT}`);
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
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  dashboardServer.listen(DASHBOARD_PORT, () => {
    console.log(`[HERMES] Web Dashboard listening on :${DASHBOARD_PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('[HERMES FATAL]', err);
  process.exit(1);
});

