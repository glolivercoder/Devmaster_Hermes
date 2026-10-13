/**
 * TDD — Module 01: LiteLLM Gateway Client Tests
 * Uses mock fetch — gateway doesn't need to be running.
 */

import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { GatewayClient } from '../src/gateway/gateway-client.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function mockFetch(body: unknown, status = 200) {
  return mock.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('GatewayClient.isHealthy: returns true on 200', async () => {
  const client = new GatewayClient('http://localhost:4000', 'sk-master');
  // @ts-ignore mock fetch
  globalThis.fetch = mockFetch({}, 200);

  const result = await client.isHealthy();
  assert.equal(result, true);
});

test('GatewayClient.isHealthy: returns false on network error', async () => {
  const client = new GatewayClient('http://localhost:4000', 'sk-master');
  // @ts-ignore mock
  globalThis.fetch = mock.fn(async () => { throw new Error('ECONNREFUSED'); });

  const result = await client.isHealthy();
  assert.equal(result, false);
});

test('GatewayClient.complete: parses response and publishes cost event', async () => {
  const client = new GatewayClient('http://localhost:4000', 'sk-master');

  const fakeResponse = {
    choices: [{ message: { content: 'Bug in auth middleware. Fix token expiry.' } }],
    model: 'claude-code',
    usage: { total_tokens: 120 },
    _hidden_params: { response_cost: 0.0018 },
  };
  // @ts-ignore mock
  globalThis.fetch = mockFetch(fakeResponse);

  const result = await client.complete({
    model: 'claude-code',
    messages: [{ role: 'user', content: 'Fix the auth bug.' }],
    virtualKey: 'sk-virtual-module-00',
  });

  assert.equal(result.content, 'Bug in auth middleware. Fix token expiry.');
  assert.equal(result.tokensUsed, 120);
  assert.equal(result.costUsd, 0.0018);
});

test('GatewayClient.complete: throws on non-200 status', async () => {
  const client = new GatewayClient('http://localhost:4000', 'sk-master');
  // @ts-ignore mock
  globalThis.fetch = mockFetch({ error: 'Budget exceeded' }, 429);

  await assert.rejects(
    () => client.complete({
      model: 'claude-code',
      messages: [{ role: 'user', content: 'test' }],
      virtualKey: 'sk-virtual-test',
    }),
    /LiteLLM \[429\]/
  );
});

test('GatewayClient.createVirtualKey: returns key string', async () => {
  const client = new GatewayClient('http://localhost:4000', 'sk-master');
  // @ts-ignore mock
  globalThis.fetch = mockFetch({ key: 'sk-virtual-abc123' });

  const key = await client.createVirtualKey({
    alias: 'module-orchestrator',
    models: ['claude-code', 'gemini-flash'],
    maxBudgetUsd: 5.0,
  });

  assert.equal(key, 'sk-virtual-abc123');
});

test('GatewayClient.keyInfo: maps response to VirtualKeyInfo', async () => {
  const client = new GatewayClient('http://localhost:4000', 'sk-master');
  // @ts-ignore mock
  globalThis.fetch = mockFetch({
    info: {
      key: 'sk-virtual-abc123',
      spend: 1.23,
      max_budget: 5.0,
      models: ['claude-code'],
      metadata: { tags: ['orchestrator'] },
    },
  });

  const info = await client.keyInfo('sk-virtual-abc123');
  assert.equal(info.spend, 1.23);
  assert.equal(info.maxBudget, 5.0);
  assert.deepEqual(info.tags, ['orchestrator']);
});
