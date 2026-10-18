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

test('Orchestrator.dispatchSubagent: executes task with assigned model and key', async () => {
  const client = new GatewayClient('http://localhost:4000', 'sk-master');
  let request: { model: string; virtualKey: string } | undefined;
  // @ts-ignore mock
  mock.method(client, 'complete', async (req) => {
    request = req;
    return { content: 'Audit complete.', model: req.model, tokensUsed: 10, costUsd: 0 };
  });
  const orchestrator = new Orchestrator(client, 'sk-virtual-orchestrator');

  const result = await orchestrator.dispatchSubagent({
    taskId: 'task-sec-audit',
    agentRole: 'SECURITY',
    instructions: 'Audit auth endpoint using Semgrep',
    assignedModel: 'deepseek-code',
    virtualKey: 'sk-virtual-sec',
  });

  assert.equal(request?.model, 'deepseek-code');
  assert.equal(request?.virtualKey, 'sk-virtual-sec');
  assert.equal(result.content, 'Audit complete.');
  assert.equal(result.agentRole, 'SECURITY');
  assert.ok(result.durationMs >= 0);
});

test('Orchestrator.analyzeIdea: rejects invalid model output instead of inventing metrics', async () => {
  const client = new GatewayClient('http://localhost:4000', 'sk-master');
  // @ts-ignore mock
  mock.method(client, 'complete', async () => ({
    content: 'This seems feasible in about three weeks.',
    model: 'claude-code',
    tokensUsed: 20,
    costUsd: 0,
  }));
  const orchestrator = new Orchestrator(client, 'sk-virtual-orchestrator');

  await assert.rejects(orchestrator.analyzeIdea('Build an app'), /did not return a JSON TaskPlan/);
});

test('Orchestrator.executePlan: honors dependencies and returns delegated outputs', async () => {
  const client = new GatewayClient('http://localhost:4000', 'sk-master');
  const started: string[] = [];
  const received = new Map<string, string>();
  // @ts-ignore mock
  mock.method(client, 'complete', async (req) => {
    const task = String(req.messages[1].content);
    const name = /Assigned module: ([^\n]+)/.exec(task)?.[1] ?? 'unknown';
    started.push(name);
    received.set(name, task);
    return { content: `Output for ${name}`, model: req.model, tokensUsed: 10, costUsd: 0 };
  });
  const orchestrator = new Orchestrator(client, 'sk-virtual-orchestrator');
  const plan = {
    title: 'Example',
    feasibilityPercent: 50,
    marketAnalysis: 'Unknown',
    timeEstimate: 'Unknown',
    critique: 'Risks remain.',
    modules: [
      { name: 'Foundation', order: 1, dependencies: [] },
      { name: 'API', order: 2, dependencies: ['Foundation'] },
    ],
  };

  const results = await orchestrator.executePlan(plan, 'Build an app', async (module, taskId) => ({
    taskId,
    agentRole: 'CODER',
    instructions: module.name,
    assignedModel: 'deepseek-code',
    virtualKey: 'sk-virtual-coder',
  }));

  assert.deepEqual(started, ['Foundation', 'API']);
  assert.deepEqual(results.map((result) => result.status), ['completed', 'completed']);
  assert.match(received.get('API') ?? '', /Output for Foundation/);
  assert.match(results[1].result?.content ?? '', /Output for API/);
});

test('Orchestrator.executePlan: blocks dependent work after failure', async () => {
  const client = new GatewayClient('http://localhost:4000', 'sk-master');
  // @ts-ignore mock
  mock.method(client, 'complete', async (req) => {
    if (req.messages[1].content.includes('Assigned module: Foundation')) throw new Error('provider unavailable');
    return { content: 'Independent output', model: req.model, tokensUsed: 10, costUsd: 0 };
  });
  const orchestrator = new Orchestrator(client, 'sk-virtual-orchestrator');
  const plan = {
    title: 'Example',
    feasibilityPercent: 50,
    marketAnalysis: 'Unknown',
    timeEstimate: 'Unknown',
    critique: 'Risks remain.',
    modules: [
      { name: 'Foundation', order: 1, dependencies: [] },
      { name: 'API', order: 2, dependencies: ['Foundation'] },
      { name: 'Docs', order: 3, dependencies: [] },
    ],
  };
  const results = await orchestrator.executePlan(plan, 'Build an app', async (module, taskId) => ({
    taskId,
    agentRole: 'CODER',
    instructions: module.name,
    assignedModel: 'deepseek-code',
    virtualKey: 'sk-virtual-coder',
  }));

  assert.deepEqual(results.map((result) => result.status), ['failed', 'blocked', 'completed']);
  assert.match(results[1].error ?? '', /Foundation/);
});

test('Orchestrator.executePlan: rejects dependency cycles before dispatch', async () => {
  const client = new GatewayClient('http://localhost:4000', 'sk-master');
  let dispatched = false;
  // @ts-ignore mock
  mock.method(client, 'complete', async () => {
    dispatched = true;
    return { content: 'unused', model: 'deepseek-code', tokensUsed: 0, costUsd: 0 };
  });
  const orchestrator = new Orchestrator(client, 'sk-virtual-orchestrator');
  const plan = {
    title: 'Invalid',
    feasibilityPercent: 50,
    marketAnalysis: 'Unknown',
    timeEstimate: 'Unknown',
    critique: 'Invalid dependency graph.',
    modules: [
      { name: 'A', order: 1, dependencies: ['B'] },
      { name: 'B', order: 2, dependencies: ['A'] },
    ],
  };

  await assert.rejects(
    orchestrator.executePlan(plan, 'Build an app', async (module, taskId) => ({
      taskId,
      agentRole: 'CODER',
      instructions: module.name,
      assignedModel: 'deepseek-code',
      virtualKey: 'sk-virtual-coder',
    })),
    /dependency cycle/,
  );
  assert.equal(dispatched, false);
});
