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
  private botToken?: string;
  private queue: QueuedRequest[] = [];
  private isProcessing = false;
  private offset = 0;
  private running = false;
  private pairingMode = false;

  constructor(allowedChatId: string, botToken?: string) {
    this.allowedChatId = allowedChatId;
    this.botToken = botToken ?? process.env.TELEGRAM_BOT_TOKEN;
    // Modo pareamento: sem chat ID definido, o primeiro remetente vira o dono
    if (!this.allowedChatId && this.botToken) {
      this.pairingMode = true;
      console.log('[TELEGRAM] TELEGRAM_ALLOWED_CHAT_ID ausente — modo pareamento ativo: o primeiro usuário que enviar uma mensagem será registrado como dono.');
    }
  }

  get isConfigured(): boolean {
    return Boolean(this.botToken);
  }

  get ownerChatId(): string {
    return this.allowedChatId;
  }

  /** Call a Telegram Bot API method (JSON POST where applicable) */
  private async apiCall<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.botToken) throw new Error('TELEGRAM_BOT_TOKEN não configurado');
    const url = `https://api.telegram.org/bot${this.botToken}/${method}`;
    let res: Response;
    try {
      res = params
        ? await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(35_000) })
        : await fetch(url, { signal: AbortSignal.timeout(35_000) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Telegram API ${method}: falha de rede (${msg})`);
    }
    const body = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!body.ok) throw new Error(`Telegram API ${method} falhou: ${body.description ?? 'erro desconhecido'}`);
    return body.result as T;
  }

  /** Send a text message to a chat (plain text — no parse_mode to avoid entity errors) */
  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.apiCall('sendMessage', { chat_id: chatId, text });
  }

  /** Validate the bot token via getMe — returns bot username or throws */
  async validateToken(): Promise<string> {
    const me = await this.apiCall<{ username?: string }>('getMe');
    return me.username ?? 'bot';
  }

  /**
   * Start long-polling getUpdates loop. Each accepted message is enqueued
   * and forwarded to the event bus; replies are sent by the onMessage handler.
   */
  async startPolling(onMessage?: (req: QueuedRequest, chatId: string) => Promise<string | null>): Promise<void> {
    if (!this.botToken) {
      console.log('[TELEGRAM] Bridge desativado: TELEGRAM_BOT_TOKEN não definido.');
      return;
    }

    let username = 'bot';
    for (let attempt = 1; ; attempt++) {
      try {
        username = await this.validateToken();
        break;
      } catch (err) {
        console.error(`[TELEGRAM] Falha ao conectar (tentativa ${attempt}, nova tentativa em 15s):`, err instanceof Error ? err.message : err);
        await new Promise((r) => setTimeout(r, 15_000));
      }
    }
    console.log(`[TELEGRAM] Conectado como @${username}. Whitelist: ${this.pairingMode ? 'MODO PAREAMENTO' : this.allowedChatId}.`);

    this.running = true;
    while (this.running) {
      try {
        const updates = await this.apiCall<Array<{
          update_id: number;
          message?: { chat: { id: number }; text?: string };
        }>>('getUpdates', { offset: this.offset, timeout: 30, allowed_updates: ['message'] });

        for (const update of updates) {
          this.offset = update.update_id + 1;
          const msg = update.message;
          if (!msg?.text) continue;
          const chatId = String(msg.chat.id);

          if (this.pairingMode) {
            // Pareamento: registra o primeiro remetente como dono
            this.allowedChatId = chatId;
            this.pairingMode = false;
            console.log(`[TELEGRAM] Pareado com chat ID ${chatId}. Adicione TELEGRAM_ALLOWED_CHAT_ID=${chatId} ao .env para fixar.`);
            await this.sendMessage(chatId, `✅ Pareado! A partir de agora este chat (${chatId}) é o dono do Hermes.\n\nPara fixar, adicione ao .env:\nTELEGRAM_ALLOWED_CHAT_ID=${chatId}`);
            continue;
          }

          if (!this.isAuthorized(chatId)) {
            await this.sendMessage(chatId, '⛔ Não autorizado. Este bot pertence a outro usuário.');
            continue;
          }

          const result = this.handleIncomingMessage(chatId, msg.text);

          if (onMessage && result.accepted) {
            const req = this.queue.find((r) => r.id === result.requestId);
            if (req) {
              try {
                const reply = await onMessage(req, chatId);
                if (reply) await this.sendMessage(chatId, reply);
              } catch (err) {
                console.error('[TELEGRAM] Erro ao processar mensagem:', err);
                await this.sendMessage(chatId, '⚠️ Erro ao processar sua solicitação. Tente novamente.');
              }
            }
          }
        }
      } catch (err) {
        console.error('[TELEGRAM] Erro no polling (nova tentativa em 10s):', err);
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  }

  stopPolling(): void {
    this.running = false;
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

