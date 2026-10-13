/**
 * TDD — Module 00: Core Foundation Tests
 * Red/Green cycle per Superpowers methodology.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuditLogger } from '../src/core/audit-logger.js';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';

// ─── AuditLogger ─────────────────────────────────────────────────────────────

test('AuditLogger: creates log dir and writes JSONL entry', () => {
  const logDir = 'tests/tmp-logs';
  const logger = new AuditLogger(logDir);

  logger.log({ event: 'test:event', payload: { foo: 'bar' } });

  const lines = readFileSync(`${logDir}/audit.jsonl`, 'utf8').trim().split('\n');
  const last = JSON.parse(lines.at(-1)!);

  assert.equal(last.event, 'test:event');
  assert.deepEqual(last.payload, { foo: 'bar' });
  assert.ok(last.ts, 'ts present');
  assert.equal(last.actor, 'SYSTEM');

  // cleanup
  unlinkSync(`${logDir}/audit.jsonl`);
});

test('AuditLogger: logPermission records decision', () => {
  const logDir = 'tests/tmp-logs2';
  const logger = new AuditLogger(logDir);

  logger.logPermission({
    actor: 'GUARDIAN',
    action: 'stop',
    target: 'hermes-process-manager:4010',
    decision: 'DENIED',
    reason: 'User did not respond within 30s',
  });

  const lines = readFileSync(`${logDir}/audit.jsonl`, 'utf8').trim().split('\n');
  const last = JSON.parse(lines.at(-1)!);

  assert.equal(last.event, 'permission:denied');
  assert.equal(last.payload.decision, 'DENIED');

  unlinkSync(`${logDir}/audit.jsonl`);
});

// ─── Registry ────────────────────────────────────────────────────────────────

test('loadRegistry: parses mcp-registry.json', async () => {
  const { loadRegistry, portOwner } = await import('../src/core/registry.js');
  const registry = loadRegistry('.');

  assert.ok(registry.servers.length > 0, 'servers present');
  assert.ok(Object.keys(registry.port_allocations).length > 0, 'ports allocated');

  const owner = portOwner(registry, 4000);
  assert.ok(owner?.includes('LiteLLM'), `expected LiteLLM owner for 4000, got: ${owner}`);
});

test('portOwner: returns null for unregistered port', async () => {
  const { loadRegistry, portOwner } = await import('../src/core/registry.js');
  const registry = loadRegistry('.');
  assert.equal(portOwner(registry, 9999), null);
});

// ─── Event Bus ───────────────────────────────────────────────────────────────

test('EventBus: publish and subscribe round-trip', async () => {
  const { eventBus } = await import('../src/core/event-bus.js');

  let received: { timestamp: Date } | null = null;
  const unsub = eventBus.subscribe('system:ready', (p) => { received = p; });

  eventBus.publish('system:ready', { timestamp: new Date() });

  assert.ok(received !== null, 'payload received');
  unsub();
});

