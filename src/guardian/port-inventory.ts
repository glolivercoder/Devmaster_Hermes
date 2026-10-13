/**
 * Hermes Control Center — Port Inventory
 * Module 02: Port & Process Guardian
 *
 * Scans active TCP ports using native OS commands.
 * Windows: netstat -ano  |  Linux/Mac: ss -tlnp or lsof -iTCP -sTCP:LISTEN
 */

import { execSync } from 'node:child_process';

export interface PortEntry {
  port: number;
  pid: number;
  protocol: 'TCP' | 'UDP';
  state: 'LISTEN' | 'ESTABLISHED' | 'OTHER';
  address: string;
}

/** Parse Windows `netstat -ano` output */
function parseWindows(raw: string): PortEntry[] {
  const entries: PortEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Active') || trimmed.startsWith('Proto')) continue;

    // Format: TCP  0.0.0.0:4000  0.0.0.0:0  LISTENING  1234
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;

    const [proto, localAddr, , stateRaw, pidRaw] = parts;
    const portMatch = localAddr.match(/:(\d+)$/);
    if (!portMatch) continue;

    const port = parseInt(portMatch[1], 10);
    const pid  = parseInt(pidRaw, 10);
    if (isNaN(port) || isNaN(pid) || port === 0) continue;

    const state: PortEntry['state'] =
      stateRaw === 'LISTENING'    ? 'LISTEN'      :
      stateRaw === 'ESTABLISHED'  ? 'ESTABLISHED' : 'OTHER';

    entries.push({
      port,
      pid,
      protocol: proto.startsWith('UDP') ? 'UDP' : 'TCP',
      state,
      address: localAddr,
    });
  }
  return entries;
}

/** Parse Unix `ss -tlnp` output */
function parseUnix(raw: string): PortEntry[] {
  const entries: PortEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Netid') || trimmed.startsWith('State')) continue;

    // Format: tcp  LISTEN 0  128  0.0.0.0:4000  0.0.0.0:*  users:(("node",pid=1234,fd=...))
    const portMatch   = trimmed.match(/:(\d+)\s+\S+:\*/);
    const pidMatch    = trimmed.match(/pid=(\d+)/);
    if (!portMatch || !pidMatch) continue;

    entries.push({
      port:     parseInt(portMatch[1], 10),
      pid:      parseInt(pidMatch[1], 10),
      protocol: 'TCP',
      state:    'LISTEN',
      address:  `0.0.0.0:${portMatch[1]}`,
    });
  }
  return entries;
}

export function scanPorts(): PortEntry[] {
  try {
    if (process.platform === 'win32') {
      const raw = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000 });
      return parseWindows(raw);
    } else {
      const raw = execSync('ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null', {
        encoding: 'utf8',
        timeout: 5000,
        shell: '/bin/sh',
      });
      return parseUnix(raw);
    }
  } catch {
    return [];
  }
}

/** Returns the PID listening on a given port, or null. */
export function pidOnPort(port: number): number | null {
  const entries = scanPorts();
  const found = entries.find(e => e.port === port && e.state === 'LISTEN');
  return found?.pid ?? null;
}

