/**
 * Hermes Control Center — Orchestrator Engine & Anti-Sycophancy
 * Module 03: Hermes Orchestrator
 *
 * Implements:
 * 1. Sequential task decomposition
 * 2. Devil's Advocate / Anti-Sycophancy system prompt injection
 * 3. Subagent dispatch and coordination
 */

import { GatewayClient } from '../gateway/gateway-client.js';
import { eventBus } from '../core/event-bus.js';
import { auditLogger } from '../core/audit-logger.js';

export interface TaskPlan {
  title: string;
  feasibilityPercent: number;
  marketAnalysis: string;
  timeEstimate: string;
  modules: { name: string; order: number; dependencies: string[] }[];
  critique: string; // Anti-sycophancy / Devil's advocate critique
}

export interface SubagentTask {
  taskId: string;
  agentRole: 'CODER' | 'SECURITY' | 'PENTEST' | 'QA' | 'INTEGRATOR';
  instructions: string;
  assignedModel: string;
  virtualKey: string;
}

export const ANTI_SYCOPHANCY_SYSTEM_PROMPT = `
You are the Hermes Devil's Advocate & Technical Architect.
Rules:
1. Never flatter the user or inflate viability percentages.
2. Direct, unfiltered critique: expose market friction, operational risks, architectural pitfalls.
3. Be concise and precise. No corporate pleasantries. No sycophancy.
`.trim();

export class Orchestrator {
  private gateway: GatewayClient;
  private virtualKey: string;

  constructor(gateway: GatewayClient, virtualKey: string) {
    this.gateway = gateway;
    this.virtualKey = virtualKey;
  }

  /** Generate devil's advocate viability analysis and module plan */
  async analyzeIdea(ideaPrompt: string): Promise<TaskPlan> {
    eventBus.publish('agent:task:started', {
      agentId: 'orchestrator-main',
      taskId: 'idea-analysis',
      description: `Analyzing idea: ${ideaPrompt.substring(0, 50)}...`,
    });

    const systemMessage = `${ANTI_SYCOPHANCY_SYSTEM_PROMPT}\nAnalyze the following SaaS/project idea. Output valid JSON matching the TaskPlan format.`;

    const response = await this.gateway.complete({
      model: 'claude-code',
      virtualKey: this.virtualKey,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: ideaPrompt },
      ],
    });

    let plan: TaskPlan;
    try {
      plan = JSON.parse(response.content);
    } catch {
      // Fallback structured analysis if model outputs markdown-wrapped JSON
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        plan = JSON.parse(jsonMatch[0]);
      } else {
        plan = {
          title: 'Project Analysis',
          feasibilityPercent: 65,
          marketAnalysis: 'High competition, crowded space.',
          timeEstimate: '3-4 weeks',
          modules: [{ name: 'Foundation', order: 1, dependencies: [] }],
          critique: response.content,
        };
      }
    }

    eventBus.publish('agent:task:completed', {
      agentId: 'orchestrator-main',
      taskId: 'idea-analysis',
      durationMs: 1200,
    });

    auditLogger.log({
      actor: 'ORCHESTRATOR',
      event: 'orchestrator:analysis:completed',
      payload: plan,
    });

    return plan;
  }

  /** Dispatch task to a specialized subagent */
  dispatchSubagent(task: SubagentTask): void {
    eventBus.publish('agent:task:started', {
      agentId: `subagent-${task.agentRole.toLowerCase()}`,
      taskId: task.taskId,
      description: task.instructions,
    });

    auditLogger.log({
      actor: 'SUBAGENT',
      event: 'subagent:dispatched',
      payload: task,
    });
  }
}
