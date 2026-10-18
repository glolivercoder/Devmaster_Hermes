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
  model: string;          // modelo que respondeu (após fallback)
}

export class ComputerUseAgent {
  private driver: ScreenDriver;
  private gateway: GatewayClient;
  private virtualKey: string;
  private visionModels: string[];

  /**
   * @param visionModels cadeia de modelos de visão em ordem de preferência —
   *   o primeiro é gratuito; se falhar (rate-limit/sem visão/erro), cai para o
   *   próximo (pago barato). Padrão: OpenRouter free → Gemini 3.8 Flash barato
   *   (cheaper-vision) → Haiku barato (cheaper-fast).
   */
  constructor(
    gateway: GatewayClient,
    virtualKey: string,
    visionModels: string | string[] = ['openrouter-vision-free', 'cheaper-vision', 'cheaper-fast'],
    driver?: ScreenDriver
  ) {
    this.gateway = gateway;
    this.virtualKey = virtualKey;
    this.visionModels = Array.isArray(visionModels) ? visionModels : [visionModels];
    this.driver = driver ?? new ScreenDriver();
  }

  /** Screenshot atual da tela (base64) — usado pela UI para mostrar o que o agente vê. */
  getScreenshot(): string { return this.driver.takeScreenshot(); }
  getScreenSize(): { width: number; height: number } { return this.driver.getScreenSize(); }

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

    // 1. Perception: capture screenshot (ANEXADO ao prompt — antes era descartado)
    const screenshotBase64 = this.driver.takeScreenshot();
    const dimensions = this.driver.getScreenSize();
    const imageUrl = `data:image/png;base64,${screenshotBase64}`;

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

    type Decision = {
      reasoning: string;
      action: ComputerAction['action'];
      coordinate?: [number, number];
      text?: string;
      hotkeys?: string[];
    };

    // 2. Multimodal decision com FALLBACK de modelo (free → pago barato)
    let decision: Decision | undefined;
    let usedModel = '';
    const errors: string[] = [];

    for (const model of this.visionModels) {
      try {
        const response = await this.gateway.complete({
          model,
          virtualKey: this.virtualKey,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: `Screenshot attached (${dimensions.width}x${dimensions.height}). Next action for: "${goal}"?` },
                { type: 'image_url', image_url: { url: imageUrl } },
              ],
            },
          ],
        });
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('sem JSON na resposta');
        const parsed = JSON.parse(jsonMatch[0]) as Decision;
        if (!parsed || typeof parsed.action !== 'string') throw new Error('JSON sem campo action válido');
        decision = parsed;
        usedModel = model;
        break;
      } catch (error: any) {
        errors.push(`${model}: ${error?.message || String(error)}`);
        auditLogger.log({
          actor: 'SUBAGENT',
          event: 'computer_use:model_fallback',
          payload: { goal, model, error: error?.message || String(error) },
        });
      }
    }

    if (!decision) {
      auditLogger.log({
        actor: 'SUBAGENT',
        event: 'computer_use:vision_failure',
        payload: { goal, errors },
      });
      throw new Error(`GUI automation indisponível — Vision model did not return valid JSON action em nenhum modelo da cadeia: ${errors.join(' | ')}`);
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
      model: usedModel,
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

