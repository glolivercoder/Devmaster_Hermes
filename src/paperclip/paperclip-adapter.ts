/**
 * Hermes Control Center — Paperclip Adapter & Virtual Company Orchestrator
 * Module 09: Paperclip Office & Workflow Engine
 *
 * Capabilities:
 * 1. Simulates an Agent Company Org Chart (CEO/Orchestrator, Tech Lead, Coder, Security, Pentest, QA, Integrator)
 * 2. Manages issues, workflow states, and live activity streams
 * 3. Bridges Hermes Agent execution to Paperclip-style tickets
 */

import { eventBus } from '../core/event-bus.js';
import { auditLogger } from '../core/audit-logger.js';

export interface CompanyAgent {
  id: string;
  name: string;
  role: 'CEO' | 'TECH_LEAD' | 'CODER' | 'SECURITY' | 'PENTEST' | 'QA' | 'INTEGRATOR' | 'COMPUTER_USER';
  status: 'IDLE' | 'WORKING' | 'AWAITING_INPUT' | 'COMPLETED';
  currentTask?: string;
  model: string;
  costEstimateUsd: number;
  tokensUsed: number;
}

export interface PaperclipTicket {
  ticketId: string;
  title: string;
  description: string;
  assignedAgentId: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
  createdAt: string;
  updatedAt: string;
}

export class PaperclipAdapter {
  private agents: Map<string, CompanyAgent> = new Map();
  private tickets: Map<string, PaperclipTicket> = new Map();

  constructor() {
    this.seedDefaultCompany();
  }

  /** Initialize default virtual software agency */
  private seedDefaultCompany(): void {
    const defaultAgents: CompanyAgent[] = [
      { id: 'agent-ceo', name: 'Hermes Orchestrator (CEO)', role: 'CEO', status: 'WORKING', currentTask: 'Supervisionando ecossistema e viabilidade', model: 'claude-code', costEstimateUsd: 0.85, tokensUsed: 14500 },
      { id: 'agent-techlead', name: 'Tech Lead Architect', role: 'TECH_LEAD', status: 'IDLE', model: 'gemini-pro', costEstimateUsd: 0.32, tokensUsed: 6200 },
      { id: 'agent-dev', name: 'Fullstack Dev Agent', role: 'CODER', status: 'WORKING', currentTask: 'Implementando rotas e componentes', model: 'claude-fast', costEstimateUsd: 0.24, tokensUsed: 8900 },
      { id: 'agent-sec', name: 'Security Reviewer', role: 'SECURITY', status: 'IDLE', model: 'deepseek-code', costEstimateUsd: 0.08, tokensUsed: 4100 },
      { id: 'agent-pentest', name: 'Pentest Offensive Agent', role: 'PENTEST', status: 'IDLE', model: 'deepseek-code', costEstimateUsd: 0.05, tokensUsed: 2300 },
      { id: 'agent-integrator', name: 'Composio Integrator', role: 'INTEGRATOR', status: 'WORKING', currentTask: 'Sincronizando webhooks do GitHub e Slack', model: 'claude-fast', costEstimateUsd: 0.15, tokensUsed: 3800 },
      { id: 'agent-cu', name: 'Computer User Agent', role: 'COMPUTER_USER', status: 'IDLE', model: 'openrouter-vision-free', costEstimateUsd: 0.00, tokensUsed: 1200 },
    ];

    defaultAgents.forEach(a => this.agents.set(a.id, a));
  }

  /** Get all agents in the office */
  getAgents(): CompanyAgent[] {
    return Array.from(this.agents.values());
  }

  /** Create and assign a Paperclip ticket to an agent */
  createTicket(ticket: Omit<PaperclipTicket, 'ticketId' | 'createdAt' | 'updatedAt'>): PaperclipTicket {
    const ticketId = `ticket-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const record: PaperclipTicket = {
      ...ticket,
      ticketId,
      createdAt: now,
      updatedAt: now,
    };

    this.tickets.set(ticketId, record);

    // Update agent state
    const agent = this.agents.get(ticket.assignedAgentId);
    if (agent) {
      agent.status = 'WORKING';
      agent.currentTask = ticket.title;
    }

    eventBus.publish('agent:task:started', {
      agentId: ticket.assignedAgentId,
      taskId: ticketId,
      description: ticket.title,
    });

    auditLogger.log({
      actor: 'ORCHESTRATOR',
      event: 'paperclip:ticket:created',
      payload: record,
    });

    return record;
  }

  /** Update ticket progress and status */
  updateTicketStatus(ticketId: string, status: PaperclipTicket['status']): boolean {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) return false;

    ticket.status = status;
    ticket.updatedAt = new Date().toISOString();

    const agent = this.agents.get(ticket.assignedAgentId);
    if (agent && status === 'DONE') {
      agent.status = 'IDLE';
      agent.currentTask = undefined;
    }

    auditLogger.log({
      actor: 'SUBAGENT',
      event: 'paperclip:ticket:updated',
      payload: { ticketId, status },
    });

    return true;
  }

  /** Get all tickets */
  getTickets(): PaperclipTicket[] {
    return Array.from(this.tickets.values());
  }
}

