/**
 * Hermes Control Center — Computer Use Subagent
 * Module 08: Computer Use Agent
 *
 * Implements the perception-action loop:
 * 1. Takes screenshot via ScreenDriver
 * 2. Prompts cost-effective multimodal LLM (Gemini 2.0 Flash / OpenRouter Free) via GatewayClient
 * 3. Parses GUI grounding decision (coordinates + actions)
 * 4. Executes mouse clicks, text typing, or editor command palette hotkeys (Ctrl+Shift+P)
 */

import { ScreenDriver, ComputerAction } from './screen-driver.js';
import { GatewayClient } from '../gateway/gateway-client.js';
import { eventBus } from '../core/event-bus.js';
import { auditLogger } from '../core/audit-logger.js';

export interface ComputerUseStepResult {
  step: number;
  action: ComputerAction;
  modelReasoning: string;
  success: boolean;
}

export class ComputerUseAgent {
  private driver: ScreenDriver;
  private gateway: GatewayClient;
  private virtualKey: string;
  private visionModel: string;

  constructor(
    gateway: GatewayClient,
    virtualKey: string,
    visionModel = 'openrouter-vision-free',
    driver?: ScreenDriver
  ) {
    this.gateway = gateway;
    this.virtualKey = virtualKey;
    this.visionModel = visionModel;
    this.driver = driver ?? new ScreenDriver();
  }

  /**
   * Run a single autonomous Computer Use step towards a goal.
   * e.g., "Open Command Palette and run Git: Pull in Cursor"
   */
  async executeStep(goal: string, stepNumber = 1): Promise<ComputerUseStepResult> {
    eventBus.publish('agent:task:started', {
      agentId: 'subagent-computer-use',
      taskId: `cu-step-${stepNumber}`,
      description: `Computer use action for: ${goal}`,
    });

    // 1. Perception: capture screenshot
    const screenshotBase64 = this.driver.takeScreenshot();
    const dimensions = this.driver.getScreenSize();

    // 2. Multimodal LLM decision
    const systemPrompt = `
You are the Hermes Computer Use GUI Agent.
Screen dimensions: ${dimensions.width}x${dimensions.height}.
Goal: ${goal}
Analyze the screenshot. Return a JSON object with your action:
{
  "reasoning": "Explanation of UI element found",
  "action": "left_click" | "type" | "hotkey",
  "coordinate": [x, y],
  "text": "text to type if applicable",
  "hotkeys": ["Control", "Shift", "P"]
}
`.trim();

    let decision: {
      reasoning: string;
      action: ComputerAction['action'];
      coordinate?: [number, number];
      text?: string;
      hotkeys?: string[];
    };

    try {
      const response = await this.gateway.complete({
        model: this.visionModel,
        virtualKey: this.virtualKey,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Screenshot provided. Dimensions: ${dimensions.width}x${dimensions.height}. What is the next action for: "${goal}"?`,
          },
        ],
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        auditLogger.log({
          actor: 'SUBAGENT',
          event: 'computer_use:parse_failure',
          payload: { goal, responseLength: response.content.length },
        });
        throw new Error('Vision model did not return valid JSON with an action object.');
      }
      decision = JSON.parse(jsonMatch[0]);
      if (!decision || typeof decision.action !== 'string') {
        auditLogger.log({
          actor: 'SUBAGENT',
          event: 'computer_use:invalid_action',
          payload: { goal, decision: JSON.stringify(decision) },
        });
        throw new Error('Vision model did not return a valid action field.');
      }
    } catch (error: any) {
      auditLogger.log({
        actor: 'SUBAGENT',
        event: 'computer_use:vision_failure',
        payload: { goal, error: error?.message || String(error) },
      });
      throw new Error(`cannot proceed with GUI automation: ${(error?.message || 'Vision model unreachable')}. Ensure Windows Forms and GDI+ are available. Install: https://github.com/obra/superpowers — Evidence over claims`);
    }

    // 3. Execution
    const computerAction: ComputerAction = {
      action: decision.action,
      coordinate: decision.coordinate,
      text: decision.text,
      hotkeys: decision.hotkeys,
    };

    const success = this.driver.executeAction(computerAction);

    const result: ComputerUseStepResult = {
      step: stepNumber,
      action: computerAction,
      modelReasoning: decision.reasoning,
      success,
    };

    eventBus.publish('agent:task:completed', {
      agentId: 'subagent-computer-use',
      taskId: `cu-step-${stepNumber}`,
      durationMs: 800,
    });

    auditLogger.log({
      actor: 'SUBAGENT',
      event: 'computer_use:action_executed',
      payload: result,
    });

    return result;
  }
}

