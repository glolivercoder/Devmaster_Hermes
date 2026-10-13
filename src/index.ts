/**
 * Hermes Control Center — Entry Point
 * Module 00: Foundation bootstrap
 */

import { auditLogger } from './core/audit-logger.js';
import { eventBus } from './core/event-bus.js';
import { loadRegistry } from './core/registry.js';

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
}

bootstrap().catch((err) => {
  console.error('[HERMES FATAL]', err);
  process.exit(1);
});

