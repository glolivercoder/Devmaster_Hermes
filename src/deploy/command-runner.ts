/**
 * command-runner — executor de comandos do Deploy Agent (allowlist + confirmação).
 *
 * O Hermes NÃO expõe bash livre. Este módulo implementa o modelo de permissão
 * "ask" do prompt original com três níveis:
 *
 *   AUTO    — leitura pura (ls, cat, git status, versões…). Roda sem clique.
 *   CONFIRM — qualquer outro comando (npm run build, git push, vercel…).
 *             Só executa com confirm=true vindo da UI (clique humano).
 *   DENY    — destrutivos/arriscados (rm -rf, sudo, curl|sh, dd…). NUNCA roda.
 *
 * Deny-by-default: comando fora da allowlist AUTO vira CONFIRM automaticamente.
 * Tudo é logado no auditLogger do Hermes (mesmo padrão dos outros subagentes).
 */

import { spawn } from 'node:child_process';
import { auditLogger } from '../core/audit-logger.js';
import { eventBus } from '../core/event-bus.js';

export type CommandTier = 'AUTO' | 'CONFIRM' | 'DENY';

export interface CommandClassify {
  tier: CommandTier;
  reason: string;
}

export interface CommandResult {
  command: string;
  tier: CommandTier;
  executed: boolean;
  needsConfirmation?: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  deniedReason?: string;
}

// ─── Listas ──────────────────────────────────────────────────────────────────

/** Read-only — rodam sozinhos, sem confirmação. */
const AUTO_PATTERNS: [RegExp, string][] = [
  [/^ls(\s|$)/, 'listagem de diretório'],
  [/^dir(\s|$)/, 'listagem de diretório (Windows)'],
  [/^pwd$/, 'diretório atual'],
  [/^cat\s+[\w./\\-]+$/, 'leitura de arquivo'],
  [/^type\s+[\w./\\-]+$/i, 'leitura de arquivo (Windows)'],
  [/^head(\s+-\w+\s+)?[\w./\\-]+$/, 'início de arquivo'],
  [/^tail(\s+-n\s+\d+\s+)?[\w./\\-]+$/, 'fim de arquivo'],
  [/^find\s+\.?\s?-name/, 'busca de arquivos'],
  [/^tree(\s|$)/, 'árvore de diretórios'],
  [/^du\s+-sh(\s|$)/, 'tamanho de diretório'],
  [/^git status/, 'status do git'],
  [/^git log(\s|$)/, 'histórico do git'],
  [/^git remote -v$/, 'remotes do git'],
  [/^git branch/, 'branches do git'],
  [/^git diff(\s|$)/, 'diff do git'],
  [/^(node|npm|pnpm|yarn|python3?|go|docker)(\.exe)? (-v|--version)$/, 'versão de ferramenta'],
  [/^npm ls(\s|$)/, 'lista de pacotes'],
  [/^npm outdated$/, 'pacotes desatualizados'],
  [/^curl -s -o \/dev\/null -w ['"][^'"]*['"] https?:\/\/[\w.-]+$/, 'verificação HTTP (pós-deploy)'],
];

/** Arriscados/destrutivos — bloqueados permanentemente. */
const DENY_PATTERNS: [RegExp, string][] = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)/, 'rm -rf (remoção recursiva forçada)'],
  [/\brm\s+-r\s/, 'remoção recursiva'],
  [/^\s*sudo\s/, 'elevação de privilégio (sudo)'],
  [/(curl|wget)[^|;]*\|\s*(ba|z)?sh/, 'download + execução direta (curl|sh)'],
  [/\bmkfs\b/, 'formatação de filesystem'],
  [/\bdd\s+if=/, 'escrita direta em disco (dd)'],
  [/:\(\)\s*\{/, 'fork bomb'],
  [/\bshutdown\b|\breboot\b/, 'desligamento do host'],
  [/\bformat\s+[a-z]:/i, 'formatação de volume (Windows)'],
  [/del\s+\/[fsq]/i, 'remoção forçada (Windows)'],
  [/rmdir\s+\/s/i, 'remoção recursiva (Windows)'],
  [/Reg\s+delete/i, 'exclusão no registro (Windows)'],
  [/>\s*\/dev\/(sd|nvme|disk)/, 'escrita em bloco de disco'],
  [/\beval\s+["'`]/, 'eval dinâmico'],
  [/;\s*rm\s/, 'encadeamento com remoção'],
];

/** Coisa com efeito colateral que exige clique (qualquer match ⇒ CONFIRM explícito). */
const CONFIRM_HINTS: [RegExp, string][] = [
  [/^npm (run |i(nstall)? |ci |publish)/, 'operação de build/instalação do npm'],
  [/^pnpm (run |i(nstall)? |add )/, 'operação de build/instalação do pnpm'],
  [/^yarn (run |i(nstall)?|add )/, 'operação de build/instalação do yarn'],
  [/^git (push|commit|checkout|merge|reset|rebase|tag)/, 'operação de escrita no git'],
  [/^(vercel|wrangler|netlify|fly|heroku|render)(\s|$)/, 'CLI de plataforma de deploy'],
  [/^(rsync|scp)\s/, 'transferência de arquivos'],
  [/^ssh\s/, 'acesso remoto (SSH)'],
  [/^(docker|docker-compose|podman)\s/, 'operação de container'],
  [/^(systemctl|service)\s/, 'gerenciamento de serviços'],
  [/^(chmod|chown)\s/, 'permissão de arquivos'],
  [/^(pm2|forever)\s/, 'gerenciamento de processos Node'],
];

// ─── Classificação ───────────────────────────────────────────────────────────

export function classifyCommand(command: string): CommandClassify {
  const cmd = command.trim();
  if (!cmd) return { tier: 'DENY', reason: 'comando vazio' };

  for (const [re, why] of DENY_PATTERNS) {
    if (re.test(cmd)) return { tier: 'DENY', reason: why };
  }
  for (const [re, why] of AUTO_PATTERNS) {
    if (re.test(cmd)) return { tier: 'AUTO', reason: why };
  }
  for (const [re, why] of CONFIRM_HINTS) {
    if (re.test(cmd)) return { tier: 'CONFIRM', reason: why };
  }
  // Deny-by-default: tudo fora da allowlist exige confirmação humana.
  return { tier: 'CONFIRM', reason: 'fora da allowlist de leitura — requer confirmação' };
}

// ─── Execução ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 64 * 1024; // 64KB por stream

export async function runCommand(
  command: string,
  opts: { confirm?: boolean; cwd?: string; timeoutMs?: number } = {},
): Promise<CommandResult> {
  const { tier, reason } = classifyCommand(command);
  const started = Date.now();

  auditLogger.log({
    actor: 'SUBAGENT',
    event: 'deploy:command_classified',
    payload: { command, tier, reason, confirmed: opts.confirm === true },
  });

  if (tier === 'DENY') {
    eventBus.publish('deploy:command:denied', { command, reason });
    return {
      command, tier, executed: false,
      stdout: '', stderr: `⛔ BLOQUEADO: ${reason}. Este comando nunca é executado pelo Hermes.`,
      exitCode: null, durationMs: 0, deniedReason: reason,
    };
  }

  if (tier === 'CONFIRM' && opts.confirm !== true) {
    return {
      command, tier, executed: false, needsConfirmation: true,
      stdout: '', stderr: '',
      exitCode: null, durationMs: 0,
      deniedReason: undefined,
    };
  }

  // Windows: comandos .cmd (npm, pnpm…) exigem shell; deny-list já filtrou o perigoso.
  const isWin = process.platform === 'win32';
  return await new Promise<CommandResult>((resolve) => {
    const child = spawn(command, {
      shell: isWin ? 'cmd.exe' : '/bin/sh',
      cwd: opts.cwd || process.cwd(),
      env: { ...process.env, CI: '1', DEBIAN_FRONTEND: 'noninteractive' },
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;
    const timeout = setTimeout(() => {
      killed = true;
      child.kill();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        command, tier, executed: true,
        stdout, stderr: stderr + `\n[spawn error] ${err.message}`,
        exitCode: null, durationMs: Date.now() - started,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      const result: CommandResult = {
        command, tier, executed: true,
        stdout: stdout.slice(0, MAX_OUTPUT),
        stderr: (killed ? `[timeout ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms — processo morto]\n` : '') + stderr.slice(0, MAX_OUTPUT),
        exitCode: code,
        durationMs: Date.now() - started,
      };
      auditLogger.log({
        actor: 'SUBAGENT',
        event: 'deploy:command_executed',
        payload: { command, tier, exitCode: code, durationMs: result.durationMs, killed },
      });
      eventBus.publish('deploy:command:executed', { command, tier, exitCode: code });
      resolve(result);
    });
  });
}
