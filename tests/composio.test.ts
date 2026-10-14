/**
 * TDD — Module 07: Composio Integration Subagent Tests
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ComposioAgent } from '../src/integrations/composio-agent.js';
import { Orchestrator } from '../src/orchestrator/orchestrator.js';
import { GatewayClient } from '../src/gateway/gateway-client.js';

test('ComposioAgent: generates user form when credentials are required', () => {
  const composio = new ComposioAgent();
  const res = composio.requestIntegration('GitHub', 'API_KEY');

  assert.equal(res.needsUserInput, true);
  assert.ok(res.form);
  assert.equal(res.form?.serviceName, 'GitHub');
  assert.equal(res.form?.status, 'AWAITING_USER_INPUT');
  assert.equal(res.form?.fields[0].name, 'githubToken');
  assert.equal(res.form?.fields[0].type, 'password');
});

test('ComposioAgent: submits user form successfully', () => {
  const composio = new ComposioAgent();
  const res = composio.requestIntegration('Slack', 'API_KEY');
  const formId = res.form!.integrationId;

  const submitted = composio.submitForm(formId, { slackBotToken: 'xoxb-123456789' });
  assert.equal(submitted, true);

  // Submitting nonexistent form returns false
  const invalid = composio.submitForm('invalid-id', {});
  assert.equal(invalid, false);
});

test('ComposioAgent: tests toolkit connection for GitHub (live toolkit verification)', async () => {
  const composio = new ComposioAgent();
  const result = await composio.testToolkitConnection('GitHub');

  assert.equal(result.connected, true);
  assert.equal(result.toolkit, 'GitHub');
  assert.ok(result.availableToolsCount > 20);
  assert.ok(result.message.includes('GitHub Toolkit conectado'));
});

test('Orchestrator: triggers Composio subagent and generates user form', () => {
  const gateway = new GatewayClient('http://localhost:4000', 'sk-master');
  const orchestrator = new Orchestrator(gateway, 'sk-virtual-orchestrator');
  const composio = new ComposioAgent();

  const req = orchestrator.requestIntegrationService(composio, 'Gmail');
  assert.equal(req.needsUserInput, true);
  assert.equal(req.form?.serviceName, 'Gmail');
  assert.equal(req.form?.fields[0].type, 'oauth_url');
});
