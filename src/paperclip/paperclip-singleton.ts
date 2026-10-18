/**
 * paperclip-singleton — instância única do PaperclipAdapter.
 * Evita que rotas e futuros agentes cadastrallem tickets em instâncias
 * diferentes (o adapter guarda estado em Map em memória).
 */
import { PaperclipAdapter } from './paperclip-adapter.js';

export const paperclipAdapter = new PaperclipAdapter();
