/**
 * TDD — Module 08: Computer Use Subagent Tests
 */

import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { ScreenDriver } from '../src/computer-use/screen-driver.js';
import { ComputerUseAgent } from '../src/computer-use/computer-agent.js';
import { Orchestrator } from '../src/orchestrator/orchestrator.js';
import { GatewayClient } from '../src/gateway/gateway-client.js';

/** Fake driver so tests never spawn PowerShell or touch the real desktop. */
function createFakeDriver(): ScreenDriver {
  const driver = new ScreenDriver('tests/tmp-cu');
  // @ts-ignore - test stub
  driver.getScreenSize = () => ({ width: 1920, height: 1080 });
  // @ts-ignore - test stub
  driver.takeScreenshot = () =>
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  // @ts-ignore - test stub
  driver.executeAction = (action: any) => {
    assert.ok(typeof action.action === 'string');
    return true;
  };
  return driver;
}

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
  const agent = new ComputerUseAgent(
    gateway,
    'sk-virtual-cu',
    'openrouter-vision-free',
    createFakeDriver()
  );

  const decision = {
    reasoning: 'Command Palette entry found in the title bar.',
    action: 'hotkey',
    hotkeys: ['Control', 'Shift', 'P'],
  };

  // @ts-ignore mock
  mock.method(gateway, 'complete', async () => ({
    content: JSON.stringify(decision),
    model: 'openrouter-vision-free',
    tokensUsed: 120,
    costUsd: 0,
  }));

  const stepResult = await agent.executeStep('Open Command Palette in Cursor and type Git: Pull', 1, true);

  assert.equal(stepResult.step, 1);
  assert.equal(stepResult.action.action, 'hotkey');
  assert.deepEqual(stepResult.action.hotkeys, ['Control', 'Shift', 'P']);
  assert.ok(stepResult.modelReasoning.includes('Command Palette'));
  assert.equal(stepResult.success, true);
});

test('ComputerUseAgent: refuses desktop actions without explicit confirmation', async () => {
  const gateway = new GatewayClient('http://localhost:4000', 'sk-master');
  const agent = new ComputerUseAgent(gateway, 'sk-virtual-cu', 'openrouter-vision-free', createFakeDriver());

  await assert.rejects(
    () => agent.executeStep('Click the Run button'),
    /requires explicit user confirmation/,
  );
});

test('ComputerUseAgent: surfaces vision failure when model returns no JSON action', async () => {
  const gateway = new GatewayClient('http://localhost:4000', 'sk-master');
  const agent = new ComputerUseAgent(
    gateway,
    'sk-virtual-cu',
    'openrouter-vision-free',
    createFakeDriver()
  );

  // @ts-ignore mock
  mock.method(gateway, 'complete', async () => ({
    content: 'I cannot see the screen clearly enough to decide.',
    model: 'openrouter-vision-free',
    tokensUsed: 18,
    costUsd: 0,
  }));

  await assert.rejects(
    () => agent.executeStep('Click the Run button', 2, true),
    /Vision model did not return valid JSON/
  );
});

test('Orchestrator: triggers Computer Use fallback when APIs/MCPs unavailable', async () => {
  const gateway = new GatewayClient('http://localhost:4000', 'sk-master');
  const orchestrator = new Orchestrator(gateway, 'sk-virtual-orchestrator');
  const cuAgent = new ComputerUseAgent(
    gateway,
    'sk-virtual-cu',
    'openrouter-vision-free',
    createFakeDriver()
  );

  // @ts-ignore mock
  mock.method(gateway, 'complete', async () => ({
    content: JSON.stringify({
      reasoning: 'AI prompt input detected in the editor toolbar.',
      action: 'type',
      text: '/spawn subagent',
    }),
    model: 'openrouter-vision-free',
    tokensUsed: 95,
    costUsd: 0,
  }));

  const result = await orchestrator.requestComputerUseFallback(
    cuAgent,
    'Cursor',
    'Trigger AI agent prompt input',
    true
  );

  assert.equal(result.success, true);
  assert.equal(result.action.action, 'type');
  assert.equal(result.action.text, '/spawn subagent');
});
