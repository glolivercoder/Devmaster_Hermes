/**
 * Hermes Control Center — Port & Process Guardian Engine
 * Module 02: Port & Process Guardian
 *
 * Implements strict conflict detection, port allocation, and user-permission policy.
 * Rule: NEVER stop or kill processes without explicit approval, except orphans created by Hermes.
 */

import { pidOnPort } from './port-inventory.js';
import { loadRegistry, portOwner, McpRegistry } from '../core/registry.js';
import { eventBus } from '../core/event-bus.js';
import { auditLogger } from '../core/audit-logger.js';

export type ConflictLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface PortConflict {
  port: number;
  conflictingPid: number;
  level: ConflictLevel;
  registeredService: string | null;
  proposedAction: 'REALLOCATE' | 'REUSE' | 'KILL_WITH_PERMISSION';
}

export interface PermissionRequest {
  requestId: string;
  targetPid: number;
  port: number;
  serviceName: string;
  action: 'KILL' | 'RESTART' | 'STOP';
  riskLevel: ConflictLevel;
  impact: string;
  alternativePort?: number;
}

export class ProcessGuardian {
  private registry: McpRegistry;
  private hermesOwnedPids: Set<number> = new Set();
  private pendingRequests: Map<string, PermissionRequest> = new Map();

  constructor(registry?: McpRegistry) {
    this.registry = registry ?? loadRegistry('.');
  }

  /** Register PID created by Hermes during current session */
  trackHermesPid(pid: number): void {
    this.hermesOwnedPids.add(pid);
  }

  /** Check if a requested port is available or has conflict */
  checkPort(port: number, serviceName: string): PortConflict | null {
    const existingPid = pidOnPort(port);
    if (!existingPid) return null; // Port free

    const registeredService = portOwner(this.registry, port);
    const isHermesOwned = this.hermesOwnedPids.has(existingPid);

    let level: ConflictLevel = 'HIGH';
    let proposedAction: PortConflict['proposedAction'] = 'REALLOCATE';

    if (isHermesOwned) {
      level = 'LOW';
      proposedAction = 'REUSE';
    } else if (registeredService) {
      level = 'MEDIUM';
      proposedAction = 'REALLOCATE';
    } else {
      level = 'HIGH';
      proposedAction = 'REALLOCATE';
    }

    const conflict: PortConflict = {
      port,
      conflictingPid: existingPid,
      level,
      registeredService,
      proposedAction,
    };

    eventBus.publish('mcp:conflict', {
      id: serviceName,
      port,
      existingPid,
      level,
    });

    return conflict;
  }

  /** Request explicit user approval for stopping/killing a process */
  requestPermission(
    port: number,
    targetPid: number,
    serviceName: string,
    action: PermissionRequest['action'],
    impact: string
  ): PermissionRequest {
    const isHermesOwned = this.hermesOwnedPids.has(targetPid);
    const riskLevel: ConflictLevel = isHermesOwned ? 'LOW' : 'HIGH';

    const req: PermissionRequest = {
      requestId: `perm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      targetPid,
      port,
      serviceName,
      action,
      riskLevel,
      impact,
      alternativePort: port + 1,
    };

    this.pendingRequests.set(req.requestId, req);

    eventBus.publish('mcp:permission', {
      id: serviceName,
      port,
      action: action.toLowerCase() as 'start' | 'stop' | 'restart',
      requestId: req.requestId,
    });

    auditLogger.log({
      actor: 'GUARDIAN',
      event: 'permission:requested',
      payload: req,
    });

    return req;
  }

  /** Handle permission response from user (or Telegram inline buttons) */
  resolvePermission(
    requestId: string,
    decision: 'APPROVED' | 'DENIED',
    reason?: string
  ): boolean {
    const req = this.pendingRequests.get(requestId);
    if (!req) return false;

    this.pendingRequests.delete(requestId);

    auditLogger.logPermission({
      actor: 'USER',
      action: req.action,
      target: `${req.serviceName}:${req.port} (PID ${req.targetPid})`,
      decision,
      reason,
    });

    return decision === 'APPROVED';
  }

  /** Find next free port starting from a base port */
  findAvailablePort(startPort: number): number {
    let port = startPort;
    while (pidOnPort(port) !== null) {
      port++;
    }
    return port;
  }
}

