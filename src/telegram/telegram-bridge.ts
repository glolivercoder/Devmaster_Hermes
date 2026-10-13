/**
 * Hermes Control Center — Telegram 1-to-1 Bridge & Request Queue
 * Module 04: Telegram Bridge
 *
 * Implements:
 * 1. Private 1-to-1 whitelist via allowedChatId (blocks and logs any other ID)
 * 2. FIFO Request Queue when agent is busy
 * 3. Bidirectional event syncing with Hermes Event Bus
 */

import { eventBus } from '../core/event-bus.js';
import { auditLogger } from '../core/audit-logger.js';

export interface TelegramMessage {
  chatId: string;
  text: string;
  timestamp: Date;
}

export interface QueuedRequest {
  id: string;
  prompt: string;
  enqueuedAt: Date;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED';
}

export class TelegramBridge {
  private allowedChatId: string;
  private queue: QueuedRequest[] = [];
  private isProcessing = false;

  constructor(allowedChatId: string) {
    this.allowedChatId = allowedChatId;
  }

  /** Validate if sender is authorized */
  isAuthorized(chatId: string): boolean {
    const authorized = chatId === this.allowedChatId;
    if (!authorized) {
      auditLogger.log({
        actor: 'SYSTEM',
        event: 'telegram:unauthorized_access',
        payload: { attemptedChatId: chatId },
      });
    }
    return authorized;
  }

  /** Receive incoming message from webhook or polling */
  handleIncomingMessage(chatId: string, text: string): { accepted: boolean; queued: boolean; requestId?: string } {
    if (!this.isAuthorized(chatId)) {
      return { accepted: false, queued: false };
    }

    eventBus.publish('telegram:message:in', {
      chatId,
      text,
      timestamp: new Date(),
    });

    const req: QueuedRequest = {
      id: `tg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      prompt: text,
      enqueuedAt: new Date(),
      status: 'PENDING',
    };

    this.queue.push(req);
    eventBus.publish('telegram:queue:enqueue', { promptId: req.id, text });

    return { accepted: true, queued: true, requestId: req.id };
  }

  /** Get next pending request in FIFO order */
  getNextRequest(): QueuedRequest | null {
    const next = this.queue.find((r) => r.status === 'PENDING');
    if (!next) return null;

    next.status = 'PROCESSING';
    this.isProcessing = true;
    eventBus.publish('telegram:queue:dequeue', { promptId: next.id });
    return next;
  }

  /** Mark request completed and free processor */
  completeRequest(requestId: string): void {
    const item = this.queue.find((r) => r.id === requestId);
    if (item) {
      item.status = 'COMPLETED';
    }
    this.isProcessing = false;
  }

  /** Queue snapshot for status reporting */
  getQueueStatus(): { pendingCount: number; isBusy: boolean; queue: QueuedRequest[] } {
    const pendingCount = this.queue.filter((r) => r.status === 'PENDING').length;
    return {
      pendingCount,
      isBusy: this.isProcessing,
      queue: [...this.queue],
    };
  }

  /** Format Telegram notification message */
  formatNotification(title: string, body: string): string {
    return `🔔 *[HERMES ALERT]* ${title}\n\n${body}`;
  }
}
