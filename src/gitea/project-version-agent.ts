/**
 * ProjectVersionAgent — agente de versionamento das pastas de projeto.
 *
 * Monitora F:\Projetos2026\DevMaster\<proj> (criadas pelo orquestrador) e a cada
 * ciclo faz save point com push SIMULTÂNEO para dois remotes:
 *
 *   • Gitea (LOCAL — pode guardar TUDO): branch `main` (limpa) + branch
 *     `hermes-full` montada com índice temporário (GIT_INDEX_FILE) que force-adda
 *     .env/keys/tokens — ou seja, o Gitea recebe o save point COMPLETO sem
 *     bagunçar a working tree nem o `main`.
 *   • GitHub (REMOTO — NUNCA leva segredos):
 *       1. .gitignore gerenciado (bloco >>> HERMES-SEGREDOS <<<) — .env, *.pem,
 *          *.key, tokens, credentials, sqlite… nunca entram no `main`;
 *       2. SCAN DE SEGREDOS no que está rastreado — se achar chave/token/chave
 *          privada (sk-, ghp_, AKIA, PEM, Bearer…), o push é BLOQUEADO e o
 *          relatório mostra só arquivo+linha+tipo (NUNCA o valor).
 *     O push ao GitHub usa `main:main` explícito — `hermes-full` NUNCA sai.
 *
 * Tokens: usados via `git -c http.extraHeader` (nunca gravados na URL do remote)
 * e passam por redact() em toda saída/log/audit.
 *
 * Monitor: setInterval liga/desliga por config (data/version-agent-config.json);
 * trava `running` evita sobreposição; auto-skip quando não há alterações.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { auditLogger } from '../core/audit-logger.js';
import { listProjects } from '../orchestrator/project-store.js';
import { getBaseUrl, getOwner, getToken, testConnection } from '../../scripts/gitea-client.js';

// ─── Config ──────────────────────────────────────────────────────────────────

export interface VersionAgentConfig {
  enabled: boolean;        // monitor automático ligado
  intervalSec: number;     // período do tick (default 60)
  gitea: boolean;          // push no Gitea local (default true)
  github: boolean;         // push no GitHub remoto (default true)
  githubPrivate: boolean;  // repos GitHub criados privados (default true)
}

const CONFIG_PATH = join(process.cwd(), 'data', 'version-agent-config.json');
const DEFAULT_CONFIG: VersionAgentConfig = {
  enabled: false, intervalSec: 60, gitea: true, github: true, githubPrivate: true,
};

export function loadConfig(): VersionAgentConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<VersionAgentConfig>;
    const c = { ...DEFAULT_CONFIG };
    if (typeof raw.enabled === 'boolean') c.enabled = raw.enabled;
    if (typeof raw.intervalSec === 'number' && raw.intervalSec >= 10) c.intervalSec = Math.min(3600, Math.floor(raw.intervalSec));
    if (typeof raw.gitea === 'boolean') c.gitea = raw.gitea;
    if (typeof raw.github === 'boolean') c.github = raw.github;
    if (typeof raw.githubPrivate === 'boolean') c.githubPrivate = raw.githubPrivate;
    return c;
  } catch { return { ...DEFAULT_CONFIG }; }
}

export function saveConfig(partial: Partial<VersionAgentConfig>): VersionAgentConfig {
  const next = { ...loadConfig() };
  if (typeof partial.enabled === 'boolean') next.enabled = partial.enabled;
  if (typeof partial.intervalSec === 'number' && partial.intervalSec >= 10) next.intervalSec = Math.min(3600, Math.floor(partial.intervalSec));
  if (typeof partial.gitea === 'boolean') next.gitea = partial.gitea;
  if (typeof partial.github === 'boolean') next.github = partial.github;
  if (typeof partial.githubPrivate === 'boolean') next.githubPrivate = partial.githubPrivate;
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  applyConfig();
  return next;
}

// ─── Log em anel (para a aba) ────────────────────────────────────────────────

export interface AgentLogEntry {
  ts: string; level: 'info' | 'ok' | 'aviso' | 'erro'; msg: string; project?: string;
}
const agentLog: AgentLogEntry[] = [];
function log(level: AgentLogEntry['level'], msg: string, project?: string): void {
  agentLog.push({ ts: new Date().toISOString(), level, msg, project });
  while (agentLog.length > 60) agentLog.shift();
}
export function getLog(): AgentLogEntry[] { return [...agentLog].reverse(); }

// ─── Redação de segredos em qualquer saída ──────────────────────────────────

export function redact(s: string): string {
  let out = String(s ?? '');
  for (const k of ['GITEA_TOKEN', 'GITHUB_TOKEN', 'COMPOSIO_API_KEY', 'LITELLM_MASTER_KEY'] as const) {
    const v = process.env[k];
    if (v && v.length >= 8) out = out.split(v).join('***');
  }
  // credenciais embutidas em URL (http://user:senha@host) → http://***@host
  out = out.replace(/https?:\/\/[^/\s]*@/g, 'https://***@');
  // chaves estilo sk-... que escaparam (mostra só 6+6)
  out = out.replace(/\bsk-[A-Za-z0-9_\-]{12,}/g, (m) => `${m.slice(0, 9)}…***`);
  return out;
}

// ─── Git helpers (execFileSync — sem shell, sem problemas de quoting) ───────

function gitf(dir: string, args: string[], env?: NodeJS.ProcessEnv): string {
  const out = execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  return out.trim();
}

function gitTry(dir: string, args: string[], env?: NodeJS.ProcessEnv): { ok: boolean; out: string; err: string } {
  try { return { ok: true, out: gitf(dir, args, env), err: '' }; }
  catch (e: unknown) {
    const msg = e instanceof Error ? (e as { stderr?: string }).stderr || e.message : String(e);
    return { ok: false, out: '', err: redact(msg) };
  }
}

// ─── .gitignore gerenciado (bloco de segredos) ──────────────────────────────

const GI_START = '# >>> HERMES-SEGREDOS (gerenciado pelo agente — não remover)';
const GI_END = '# <<< HERMES-SEGREDOS';
const GI_BLOCK = [
  '.env', '.env.*', '!.env.example',
  '*.pem', '*.key', '*.p12', '*.pfx', '*.ppk',
  'id_rsa*', '*.token',
  '.secrets/', 'secrets.*', '*credentials*',
  '*.sqlite', '*.sqlite3', '*.db',
  '*.bundle',
  'node_modules/', 'dist/', 'build/', 'coverage/', '.hermes/',
].join('\n');

function ensureGitignore(dir: string): boolean {
  const p = join(dir, '.gitignore');
  let cur = '';
  try { cur = readFileSync(p, 'utf8'); } catch { /* novo */ }
  if (cur.includes('HERMES-SEGREDOS')) return false;
  const next = (cur ? cur.replace(/\s*$/, '\n\n') : '') + GI_START + '\n' + GI_BLOCK + '\n' + GI_END + '\n';
  writeFileSync(p, next, 'utf8');
  return true;
}

// ─── Scan de segredos (gate do GitHub) ──────────────────────────────────────

export interface SecretFinding { file: string; line: number; pattern: string; }

const SECRET_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: 'chave estilo sk- (OpenAI/Anthropic/LiteLLM)', re: /\bsk-[A-Za-z0-9_\-]{16,}/ },
  { id: 'token GitHub (ghp_/gho_/ghs_/github_pat_)', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/ },
  { id: 'token Slack (xox…)', re: /\bxox[baprs]-[A-Za-z0-9\-]{10,}/ },
  { id: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'Google API key (AIza…)', re: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { id: 'chave privada (bloco PEM)', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: 'token tipo Bearer longo', re: /\bBearer\s+[A-Za-z0-9._~+/\-]{24,}={0,2}/ },
  { id: 'segredo em atribuição (api_key/token/secret/password)', re: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd)\b\s*[:=]\s*["'][A-Za-z0-9._\-]{16,}["']/i },
  { id: 'webhook URL com segredo', re: /hooks\.slack\.com\/services\/[A-Za-z0-9/]+/ },
];

const SENSITIVE_NAME_RE = /(^\.env($|\.)|\.(pem|key|p12|pfx|ppk|token|sqlite3?)$|credentials|secrets?|id_rsa)/i;

function scanForSecrets(dir: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const ls = gitTry(dir, ['ls-files', '-z']);
  if (!ls.ok) return findings;
  const files = ls.out.split('\0').filter(Boolean);
  for (const f of files) {
    if (findings.length >= 60) break;
    if (SENSITIVE_NAME_RE.test(basename(f))) {
      findings.push({ file: f, line: 0, pattern: 'nome de arquivo sensível rastreado (.env/keys/tokens)' });
      continue;
    }
    const abs = join(dir, f);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (!st.isFile() || st.size > 1_500_000) continue;
    let content: string;
    try { content = readFileSync(abs, 'utf8'); } catch { continue; }
    if (content.includes('\0')) continue; // binário
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].length > 4000 ? lines[i].slice(0, 4000) : lines[i];
      for (const p of SECRET_PATTERNS) {
        if (p.re.test(line)) {
          findings.push({ file: f, line: i + 1, pattern: p.id });
          break;
        }
      }
      if (findings.length >= 60) break;
    }
  }
  return findings;
}

// ─── Estado / preparo do repo ───────────────────────────────────────────────

function ensureRepo(dir: string): { fresh: boolean } {
  const fresh = !existsSync(join(dir, '.git'));
  if (fresh) {
    gitf(dir, ['init']);
    try { gitf(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main']); } catch { /* ok */ }
  }
  gitf(dir, ['config', 'user.name', 'Hermes Version Agent']);
  gitf(dir, ['config', 'user.email', 'hermes@localhost']);
  gitf(dir, ['config', 'commit.gpgsign', 'false']);
  if (!fresh) {
    const b = gitTry(dir, ['symbolic-ref', '--short', 'HEAD']);
    if (b.ok && b.out && b.out !== 'main') gitTry(dir, ['branch', '-M', 'main']);
  }
  return { fresh };
}

function hasChanges(dir: string): boolean {
  // Repo ainda inexistente = tudo a versionar (caso contrário o tick auto
  // pularia projetos recém-criados, pois `git status` falha fora de um repo).
  if (!existsSync(join(dir, '.git'))) return true;
  const r = gitTry(dir, ['status', '--porcelain']);
  return r.ok && r.out.length > 0;
}

function commitLocal(dir: string, message?: string): { hash: string; files: number; skipped: boolean } {
  gitf(dir, ['add', '-A']);
  const staged = gitf(dir, ['diff', '--cached', '--name-only']);
  if (!staged) {
    const head = gitTry(dir, ['rev-parse', '--short', 'HEAD']);
    return { hash: head.out || '', files: 0, skipped: true };
  }
  const n = staged.split('\n').filter(Boolean).length;
  const d = new Date().toISOString();
  const msg = (message && message.trim()
    ? message.trim()
    : `save: ${d.slice(0, 16).replace('T', ' ')} — ${n} arquivo(s)`
  ).replace(/[\r\n]+/g, ' ').slice(0, 400);
  gitf(dir, ['commit', '-m', msg]);
  const hash = gitf(dir, ['rev-parse', '--short', 'HEAD']);
  return { hash, files: n, skipped: false };
}

function ensureRemote(dir: string, name: string, url: string): void {
  const r = gitTry(dir, ['remote', 'get-url', name]);
  if (r.ok) { if (r.out !== url) gitf(dir, ['remote', 'set-url', name, url]); }
  else gitf(dir, ['remote', 'add', name, url]);
}

/**
 * Branch `hermes-full` = árvore do `main` + arquivos ignorados sensíveis,
 * montada com ÍNDICE TEMPORÁRIO (não toca na working tree). É essa branch que
 * vai só para o Gitea (save point completo com .env etc.).
 */
function buildFullBranch(dir: string): { ok: boolean; secrets: number; err: string } {
  const ignored = gitTry(dir, ['status', '--ignored', '--porcelain'])
    .out.split('\n')
    .filter((l) => l.startsWith('!! '))
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, '').replace(/\/$/, ''))
    .filter((p) => p && SENSITIVE_NAME_RE.test(basename(p)) && !/[\\/]node_modules([\\/]|$)/.test(p))
    .slice(0, 50);

  const idx = join(dir, '.git', 'hermes-full.index');
  try { rmSync(idx, { force: true }); } catch { /* ok */ }
  const env: NodeJS.ProcessEnv = { GIT_INDEX_FILE: idx };
  try {
    const head = gitTry(dir, ['rev-parse', 'HEAD']);
    if (!head.ok) return { ok: false, secrets: 0, err: 'repo sem commits' };
    gitf(dir, ['read-tree', 'HEAD'], env);
    for (const f of ignored) gitTry(dir, ['add', '-f', '--', f], env);
    const tree = gitf(dir, ['write-tree'], env);
    let parent = '';
    const prev = gitTry(dir, ['rev-parse', 'refs/heads/hermes-full']);
    parent = prev.ok ? 'refs/heads/hermes-full' : 'HEAD';
    const commit = gitf(dir, ['commit-tree', tree, '-p', parent, '-m', `full: save point ${new Date().toISOString()}`], env);
    gitf(dir, ['update-ref', 'refs/heads/hermes-full', commit]);
    return { ok: true, secrets: ignored.length, err: '' };
  } catch (e: unknown) {
    const msg = e instanceof Error ? (e as { stderr?: string }).stderr || e.message : String(e);
    return { ok: false, secrets: 0, err: redact(msg) };
  } finally {
    try { rmSync(idx, { force: true }); } catch { /* ok */ }
  }
}

// ─── Gitea (local — guarda tudo) ─────────────────────────────────────────────

async function giteaApi(pathname: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: unknown }> {
  const base = getBaseUrl();
  const token = getToken();
  const res = await fetch(`${base}${pathname}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `token ${token}` } : {}), ...(init?.headers || {}) },
    signal: AbortSignal.timeout(15_000),
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* vazio */ }
  return { ok: res.ok, status: res.status, json };
}

async function ensureGiteaRepo(name: string): Promise<{ ok: boolean; detail: string }> {
  const owner = getOwner();
  if (!getToken()) return { ok: false, detail: 'GITEA_TOKEN não definido no .env' };
  const exists = await giteaApi(`/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
  if (exists.ok) return { ok: true, detail: 'repositório já existe' };
  const created = await giteaApi('/api/v1/user/repos', {
    method: 'POST',
    body: JSON.stringify({ name, private: true, auto_init: false }),
  });
  if (created.ok || created.status === 422) return { ok: true, detail: created.ok ? 'repositório criado' : 'repositório já existia' };
  return { ok: false, detail: `Gitea HTTP ${created.status}` };
}

async function pushGitea(dir: string, name: string): Promise<{ ok: boolean; detail: string; full?: boolean }> {
  const prep = await ensureGiteaRepo(name);
  if (!prep.ok) return { ok: false, detail: prep.detail };
  const owner = getOwner();
  const url = `${getBaseUrl()}/${owner}/${name}.git`;
  ensureRemote(dir, 'gitea', url);
  const token = getToken();
  const args = ['-c', `http.extraHeader=Authorization: token ${token}`, 'push', 'gitea', 'main:main'];
  const r = gitTry(dir, args);
  if (!r.ok) return { ok: false, detail: r.err.slice(0, 400) };
  // Save point COMPLETO na branch hermes-full (só Gitea recebe).
  const full = buildFullBranch(dir);
  let fullOk = false;
  if (full.ok) {
    const fr = gitTry(dir, ['-c', `http.extraHeader=Authorization: token ${token}`, 'push', 'gitea', 'hermes-full:hermes-full']);
    fullOk = fr.ok;
    if (!fr.ok) return { ok: true, detail: `main ok (${prep.detail}); hermes-full falhou: ${fr.err.slice(0, 200)}`, full: false };
    return { ok: true, detail: `main + hermes-full ok (${prep.detail}; ${full.secrets} arquivo(s) sensível(eis) no full)`, full: true };
  }
  return { ok: true, detail: `main ok (${prep.detail}); full pulado: ${full.err.slice(0, 200)}`, full: fullOk };
}

// ─── GitHub (remoto — gate de segredos) ─────────────────────────────────────

let ghLoginCache: { login: string; at: number } | null = null;

function ghApi(pathname: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: any }> {
  const api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  const token = process.env.GITHUB_TOKEN || '';
  return fetch(`${api}${pathname}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+-json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(20_000),
  }).then(async (res) => {
    let json: any = null;
    try { json = await res.json(); } catch { /* vazio */ }
    return { ok: res.ok, status: res.status, json };
  });
}

async function ghLogin(): Promise<string> {
  if (ghLoginCache && Date.now() - ghLoginCache.at < 300_000) return ghLoginCache.login;
  const r = await ghApi('/user');
  if (!r.ok) throw new Error(`GitHub API /user HTTP ${r.status}: ${redact(r.json?.message || '')}`);
  ghLoginCache = { login: r.json.login, at: Date.now() };
  return r.json.login as string;
}

export async function ghEnsureRepo(name: string, isPrivate: boolean): Promise<{ ok: boolean; detail: string; full?: string }> {
  if (!process.env.GITHUB_TOKEN) return { ok: false, detail: 'GITHUB_TOKEN não definido no .env' };
  const login = await ghLogin();
  const full = `${login}/${name}`;
  const exists = await ghApi(`/repos/${login}/${encodeURIComponent(name)}`);
  if (exists.ok) return { ok: true, detail: 'repositório já existe', full };
  const created = await ghApi('/user/repos', {
    method: 'POST',
    body: JSON.stringify({ name, private: isPrivate, auto_init: false, description: 'Hermes Control Center — save points do projeto' }),
  });
  if (created.ok) return { ok: true, detail: 'repositório criado', full };
  if (created.status === 422) return { ok: true, detail: 'repositório já existia', full };
  return { ok: false, detail: `GitHub HTTP ${created.status}: ${redact(created.json?.message || '')}`, full };
}

async function pushGitHub(dir: string, name: string, isPrivate: boolean): Promise<{
  ok: boolean; blocked?: boolean; detail: string; findings?: SecretFinding[];
}> {
  // 1) GATE — scan do que está rastreado ANTES de qualquer chamada à API.
  const findings = scanForSecrets(dir);
  if (findings.length) {
    return { ok: false, blocked: true, detail: `push BLOQUEADO: ${findings.length} possível(is) segredo(s) em arquivos rastreados (GitHub)`, findings };
  }
  // 2) Repo + push APENAS de main:main (hermes-full jamais sai).
  const prep = await ghEnsureRepo(name, isPrivate);
  if (!prep.ok) return { ok: false, detail: prep.detail };
  ensureRemote(dir, 'github', `https://github.com/${prep.full}.git`);
  const b64 = Buffer.from(`x-access-token:${process.env.GITHUB_TOKEN}`).toString('base64');
  const r = gitTry(dir, ['-c', `http.extraHeader=Authorization: Basic ${b64}`, 'push', 'github', 'main:main']);
  if (!r.ok) return { ok: false, detail: r.err.slice(0, 400) };
  return { ok: true, detail: `push ok → github.com/${prep.full} (main)` };
}

// ─── Ciclo de save point ────────────────────────────────────────────────────

export interface ProjectVersionResult {
  project: string; path: string; ok: boolean;
  changes: boolean;
  commit?: { hash: string; files: number; skipped: boolean; message: string };
  gitignoreFixed?: boolean;
  gitea?: { ok: boolean; detail: string; full?: boolean };
  github?: { ok: boolean; blocked?: boolean; detail: string; findings?: SecretFinding[] };
  errors: string[];
}

async function runOne(project: { name: string; path: string }, cfg: VersionAgentConfig, message?: string): Promise<ProjectVersionResult> {
  const res: ProjectVersionResult = { project: project.name, path: project.path, ok: false, changes: false, errors: [] };
  try {
    const gi = ensureGitignore(project.path);
    res.gitignoreFixed = gi;
    ensureRepo(project.path);
    res.changes = hasChanges(project.path);
    const commit = commitLocal(project.path, message);
    res.commit = { ...commit, message: message || `save point ${new Date().toISOString()}` };
    if (commit.skipped && !message) {
      // sem alterações — ainda assim tenta empurrar pendências barato (up-to-date)
      log('info', `${project.name}: sem alterações — só sincronizando`, project.name);
    }

    const [g, h] = await Promise.all([
      cfg.gitea ? pushGitea(project.path, project.name) : Promise.resolve(undefined),
      cfg.github ? pushGitHub(project.path, project.name, cfg.githubPrivate) : Promise.resolve(undefined),
    ]);
    if (g) res.gitea = g;
    if (h) res.github = h;

    res.ok = (!g || g.ok) && (!h || h.ok);
    if (gi) log('ok', `${project.name}: .gitignore de segredos (re)criado`, project.name);
    if (res.commit && !commit.skipped) log('ok', `${project.name}: commit local ${commit.hash} (${commit.files} arquivo(s))`, project.name);
    if (g) log(g.ok ? 'ok' : 'erro', `${project.name} → Gitea: ${g.detail}`, project.name);
    if (h) {
      if (h.blocked) {
        log('aviso', `${project.name} → GitHub BLOQUEADO por segredos: ${h.findings!.map((f) => `${f.file}${f.line ? ':' + f.line : ''} (${f.pattern})`).join('; ').slice(0, 400)}`, project.name);
      } else {
        log(h.ok ? 'ok' : 'erro', `${project.name} → GitHub: ${h.detail}`, project.name);
      }
    }
    auditLogger.log({
      actor: 'SUBAGENT',
      event: h?.blocked ? 'version:blocked:secrets' : 'version:savepoint',
      payload: {
        project: project.name,
        commit: res.commit?.hash || '',
        files: res.commit?.files || 0,
        gitea: g ? g.ok : null,
        github: h ? (h.blocked ? 'blocked' : h.ok) : null,
        findings: h?.findings?.map((f) => `${f.file}:${f.line}`) || [],
      },
    });
  } catch (e) {
    const m = redact(e instanceof Error ? e.message : String(e));
    res.errors.push(m);
    log('erro', `${project.name}: ${m}`, project.name);
    auditLogger.log({ actor: 'SUBAGENT', event: 'version:error', payload: { project: project.name, error: m } });
  }
  return res;
}

export async function runAll(opts?: { project?: string; message?: string; auto?: boolean }): Promise<ProjectVersionResult[]> {
  const cfg = loadConfig();
  const projects = listProjects().filter((p) => !opts?.project || p.name === opts.project);
  const out: ProjectVersionResult[] = [];
  for (const p of projects) {
    if (opts?.auto && !hasChanges(p.path)) continue; // tick sem mudanças = no-op
    out.push(await runOne(p, cfg, opts?.message));
  }
  if (opts?.auto && out.length) log('info', `ciclo automático: ${out.length} projeto(s)`);
  return out;
}

// ─── Monitor ────────────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRunAt: string | null = null;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runAll({ auto: true });
    lastRunAt = new Date().toISOString();
  } catch (e) {
    log('erro', `tick: ${redact(e instanceof Error ? e.message : String(e))}`);
  } finally {
    running = false; }
}

/** (Re)cria o timer conforme config — chamado no boot e ao salvar config. */
export function applyConfig(): void {
  const cfg = loadConfig();
  if (timer) { clearInterval(timer); timer = null; }
  if (cfg.enabled) {
    timer = setInterval(() => { void tick(); }, Math.max(10, cfg.intervalSec) * 1000);
    (timer as unknown as { unref?: () => void }).unref?.();
    log('info', `monitor ATIVO — verificando pastas a cada ${cfg.intervalSec}s`);
  } else if (agentLog.length === 0 || !agentLog.some((l) => l.msg.startsWith('monitor'))) {
    log('info', 'monitor desligado (ative no card acima)');
  }
}

export function monitorState(): { enabled: boolean; ticking: boolean; running: boolean; lastRunAt: string | null } {
  return { enabled: !!timer, ticking: timer !== null, running, lastRunAt };
}

/** Status completo para a aba Versionamento & Backup. */
export async function getStatus(): Promise<Record<string, unknown>> {
  const cfg = loadConfig();
  const projects = listProjects().map((p) => {
    const isRepo = existsSync(join(p.path, '.git'));
    let changes = -1; let lastCommit = '';
    if (isRepo) {
      const st = gitTry(p.path, ['status', '--porcelain']);
      changes = st.ok ? st.out.split('\n').filter(Boolean).length : -1;
      const lc = gitTry(p.path, ['log', '-1', '--pretty=format:%h %ad %s', '--date=format:%d/%m %H:%M']);
      if (lc.ok) lastCommit = lc.out;
    }
    return { name: p.name, path: p.path, isRepo, changes, lastCommit };
  });
  let github: Record<string, unknown> = { configured: !!process.env.GITHUB_TOKEN, login: '', api: process.env.GITHUB_API_URL || 'https://api.github.com' };
  if (process.env.GITHUB_TOKEN) {
    try { github = { ...github, login: await ghLogin() }; }
    catch (e) { github = { ...github, login: '', error: redact(e instanceof Error ? e.message : String(e)) }; }
  }
  let gitea: Record<string, unknown> = { configured: !!getToken(), base: getBaseUrl(), owner: getOwner(), connected: false };
  try { const t = await testConnection(); gitea = { ...gitea, connected: t.connected, version: t.version || '' }; }
  catch { /* offline */ }
  return {
    config: cfg,
    monitor: monitorState(),
    github,
    gitea,
    projects,
    log: getLog().slice(0, 30),
  };
}
