/**
 * TDD — Module 08: Computer Use Subagent Tests
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ScreenDriver } from '../src/computer-use/screen-driver.js';
import { ComputerUseAgent } from '../src/computer-use/computer-agent.js';
import { Orchestrator } from '../src/orchestrator/orchestrator.js';
import { GatewayClient } from '../src/gateway/gateway-client.js';

test('ScreenDriver: returns valid primary screen dimensions', () => {
  const driver = new ScreenDriver('tests/tmp-cu');
  const size = driver.getScreenSize();

  assert.ok(size.width > 0);
  assert.ok(size.height > 0);
});

test('ScreenDriver: takes screenshot and returns base64 image string', () => {
  const driver = new ScreenDriver('tests/tmp-cu');
  const b64 = driver.takeScreenshot();

  assert.ok(typeof b64 === 'string');
  assert.ok(b64.length > 20);
});

test('ScreenDriver: executes hotkey action without throwing', () => {
  const driver = new ScreenDriver('tests/tmp-cu');
  const executed = driver.executeAction({
    action: 'hotkey',
    hotkeys: ['Control', 'Shift', 'P'],
  });

  assert.equal(executed, true);
});

test('ComputerUseAgent: executes autonomous step using vision model and returns result', async () => {
  const gateway = new GatewayClient('http://localhost:4000', 'sk-master');
  const agent = new ComputerUseAgent(gateway, 'sk-virtual-cu', 'openrouter-vision-free');

  const stepResult = await agent.executeStep('Open Command Palette in Cursor and type Git: Pull', 1);

  assert.equal(stepResult.step, 1);
  assert.ok(stepResult.action);
  assert.ok(stepResult.modelReasoning);
  assert.equal(stepResult.success, true);
});

test('Orchestrator: triggers Computer Use fallback when APIs/MCPs unavailable', async () => {
  const gateway = new GatewayClient('http://localhost:4000', 'sk-master');
  const orchestrator = new Orchestrator(gateway, 'sk-virtual-orchestrator');
  const cuAgent = new ComputerUseAgent(gateway, 'sk-virtual-cu', 'openrouter-vision-free');

  const result = await orchestrator.requestComputerUseFallback(
    cuAgent,
    'Cursor',
    'Trigger AI agent prompt input'
  );

  assert.equal(result.success, true);
  assert.ok(result.action.action);
});
