/**
 * TDD — Module 09: Paperclip Adapter Tests
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PaperclipAdapter } from '../src/paperclip/paperclip-adapter.js';

test('PaperclipAdapter: initializes default company org chart with agents', () => {
  const adapter = new PaperclipAdapter();
  const agents = adapter.getAgents();

  assert.ok(agents.length >= 6);
  const ceo = agents.find(a => a.role === 'CEO');
  assert.ok(ceo);
  assert.equal(ceo.name, 'Hermes Orchestrator (CEO)');

  const integrator = agents.find(a => a.role === 'INTEGRATOR');
  assert.ok(integrator);
  assert.equal(integrator.name, 'Composio Integrator');
});

test('PaperclipAdapter: creates ticket and assigns to agent', () => {
  const adapter = new PaperclipAdapter();
  const ticket = adapter.createTicket({
    title: 'Audit LiteLLM Gateway Dockerfile',
    description: 'Run TruffleHog and Semgrep on root directory',
    assignedAgentId: 'agent-sec',
    priority: 'HIGH',
    status: 'IN_PROGRESS',
  });

  assert.ok(ticket.ticketId.startsWith('ticket-'));
  assert.equal(ticket.assignedAgentId, 'agent-sec');

  const secAgent = adapter.getAgents().find(a => a.id === 'agent-sec');
  assert.equal(secAgent?.status, 'WORKING');
  assert.equal(secAgent?.currentTask, 'Audit LiteLLM Gateway Dockerfile');
});

test('PaperclipAdapter: updates ticket to DONE and frees assigned agent', () => {
  const adapter = new PaperclipAdapter();
  const ticket = adapter.createTicket({
    title: 'Setup GitHub Toolkit Webhook',
    description: 'Configure Composio webhook url',
    assignedAgentId: 'agent-integrator',
    priority: 'MEDIUM',
    status: 'IN_PROGRESS',
  });

  const updated = adapter.updateTicketStatus(ticket.ticketId, 'DONE');
  assert.equal(updated, true);

  const agent = adapter.getAgents().find(a => a.id === 'agent-integrator');
  assert.equal(agent?.status, 'IDLE');
  assert.equal(agent?.currentTask, undefined);
});
