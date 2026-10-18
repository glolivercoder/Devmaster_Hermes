/**
 * ProcessAgent — monitor de processos/node/python/servidores + portas.
 *
 *  - Snapshot rico (PID, nome, linha de comando, portas em escuta, CPU% e RAM
 *    via Win32_PerfFormattedData, estado suspenso) filtrado para o que importa:
 *    node, python, npx/tsx/uvicorn… e donos de portas em escuta.
 *  - Ações: fechar (taskkill /F /T), pausar/retomar (NtSuspendProcess via
 *    P/Invoke — sem SIGSTOP no Windows) e reiniciar (re-spawna a CommandLine
 *    original). PIDs do núcleo (Hermes + sua cadeia) são PROTEGIDOS.
 *  - Monitor em background (default LIGADO, 20s): eventos de porta
 *    aberta/fechada + alertas de CPU/RAM em anel para a UI.
 *  - getPortMapText(): mapa compacto "porta → PID (nome)" que o Orquestrador
 *    injeta no contexto para NUNCA reutilizar porta em uso.
 *  - getMcpCategories(): MCPs do Hermes (registry) × MCPs do OpenCode
 *    (~/.config/opencode/opencode.json) × ativos no sistema (porta escutando).
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { scanPorts } from './port-inventory.js';
import { auditLogger } from '../core/audit-logger.js';
import { loadRegistry, type McpRegistry } from '../core/registry.js';

// ─── Config ─────────────────────────────────────────────────────────────────

export interface ProcessAgentConfig {
  monitorEnabled: boolean;
  intervalSec: number;
  highCpu: number;
  highRamMB: number;
}
const CONFIG_PATH = join(process.cwd(), 'data', 'process-agent-config.json');
const DEFAULT_CONFIG: ProcessAgentConfig = { monitorEnabled: true, intervalSec: 20, highCpu: 80, highRamMB: 1024 };

export function loadPaConfig(): ProcessAgentConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<ProcessAgentConfig>;
    const c = { ...DEFAULT_CONFIG };
    if (typeof raw.monitorEnabled === 'boolean') c.monitorEnabled = raw.monitorEnabled;
    if (typeof raw.intervalSec === 'number' && raw.intervalSec >= 10) c.intervalSec = Math.min(600, Math.floor(raw.intervalSec));
    if (typeof raw.highCpu === 'number') c.highCpu = raw.highCpu;
    if (typeof raw.highRamMB === 'number') c.highRamMB = raw.highRamMB;
    return c;
  } catch { return { ...DEFAULT_CONFIG }; }
}

export function savePaConfig(partial: Partial<ProcessAgentConfig>): ProcessAgentConfig {
  const next = { ...loadPaConfig() };
  if (typeof partial.monitorEnabled === 'boolean') next.monitorEnabled = partial.monitorEnabled;
  if (typeof partial.intervalSec === 'number' && partial.intervalSec >= 10) next.intervalSec = Math.min(600, Math.floor(partial.intervalSec));
  if (typeof partial.highCpu === 'number') next.highCpu = partial.highCpu;
  if (typeof partial.highRamMB === 'number') next.highRamMB = partial.highRamMB;
  writeConfig(next);
  applyPaConfig();
  return next;
}

function writeConfig(c: ProcessAgentConfig): void {
  try {
    mkdirSync(join(process.cwd(), 'data'), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2), 'utf8');
  } catch { /* ok */ }
}

// ─── Helpers PowerShell ─────────────────────────────────────────────────────

/** Caminho completo: 'powershell' genérico não está no PATH deste ambiente. */
const PS_EXE = (() => {
  const win = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return existsSync(win) ? win : 'pwsh';
})();

function ps(script: string, timeoutMs = 25_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      PS_EXE,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err && !stdout) reject(new Error(stderr || err.message));
        else resolve(stdout);
      },
    );
  });
}

// ─── Snapshot ───────────────────────────────────────────────────────────────

export interface ProcessInfo {
  pid: number;
  name: string;
  ppid: number;
  cmd: string;
  cpu: number;
  ramMB: number;
  ports: number[];
  suspended: boolean;
  kind: string;
  protectedProc: boolean;
}

export interface ProcessSnapshot {
  at: string;
  durationMs: number;
  portsTotal: number;
  processes: ProcessInfo[];
}

const RELEVANT_NAME = /(node|python|tsx)/i;
const RELEVANT_CMD = /((npx|npm|node|tsx|python\d?|uvicorn|gunicorn|hypercorn|daphne|litellm)\b)|((node|python|tsx)\.exe)/i;
const NOISE_NAME = /^(svchost|system|registry|lsass|services|wininit|csrss|dwm|fontdrvhost|smss|memcompression|idle|securityhealthservice|spoolsv|ctfmon|explorer|sihost|taskhostw|dllhost|runtimebroker|searchhost|startmenuexperiencehost|shellexperiencehost|systemsettings|userinit|wmiprvse|wslrelay|vmms|code)(\.exe)?$/i;
/** Dono de porta só entra se parecer um servidor de verdade (não editor/relay/sistema). */
const PORT_OWNER_KEEP = /(docker|gitea|nginx|redis|postgres|mongo|python|node|litellm|omni|caddy|apache|httpd|java|ruby|php|opencode|guardian|hermes)/i;

let protectedCache: Set<number> | null = null;
async function protectedPids(): Promise<Set<number>> {
  if (protectedCache && protectedCache.size) return protectedCache;
  const set = new Set<number>([0, 4, 8, process.pid]);
  try {
    const raw = await ps(
      '$p = ' + process.pid + '; for ($i=0; $i -lt 3; $i++) { ' +
      '$c = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p) -ErrorAction SilentlyContinue; ' +
      'if (-not $c) { break }; $p = [int]$c.ParentProcessId; if ($p -le 0) { break }; $p }',
    );
    for (const m of raw.match(/\d+/g) || []) set.add(parseInt(m, 10));
  } catch { /* ok */ }
  protectedCache = set;
  return set;
}

async function fetchProcessRows(): Promise<Array<{ pid: number; name: string; ppid: number; cmd: string; cpu: number; ramMB: number }>> {
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    '$perf = @{}',
    "Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter \"Name!='_Total'\" -ErrorAction SilentlyContinue | ForEach-Object { $id=[int]$_.IDProcess; $perf[$id] = @{ cpu=[int]$_.PercentProcessorTime; ram=[math]::Round([double]$_.WorkingSet/1MB,1) } }",
    '$out = @()',
    'Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {',
    '  $id = [int]$_.ProcessId',
    '  $m = $perf[$id]',
    '  $cmd = if ($_.CommandLine) { [string]$_.CommandLine } else { "" }',
    '  $out += [pscustomobject]@{ pid=$id; name=[string]$_.Name; ppid=[int]$_.ParentProcessId; cmd=$cmd; cpu=$(if($m){[int]$m.cpu}else{0}); ramMB=$(if($m){[double]$m.ram}else{0}) }',
    '}',
    'ConvertTo-Json -InputObject @($out) -Compress -Depth 5',
  ].join('\n');
  const raw = await ps(script);
  try {
    const arr = JSON.parse(raw.trim()) as Array<{ pid: number; name: string; ppid: number; cmd: string; cpu: number; ramMB: number }>;
    return Array.isArray(arr) ? arr : (arr ? [arr] : []);
  } catch { return []; }
}

async function fetchSuspended(pids: number[]): Promise<Set<number>> {
  const susp = new Set<number>();
  if (!pids.length) return susp;
  // Uma única enumeração Get-Process (não 25 chamadas -Id) e TODOS os PIDs
  // relevantes verificados — antes o .slice(0,25) perdia processos fora do
  // pedaço em ordem WMI e o snapshot reportava "não suspenso" errado.
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    '$ids = @(' + pids.slice(0, 60).join(',') + ')',
    '$out = @()',
    'Get-Process -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.Id } | ForEach-Object {',
    '  $t = $_.Threads',
    '  if ($t) { $all=@($t).Count; $susp=@($t | Where-Object { $_.ThreadState -eq "Wait" -and $_.WaitReason -eq "Suspended" }).Count; if ($susp -eq $all -and $all -gt 0) { $out += [int]$_.Id } }',
    '}',
    '$out -join ","',
  ].join('\n');
  try {
    const raw = (await ps(script, 30_000)).trim();
    for (const m of raw.match(/\d+/g) || []) susp.add(parseInt(m, 10));
  } catch { /* ok */ }
  return susp;
}

let lastSnapshot: ProcessSnapshot | null = null;

export async function getProcessSnapshot(): Promise<ProcessSnapshot> {
  const started = Date.now();
  const listen = scanPorts().filter((p) => p.state === 'LISTEN' && p.port > 0);
  const portsByPid = new Map<number, number[]>();
  for (const p of listen) {
    const arr = portsByPid.get(p.pid) ?? [];
    if (!arr.includes(p.port)) arr.push(p.port); // netstat reporta v4 e v6 — dedupe
    portsByPid.set(p.pid, arr);
  }
  const rows = await fetchProcessRows();
  const prot = await protectedPids();
  const relevant = rows.filter((r) => {
    const n = (r.name || '').toLowerCase();
    if (NOISE_NAME.test(n)) return false;
    // zumbi/saindo: sem RAM e sem porta não é mais um processo "vivo" interessante
    if ((r.ramMB ?? 0) <= 0.1 && !portsByPid.has(r.pid)) return false;
    if (RELEVANT_NAME.test(n) || RELEVANT_CMD.test(r.cmd || '')) return true;
    // dono de porta: só se o nome/comando parecer um servidor
    return portsByPid.has(r.pid) && PORT_OWNER_KEEP.test((r.name || '') + ' ' + (r.cmd || ''));
  }).slice(0, 80);
  const suspended = await fetchSuspended(relevant.map((r) => r.pid));
  const processes: ProcessInfo[] = relevant.map((r) => {
    const cmd = r.cmd || '';
    const kind = /DevMaster_Hermes|hermes/i.test(cmd) ? 'hermes'
      : /python/i.test(r.name + cmd) ? 'python'
      : /node|npx|tsx/i.test(r.name + cmd) ? 'node'
      : 'servidor';
    return {
      pid: r.pid,
      name: r.name,
      ppid: r.ppid,
      cmd: cmd.length > 300 ? cmd.slice(0, 300) + '…' : cmd,
      cpu: r.cpu ?? 0,
      ramMB: r.ramMB ?? 0,
      ports: (portsByPid.get(r.pid) ?? []).sort((a, b) => a - b),
      suspended: suspended.has(r.pid),
      kind,
      protectedProc: prot.has(r.pid),
    };
  }).sort((a, b) => (b.ports.length - a.ports.length) || (b.ramMB - a.ramMB));
  const snap: ProcessSnapshot = { at: new Date().toISOString(), durationMs: Date.now() - started, portsTotal: listen.length, processes };
  lastSnapshot = snap;
  return snap;
}

export function getLastSnapshot(): ProcessSnapshot | null { return lastSnapshot; }

// ─── Ações (fechar / pausar / retomar / reiniciar) ──────────────────────────

export type ProcAction = 'fechar' | 'pausar' | 'retomar' | 'reiniciar';

export async function executeProcessAction(
  pidRaw: number | string,
  action: ProcAction,
  actor: string,
): Promise<{ ok: boolean; detail: string; action: ProcAction; pid: number }> {
  const pid = Number(pidRaw);
  const fail = (detail: string) => ({ ok: false, detail, action, pid });
  if (!Number.isInteger(pid) || pid <= 0) return fail('pid inválido');
  const prot = await protectedPids();
  if (prot.has(pid)) return fail('PID protegido (núcleo do Hermes/sistema) — ação recusada');

  try {
    if (action === 'fechar') {
      await ps('taskkill /F /T /PID ' + pid);
      const gone = await ps('if (Get-Process -Id ' + pid + ' -ErrorAction SilentlyContinue) { "VIVO" } else { "MORTO" }', 10_000);
      const ok = !gone.includes('VIVO');
      auditLogger.log({ actor: actor === 'orchestrator' ? 'SUBAGENT' : 'USER', event: 'process:fechar', payload: { pid, ok, by: actor } });
      return { ok, detail: ok ? 'processo encerrado (árvore)' : 'taskkill executado mas o PID ainda responde', action, pid };
    }

    if (action === 'pausar' || action === 'retomar') {
      const fn = action === 'pausar' ? 'NtSuspendProcess' : 'NtResumeProcess';
      const script = [
        'Add-Type -Namespace H -Name S -MemberDefinition \'[DllImport("ntdll.dll")] public static extern int ' + fn + '(IntPtr h); [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(int a, bool i, int p);\'',
        '$h = [H.S]::OpenProcess(0x1F0FFF, $false, ' + pid + ')',
        'if ($h -eq [IntPtr]::Zero) { "ERRO:sem handle" } else { $r = [H.S]::' + fn + '($h); if ($r -eq 0) { "OK" } else { "ERRO:codigo " + $r } }',
      ].join('\n');
      const out = (await ps(script, 15_000)).trim();
      const ok = out.includes('OK');
      let detail = ok
        ? (action === 'pausar' ? 'processo suspenso (threads pausadas)' : 'processo retomado')
        : 'falha ao suspender/retomar: ' + out.slice(0, 120);
      if (ok) {
        const susp = await fetchSuspended([pid]);
        if (action === 'pausar' && !susp.has(pid)) detail = 'suspendido (confirmação de threads pendente)';
        if (action === 'retomar' && susp.has(pid)) detail = 'retomada pedida, mas threads ainda suspensas';
      }
      auditLogger.log({ actor: actor === 'orchestrator' ? 'SUBAGENT' : 'USER', event: 'process:' + action, payload: { pid, ok, by: actor } });
      return { ok, detail, action, pid };
    }

    if (action === 'reiniciar') {
      const raw = await ps('(Get-CimInstance Win32_Process -Filter "ProcessId=' + pid + '").CommandLine', 12_000);
      const cmd = raw.trim();
      if (!cmd) return fail('sem CommandLine (processo do sistema) — reinício manual necessário');
      try { await ps('taskkill /F /T /PID ' + pid, 10_000); } catch { /* pode já ter morrido */ }
      const m = cmd.match(/^"([^"]+)"\s*(.*)$/) || cmd.match(/^(\S+)\s*(.*)$/);
      if (!m) return fail('não consegui parsear a CommandLine');
      const exe = m[1];
      const args = (m[2] || '').match(/"[^"]*"|\S+/g)?.map((a) => a.replace(/^"|"$/g, '')) || [];
      let cwd = process.cwd();
      try {
        const cand = dirname(exe);
        if (existsSync(cand)) cwd = cand;
      } catch { /* ok */ }
      const child = spawn(exe, args, {
        detached: true,
        stdio: 'ignore',
        cwd,
        windowsHide: false,
        shell: process.platform === 'win32' && !/\.exe$/i.test(exe),
      });
      child.unref();
      auditLogger.log({ actor: actor === 'orchestrator' ? 'SUBAGENT' : 'USER', event: 'process:reiniciar', payload: { pid, ok: true, by: actor } });
      return { ok: true, detail: `encerrado e re-spawnado: ${exe} ${args.join(' ')}`.slice(0, 300), action, pid };
    }

    return fail('ação desconhecida: ' + action);
  } catch (e) {
    const detail = (e instanceof Error ? e.message : String(e)).slice(0, 250);
    auditLogger.log({ actor: actor === 'orchestrator' ? 'SUBAGENT' : 'USER', event: 'process:action:erro', payload: { pid, action, by: actor } });
    return fail(detail);
  }
}

// ─── Monitor em background ──────────────────────────────────────────────────

export interface PaEvent { ts: string; level: 'info' | 'aviso'; msg: string }

const events: PaEvent[] = [];
const lastAlertAt = new Map<string, number>();
function pushEvent(level: PaEvent['level'], msg: string): void {
  events.push({ ts: new Date().toISOString(), level, msg });
  while (events.length > 40) events.shift();
}

let paTimer: NodeJS.Timeout | null = null;
let paRunning = false;
let lastScanAt: string | null = null;
let prevPortKeys = new Set<string>();

async function paTick(): Promise<void> {
  if (paRunning) return;
  paRunning = true;
  try {
    const snap = await getProcessSnapshot();
    lastScanAt = snap.at;
    const cfg = loadPaConfig();
    const keys = new Set<string>();
    for (const p of snap.processes) {
      for (const port of p.ports) keys.add(`${port}:${p.pid}`);
      const cooldownOk = (k: string) => Date.now() - (lastAlertAt.get(k) || 0) > 10 * 60_000;
      if (p.cpu >= cfg.highCpu && cooldownOk(`cpu:${p.pid}`)) {
        lastAlertAt.set(`cpu:${p.pid}`, Date.now());
        pushEvent('aviso', `CPU alta: PID ${p.pid} (${p.name}) a ${p.cpu}%`);
      }
      if (p.ramMB >= cfg.highRamMB && cooldownOk(`ram:${p.pid}`)) {
        lastAlertAt.set(`ram:${p.pid}`, Date.now());
        pushEvent('aviso', `RAM alta: PID ${p.pid} (${p.name}) em ${Math.round(p.ramMB)}MB`);
      }
    }
    for (const k of keys) {
      if (prevPortKeys.size && !prevPortKeys.has(k)) {
        const [port, pid] = k.split(':');
        pushEvent('info', `porta ${port} ABERTA (PID ${pid})`);
      }
    }
    for (const k of prevPortKeys) {
      if (!keys.has(k)) {
        const [port, pid] = k.split(':');
        pushEvent('info', `porta ${port} FECHADA (PID ${pid})`);
      }
    }
    prevPortKeys = keys;
  } catch (e) {
    pushEvent('aviso', 'tick do monitor: ' + (e instanceof Error ? e.message : String(e)).slice(0, 120));
  } finally {
    paRunning = false;
  }
}

/** (Re)cria o timer conforme config — boot + salvar config. */
export function applyPaConfig(): void {
  const cfg = loadPaConfig();
  if (paTimer) { clearInterval(paTimer); paTimer = null; }
  if (cfg.monitorEnabled) {
    paTimer = setInterval(() => { void paTick(); }, Math.max(10, cfg.intervalSec) * 1000);
    (paTimer as unknown as { unref?: () => void }).unref?.();
    // primeira coleta já, para o mapa existir antes do 1º orquestramento
    void paTick();
  }
}

export function paStatus(): Record<string, unknown> {
  return {
    config: loadPaConfig(),
    monitor: { running: !!paTimer, lastScanAt, busy: paRunning },
    portsTotal: lastSnapshot?.portsTotal ?? 0,
    processes: lastSnapshot?.processes.length ?? 0,
    events: [...events].reverse().slice(0, 20),
  };
}

/** Texto do mapa de portas para injetar no contexto do Orquestrador. */
export async function getPortMapText(): Promise<string> {
  const snap = lastSnapshot && Date.now() - Date.parse(lastSnapshot.at) < 120_000
    ? lastSnapshot
    : await getProcessSnapshot();
  if (!snap.processes.length) return '(mapa indisponível no momento)';
  const lines = snap.processes
    .filter((p) => p.ports.length || p.kind === 'hermes')
    .slice(0, 40)
    .map((p) => `- ${p.ports.length ? p.ports.map((x) => `:${x}`).join(' ') : '(sem porta)'} → PID ${p.pid} · ${p.kind} · ${p.name}${p.suspended ? ' · SUSPENSO' : ''}${p.protectedProc ? ' · protegido' : ''}`);
  return lines.join('\n') || '(nenhuma porta em escuta relevante)';
}

// ─── Diretivos do Orquestrador [[PROCESSO:…]] ───────────────────────────────

export interface ProcessDirective { pid: number; action: 'fechar' | 'pausar'; reason: string }

const DIRECTIVE_RE = /\[\[PROCESSO:pid=(\d+)\s+acao=(fechar|pausar)\s+motivo="([^"]*)"\]\]/g;

/** Extrai da resposta do LLM os diretivos [[PROCESSO:pid=N acao=… motivo="…"]] (máx. 5). */
export function parseProcessDirectives(text: string): ProcessDirective[] {
  const out: ProcessDirective[] = [];
  if (!text) return out;
  DIRECTIVE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DIRECTIVE_RE.exec(text)) !== null) {
    out.push({ pid: parseInt(m[1], 10), action: m[2] as ProcessDirective['action'], reason: (m[3] || '').slice(0, 200) });
    if (out.length >= 5) break;
  }
  return out;
}

/** Bloco de contexto (switch Portas & Processos) com o mapa ao vivo + regras de diretivo. */
export function buildPortManagementBlock(mapText: string): string {
  return [
    '## 🖥 Mapa de portas e processos do Hermes (tempo real)',
    'As portas abaixo JÁ ESTÃO EM USO — NUNCA as reutilize nem as sugira para novos serviços.',
    'Se algum serviço/PORTA da lista for claramente dispensável para o objetivo do pedido',
    '(servidor de teste parado, porta órfã, processo duplicado sem uso), você PODE sugerir',
    'UM diretivo por linha, exatamente neste formato:',
    '[[PROCESSO:pid=1234 acao=fechar motivo="motivo curto"]]',
    'Ações permitidas: fechar | pausar. Use SOMENTE PIDs do mapa abaixo (não invente PIDs).',
    'O Hermes apenas apresenta sugestões. A pessoa precisa confirmar cada ação; nunca diga que executou.',
    'Se tudo estiver em uso, não emita nenhum diretivo.',
    '--- MAPA ATUAL ---',
    mapText,
  ].join('\n');
}

// ─── MCPs por categoria ─────────────────────────────────────────────────────

function opencodeMcpServers(): Array<{ name: string; type: string; command: string }> {
  const paths = [
    join(homedir(), '.config', 'opencode', 'opencode.json'),
    process.env.APPDATA ? join(process.env.APPDATA, 'opencode', 'opencode.json') : '',
    join(tmpdir(), 'opencode.json'),
  ].filter(Boolean);
  for (const p of paths) {
    try {
      if (!existsSync(p)) continue;
      const raw = JSON.parse(readFileSync(p, 'utf8')) as { mcp?: Record<string, { type?: string; command?: string; enabled?: boolean }> };
      const mcp = raw.mcp ?? {};
      return Object.entries(mcp)
        .filter(([, v]) => v && v.enabled !== false)
        .map(([name, v]) => ({ name, type: v.type || 'local', command: v.command || (Array.isArray((v as { args?: string[] }).args) ? (v as { args?: string[] }).args![0] : '') || 'stdio' }));
    } catch { /* tenta próximo caminho */ }
  }
  return [];
}

export async function getMcpCategories(): Promise<Record<string, unknown>> {
  const registry = loadRegistry('.') as McpRegistry;
  const listenPorts = new Set(scanPorts().filter((p) => p.state === 'LISTEN').map((p) => p.port));
  const hermes = (registry.servers ?? []).map((s: { id: string; name: string; transport: string; port?: number | null; priority?: string; description?: string }) => ({
    id: s.id,
    name: s.name,
    transport: s.transport,
    port: s.port ?? null,
    priority: s.priority ?? '',
    description: s.description ?? '',
    listening: s.port ? listenPorts.has(s.port) : null,
  }));
  const opencode = opencodeMcpServers();
  const active = [
    ...hermes.filter((h: { listening: boolean | null }) => h.listening === true).map((h: { name: string; port: number | null }) => ({ name: h.name, source: 'Hermes', port: h.port, status: 'ativo (porta em escuta)' })),
    ...opencode.map((o) => ({ name: o.name, source: 'OpenCode', port: null, status: 'stdio (sob demanda no agente)' })),
  ];
  return { hermes, opencode, active, registryPorts: (registry as McpRegistry).port_allocations ?? {} };
}

// ─── Boot ───────────────────────────────────────────────────────────────────

export function initProcessAgent(): void {
  applyPaConfig();
}
