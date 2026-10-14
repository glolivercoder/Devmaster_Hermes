import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROUTE_TARGETS } from './models.js';

export interface RoutingState {
  mode: 'auto' | 'manual';
  routes: Record<string, string>;
  freeOnly: boolean;
  updatedAt: string;
}

const DIR = join(process.cwd(), 'data');
const FILE = join(DIR, 'llm-routing.json');

export function defaultRouting(): RoutingState {
  const routes: Record<string, string> = {};
  for (const t of ROUTE_TARGETS) routes[t.id] = t.defaultModel;
  return { mode: 'auto', routes, freeOnly: false, updatedAt: new Date().toISOString() };
}

export async function loadRouting(): Promise<RoutingState> {
  try {
    const raw = await readFile(FILE, 'utf-8');
    const parsed = JSON.parse(raw) as RoutingState;
    const base = defaultRouting();
    return { ...base, ...parsed, routes: { ...base.routes, ...(parsed.routes ?? {}) } };
  } catch {
    return defaultRouting();
  }
}

export async function saveRouting(next: Partial<RoutingState>): Promise<RoutingState> {
  const cur = await loadRouting();
  const merged: RoutingState = {
    mode: next.mode ?? cur.mode,
    routes: { ...cur.routes, ...(next.routes ?? {}) },
    freeOnly: next.freeOnly ?? cur.freeOnly,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(merged, null, 2));
  return merged;
}

/** Resolve which logical model serves a target (manual override or default). */
export async function resolveModel(targetId: string): Promise<string> {
  const st = await loadRouting();
  if (st.mode === 'manual') return st.routes[targetId] ?? 'deepseek-code';
  const t = ROUTE_TARGETS.find((r) => r.id === targetId);
  return st.routes[targetId] ?? t?.defaultModel ?? 'deepseek-code';
}
