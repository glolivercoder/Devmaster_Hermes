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
          return '🤖 *Hermes Control Center*\n\nComandos:\n/status — status do sistema\n/help — esta ajuda\n\nQualquer outra mensagem é encaminhada ao orquestrador Hermes (via LiteLLM).';
        }
        if (text === '/status') {
          const q = telegram.getQueueStatus();
          const composio = new ComposioAgent();
          const compStatus = composio.isConfigured ? 'configurada' : 'AUSENTE';
          return `📊 *Hermes Status*\n• Uptime: ${Math.round(process.uptime())}s\n• Fila Telegram: ${q.pendingCount} pendente(s)\n• Composio API key: ${compStatus}`;
        }

        // Encaminha para o gateway LiteLLM (com fallback entre modelos)
        const llmModels = [process.env.TELEGRAM_LLM_MODEL ?? 'deepseek-code', 'gemini-flash', 'claude-fast'].filter(
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

