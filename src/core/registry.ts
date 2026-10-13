/**
 * Hermes Control Center — MCP Registry loader
 * Module 00: Foundation
 *
 * Reads mcp-registry.json and validates port allocations at startup.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface McpServer {
  id: string;
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command: string;
  args: string[];
  port: number | null;
  priority: 'essential' | 'high' | 'medium' | 'optional';
  risk_level: 'low' | 'medium' | 'high';
  description: string;
}

export interface McpRegistry {
  version: string;
  servers: McpServer[];
  port_allocations: Record<string, string>;
}

export function loadRegistry(rootDir = '.'): McpRegistry {
  const raw = readFileSync(join(rootDir, 'mcp-registry.json'), 'utf8');
  return JSON.parse(raw) as McpRegistry;
}

/** Returns the expected owner of a port, or null if unregistered. */
export function portOwner(registry: McpRegistry, port: number): string | null {
  return registry.port_allocations[String(port)] ?? null;
}
