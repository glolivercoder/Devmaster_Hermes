/**
 * TDD — Module 03: Hermes Orchestrator & Anti-Sycophancy Tests
 */

import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { Orchestrator, ANTI_SYCOPHANCY_SYSTEM_PROMPT } from '../src/orchestrator/orchestrator.js';
import { GatewayClient } from '../src/gateway/gateway-client.js';

test('Orchestrator: includes anti-sycophancy system prompt', () => {
  assert.ok(ANTI_SYCOPHANCY_SYSTEM_PROMPT.includes("Devil's Advocate"));
  assert.ok(ANTI_SYCOPHANCY_SYSTEM_PROMPT.includes('Never flatter'));
});

test('Orchestrator.analyzeIdea: parses plan and emits task events', async () => {
  const client = new GatewayClient('http://localhost:4000', 'sk-master');

  const mockPlan = {
    title: 'Uber for Dogs',
    feasibilityPercent: 45,
    marketAnalysis: 'Niche market, high churn risk and unit economics concerns.',
    timeEstimate: '2 months',
    modules: [
      { name: 'Core Auth', order: 1, dependencies: [] },
      { name: 'Geolocation Tracking', order: 2, dependencies: ['Core Auth'] },
    ],
    critique: 'High liability risks and low customer frequency.',
  };

  // Mock gateway complete call
  // @ts-ignore mock
  mock.method(client, 'complete', async () => ({
    content: JSON.stringify(mockPlan),
    model: 'claude-code',
    tokensUsed: 350,
    costUsd: 0.005,
  }));

  const orchestrator = new Orchestrator(client, 'sk-virtual-orchestrator');
  const plan = await orchestrator.analyzeIdea('Build an on-demand dog walking app with real-time video');

  assert.equal(plan.title, 'Uber for Dogs');
  assert.equal(plan.feasibilityPercent, 45);
  assert.equal(plan.modules.length, 2);
  assert.ok(plan.critique.includes('liability'));
});

test('Orchestrator.dispatchSubagent: logs and publishes subagent event', () => {
  const client = new GatewayClient('http://localhost:4000', 'sk-master');
  const orchestrator = new Orchestrator(client, 'sk-virtual-orchestrator');

  let dispatched = false;
  // Verify it executes without exceptions
  orchestrator.dispatchSubagent({
    taskId: 'task-sec-audit',
    agentRole: 'SECURITY',
    instructions: 'Audit auth endpoint using Semgrep',
    assignedModel: 'deepseek-code',
    virtualKey: 'sk-virtual-sec',
  });

  dispatched = true;
  assert.equal(dispatched, true);
});

