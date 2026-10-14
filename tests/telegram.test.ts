/**
 * TDD — Module 04: Telegram Bridge Tests
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TelegramBridge } from '../src/telegram/telegram-bridge.js';

test('TelegramBridge: blocks unauthorized chat IDs', () => {
  const bridge = new TelegramBridge('123456789');

  const unauthorizedResult = bridge.handleIncomingMessage('999999999', 'Hello Hermes');
  assert.equal(unauthorizedResult.accepted, false);
  assert.equal(unauthorizedResult.queued, false);
});

test('TelegramBridge: accepts authorized chat ID and enqueues request', () => {
  const bridge = new TelegramBridge('123456789');

  const result = bridge.handleIncomingMessage('123456789', 'Audit codebase now');
  assert.equal(result.accepted, true);
  assert.equal(result.queued, true);
  assert.ok(result.requestId);

  const status = bridge.getQueueStatus();
  assert.equal(status.pendingCount, 1);
});

test('TelegramBridge: processes FIFO queue sequentially', () => {
  const bridge = new TelegramBridge('123456789');

  const res1 = bridge.handleIncomingMessage('123456789', 'Task 1');
  const res2 = bridge.handleIncomingMessage('123456789', 'Task 2');

  const next1 = bridge.getNextRequest();
  assert.equal(next1?.id, res1.requestId);
  assert.equal(next1?.status, 'PROCESSING');
  assert.equal(bridge.getQueueStatus().isBusy, true);

  bridge.completeRequest(res1.requestId!);

  const next2 = bridge.getNextRequest();
  assert.equal(next2?.id, res2.requestId);
  assert.equal(next2?.status, 'PROCESSING');
});

test('TelegramBridge.formatNotification: generates alert header', () => {
  const bridge = new TelegramBridge('123456789');
  const formatted = bridge.formatNotification('Vulnerability Detected', 'Hardcoded secret found in line 42.');

  assert.ok(formatted.includes('[HERMES ALERT]'));
  assert.ok(formatted.includes('Vulnerability Detected'));
});

