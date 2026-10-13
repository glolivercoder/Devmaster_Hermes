/**
 * TDD — Module 02: Port Inventory & Process Guardian Tests
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProcessGuardian } from '../src/guardian/process-guardian.js';
import { scanPorts, pidOnPort } from '../src/guardian/port-inventory.js';
import { McpRegistry } from '../src/core/registry.js';

const mockRegistry: McpRegistry = {
  version: '1.0.0',
  servers: [],
  port_allocations: {
    '4000': 'LiteLLM Gateway',
    '4010': 'Hermes Process Manager',
  },
};

test('port-inventory: scanPorts returns array of PortEntry without throwing', () => {
  const ports = scanPorts();
  assert.ok(Array.isArray(ports));
});

test('ProcessGuardian: checks port availability or conflict', () => {
  const guardian = new ProcessGuardian(mockRegistry);
  
  // Unused high port should typically be free
  const freePort = 59123;
  const conflict = guardian.checkPort(freePort, 'test-service');
  assert.equal(conflict, null, 'Unused port should return null (no conflict)');
});

test('ProcessGuardian: requestPermission creates request and can be resolved', () => {
  const guardian = new ProcessGuardian(mockRegistry);
  
  const req = guardian.requestPermission(
    4000,
    9999,
    'LiteLLM Gateway',
    'KILL',
    'Terminate zombie instance to free port'
  );

  assert.ok(req.requestId.startsWith('perm-'));
  assert.equal(req.port, 4000);
  assert.equal(req.riskLevel, 'HIGH');

  // Resolving permission
  const approved = guardian.resolvePermission(req.requestId, 'APPROVED', 'User authorized via UI');
  assert.equal(approved, true);

  // Resolving again returns false (already resolved)
  const duplicate = guardian.resolvePermission(req.requestId, 'APPROVED');
  assert.equal(duplicate, false);
});

test('ProcessGuardian: tracks Hermes-owned PIDs with LOW risk level', () => {
  const guardian = new ProcessGuardian(mockRegistry);
  guardian.trackHermesPid(8888);

  const req = guardian.requestPermission(
    4010,
    8888,
    'Hermes Process Manager',
    'STOP',
    'Shutdown internal Hermes process'
  );

  assert.equal(req.riskLevel, 'LOW');
});

test('ProcessGuardian: findAvailablePort finds a usable port', () => {
  const guardian = new ProcessGuardian(mockRegistry);
  const port = guardian.findAvailablePort(45000);
  assert.ok(port >= 45000);
  assert.equal(pidOnPort(port), null);
});
