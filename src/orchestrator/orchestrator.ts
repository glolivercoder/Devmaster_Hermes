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
import { ComposioAgent } from '../integrations/composio-agent.js';
import { ComputerUseAgent } from '../computer-use/computer-agent.js';

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
  agentRole: 'ORCHESTRATOR' | 'CODER' | 'SECURITY' | 'PENTEST' | 'QA' | 'INTEGRATOR' | 'COMPUTER_USER';
  instructions: string;
  assignedModel: string;
  virtualKey: string;
}

export interface SubagentResult {
  taskId: string;
  agentRole: SubagentTask['agentRole'];
  content: string;
  model: string;
  durationMs: number;
}

export interface PlanTaskResult {
  name: string;
  status: 'completed' | 'failed' | 'blocked';
  result?: SubagentResult;
  error?: string;
}

const MAX_PLAN_MODULES = 20;
const MAX_PARALLEL_SUBAGENTS = 4;

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
  private model: string;

  constructor(gateway: GatewayClient, virtualKey: string, model = 'claude-code') {
    this.gateway = gateway;
    this.virtualKey = virtualKey;
    this.model = model;
  }

  /** Generate devil's advocate viability analysis and module plan */
  async analyzeIdea(ideaPrompt: string): Promise<TaskPlan> {
    const started = Date.now();
    const taskId = createTaskId('idea-analysis');
    eventBus.publish('agent:task:started', {
      agentId: 'orchestrator-main',
      taskId,
      description: 'Analyzing project idea',
    });

    try {
      const response = await this.gateway.complete({
        model: this.model,
        virtualKey: this.virtualKey,
        messages: [
          {
            role: 'system',
            content: `${ANTI_SYCOPHANCY_SYSTEM_PROMPT}
Analyze the following SaaS/project idea. Return only JSON with this exact shape:
{"title":"...","feasibilityPercent":0,"marketAnalysis":"...","timeEstimate":"...","modules":[{"name":"...","order":1,"dependencies":[]}],"critique":"..."}
feasibilityPercent must be a number from 0 to 100. Include at least one module. Every dependency must name another module; do not create cycles. Do not invent certainty: state assumptions and evidence limits.`,
          },
          { role: 'user', content: ideaPrompt },
        ],
      });
      const plan = parseTaskPlan(response.content);
      eventBus.publish('agent:task:completed', {
        agentId: 'orchestrator-main',
        taskId,
        durationMs: Date.now() - started,
      });
      auditLogger.log({
        actor: 'ORCHESTRATOR',
        event: 'orchestrator:analysis:completed',
        payload: plan,
      });
      return plan;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      eventBus.publish('agent:task:failed', { agentId: 'orchestrator-main', taskId, error: message });
      throw error;
    }
  }

  /** Dispatch task to a specialized subagent */
  async dispatchSubagent(task: SubagentTask): Promise<SubagentResult> {
    const started = Date.now();
    const agentId = `subagent-${task.agentRole.toLowerCase()}`;
    const roleLimit = task.agentRole === 'PENTEST'
      ? 'No active penetration testing tools are attached. Do not claim a pentest was performed.'
      : task.agentRole === 'SECURITY'
        ? 'Only use security scan evidence explicitly included in the task. Do not claim Semgrep/SAST ran unless evidence says so.'
        : task.agentRole === 'QA'
          ? 'Do not claim tests ran unless actual test output is included in the task.'
          : task.agentRole === 'INTEGRATOR'
            ? 'Do not claim an external service was connected; provide a plan unless connection evidence is included.'
            : '';
    eventBus.publish('agent:task:started', {
      agentId,
      taskId: task.taskId,
      description: `${task.agentRole} task ${task.taskId}`,
    });
    auditLogger.log({
      actor: 'ORCHESTRATOR',
      event: 'subagent:dispatched',
      payload: {
        taskId: task.taskId,
        agentRole: task.agentRole,
        assignedModel: task.assignedModel,
        instructionsChars: task.instructions.length,
      },
    });

    try {
      const response = await this.gateway.complete({
        model: task.assignedModel,
        virtualKey: task.virtualKey,
        maxTokens: 4096,
        messages: [
          {
            role: 'system',
            content: `${ANTI_SYCOPHANCY_SYSTEM_PROMPT}\nYou are the Hermes ${task.agentRole} specialist. Complete the assigned task directly. State limitations; never claim to have modified files or systems unless a tool actually did so. ${roleLimit}`,
          },
          { role: 'user', content: task.instructions },
        ],
      });
      const result: SubagentResult = {
        taskId: task.taskId,
        agentRole: task.agentRole,
        content: response.content,
        model: response.model || task.assignedModel,
        durationMs: Date.now() - started,
      };
      eventBus.publish('agent:task:completed', { agentId, taskId: task.taskId, durationMs: result.durationMs });
      auditLogger.log({
        actor: 'SUBAGENT',
        event: 'subagent:completed',
        payload: { taskId: task.taskId, agentRole: task.agentRole, model: result.model, durationMs: result.durationMs },
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      eventBus.publish('agent:task:failed', { agentId, taskId: task.taskId, error: message });
      auditLogger.log({
        actor: 'SUBAGENT',
        event: 'subagent:failed',
        payload: { taskId: task.taskId, agentRole: task.agentRole, error: message },
      });
      throw error;
    }
  }

  /** Run independent plan tasks concurrently and block tasks whose dependencies fail. */
  async executePlan(
    plan: TaskPlan,
    prompt: string,
    createTask: (module: TaskPlan['modules'][number], taskId: string) => Promise<SubagentTask>,
  ): Promise<PlanTaskResult[]> {
    validateTaskPlan(plan);
    const results = new Map<string, PlanTaskResult>();
    const planId = createTaskId('plan');
    const taskIds = new Map(plan.modules.map((module, index) => [module.name, `${planId}-${index}`]));
    const pending = new Set(plan.modules.map((module) => module.name));

    while (pending.size) {
      for (const module of plan.modules) {
        if (!pending.has(module.name)) continue;
        const failedDependency = module.dependencies.find((name) => {
          const status = results.get(name)?.status;
          return status === 'failed' || status === 'blocked';
        });
        if (failedDependency) {
          pending.delete(module.name);
          results.set(module.name, {
            name: module.name,
            status: 'blocked',
            error: `Dependency "${failedDependency}" did not complete.`,
          });
        }
      }

      const ready = plan.modules
        .filter((module) =>
          pending.has(module.name) && module.dependencies.every((name) => results.get(name)?.status === 'completed'),
        )
        .sort((a, b) => a.order - b.order);
      if (!ready.length) {
        if (pending.size) throw new Error(`Plan scheduler stalled; unresolved tasks: ${[...pending].join(', ')}`);
        break;
      }

      for (let offset = 0; offset < ready.length; offset += MAX_PARALLEL_SUBAGENTS) {
        const batch = ready.slice(offset, offset + MAX_PARALLEL_SUBAGENTS);
        await Promise.all(batch.map(async (module) => {
          const taskId = taskIds.get(module.name)!;
          try {
            const task = await createTask(module, taskId);
            const dependencyOutputs = module.dependencies.map((name) => {
              const dependency = results.get(name)!;
              return `${name} (${dependency.status}):\n${dependency.result?.content.slice(0, 2500) ?? dependency.error ?? ''}`;
            }).join('\n\n').slice(0, 12_000);
            const result = await this.dispatchSubagent({
              ...task,
              taskId,
              instructions: [
                `Project request:\n${prompt}`,
                `Assigned module: ${module.name}`,
                `Dependencies already completed: ${module.dependencies.join(', ') || 'none'}`,
                dependencyOutputs ? `Dependency deliverables:\n${dependencyOutputs}` : '',
                `Task order: ${module.order}`,
                task.instructions,
                'Return concrete deliverables and any assumptions. Do not claim to edit files or run tools.',
              ].join('\n\n'),
            });
            results.set(module.name, { name: module.name, status: 'completed', result });
          } catch (error) {
            results.set(module.name, {
              name: module.name,
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
            });
          }
          pending.delete(module.name);
        }));
      }
    }

    return plan.modules.map((module) => results.get(module.name)!);
  }

  /**
   * Request an external platform integration via Composio Subagent.
   * Emits user form if credentials or authorization are required.
   */
  requestIntegrationService(composioAgent: ComposioAgent, serviceName: string) {
    return composioAgent.requestIntegration(serviceName);
  }

  /**
   * Fallback to Computer Use Subagent when API, MCP or Playwright are not available
   * (e.g. interacting with Cursor, Windsurf, VS Code, Antigravity, OpenCode).
   */
  async requestComputerUseFallback(
    computerAgent: ComputerUseAgent,
    targetEditor: string,
    actionGoal: string,
    confirmed = false
  ) {
    if (!confirmed) throw new Error('Computer-use fallback requires explicit user confirmation.');
    return computerAgent.executeStep(`Target: ${targetEditor}. Goal: ${actionGoal}`, 1, true);
  }
}

function parseTaskPlan(content: string): TaskPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Model did not return a JSON TaskPlan.');
    try {
      parsed = JSON.parse(match[0]);
    } catch (error) {
      throw new Error(`Model returned invalid TaskPlan JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  validateTaskPlan(parsed);
  return parsed;
}

function validateTaskPlan(value: unknown): asserts value is TaskPlan {
  if (!value || typeof value !== 'object') throw new Error('TaskPlan must be a JSON object.');
  const plan = value as Partial<TaskPlan>;
  if (typeof plan.title !== 'string' || !plan.title.trim()) throw new Error('TaskPlan.title is required.');
  if (typeof plan.feasibilityPercent !== 'number' || !Number.isFinite(plan.feasibilityPercent) ||
      plan.feasibilityPercent < 0 || plan.feasibilityPercent > 100) {
    throw new Error('TaskPlan.feasibilityPercent must be a number from 0 to 100.');
  }

  if (typeof plan.marketAnalysis !== 'string' || typeof plan.timeEstimate !== 'string' ||
      typeof plan.critique !== 'string') {
    throw new Error('TaskPlan marketAnalysis, timeEstimate and critique must be strings.');
  }
  if (!Array.isArray(plan.modules) || !plan.modules.length) throw new Error('TaskPlan.modules must contain at least one module.');
  if (plan.modules.length > MAX_PLAN_MODULES) {
    throw new Error(`TaskPlan.modules cannot exceed ${MAX_PLAN_MODULES} modules.`);
  }

  const names = new Set<string>();
  for (const [index, module] of plan.modules.entries()) {
    if (!module || typeof module.name !== 'string' || !module.name.trim()) {
      throw new Error(`TaskPlan.modules[${index}].name is required.`);
    }
    if (names.has(module.name)) throw new Error(`TaskPlan contains duplicate module "${module.name}".`);
    names.add(module.name);
    if (!Number.isInteger(module.order) || module.order < 1 || !Array.isArray(module.dependencies) ||
        module.dependencies.some((dependency) => typeof dependency !== 'string')) {
      throw new Error(`TaskPlan module "${module.name}" has invalid order or dependencies.`);
    }
  }
  for (const module of plan.modules) {
    for (const dependency of module.dependencies) {
      if (!names.has(dependency)) throw new Error(`TaskPlan module "${module.name}" depends on unknown module "${dependency}".`);
      if (dependency === module.name) throw new Error(`TaskPlan module "${module.name}" cannot depend on itself.`);
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const byName = new Map(plan.modules.map((module) => [module.name, module]));
  const visit = (name: string): void => {
    if (visiting.has(name)) throw new Error(`TaskPlan contains a dependency cycle at "${name}".`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of byName.get(name)!.dependencies) visit(dependency);
    visiting.delete(name);
    visited.add(name);
  };
  for (const module of plan.modules) visit(module.name);
}

function createTaskId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
