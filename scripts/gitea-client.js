#!/usr/bin/env node
/**
 * Gitea self-hosted client — versionamento local, endpoints e backup.
 *
 * Substitui o GitHub para um setup local: repositórios Git, API REST,
 * webhooks e `gitea dump` para backup. Este cliente fala a API REST v1
 * do Gitea e, opcionalmente, executa um backup local do repositório
 * atual via `git bundle` (proteção contra erros / rollback).
 *
 * Config (via .env):
 *   GITEA_BASE_URL   ex: http://localhost:3000
 *   GITEA_TOKEN      token de acesso pessoal (Settings → Applications)
 *   GITEA_OWNER      usuário/organização dono dos repos
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ⚠️ Leitura LAZY do process.env: este módulo é importado (static import) pelo
// src/index.ts, e no ESM os imports executam ANTES do corpo do módulo importador —
// ou seja, antes de bootstrap() chamar loadDotEnv(). Se BASE/TOKEN/OWNER fossem
// consts no top-level, seriam congelados vazios mesmo com o .env correto.
// Ler as variáveis em cada chamada garante que o .env já tenha sido carregado.
function getBaseUrl() {
  return (process.env.GITEA_BASE_URL || 'http://localhost:3011').replace(/\/+$/, '');
}
function getToken() {
  return process.env.GITEA_TOKEN || '';
}
function getOwner() {
  return process.env.GITEA_OWNER || '';
}

function authHeaders() {
  return { Authorization: `token ${getToken()}`, 'Content-Type': 'application/json' };
}

/**
 * Compara process.env com o .env em disco. Detecta o caso clássico em que uma
 * variável GITEA_* antiga herdada do terminal (ambiente VENCE o .env no
 * loadDotEnv) sobrescreve a configuração correta — causando HTTP 401 com
 * "user does not exist" mesmo com o token certo no .env.
 */
function envMismatchWarnings() {
  const disk = {};
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*(GITEA_[A-Z_0-9]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2].replace(/\s+#.*$/, '').trim();
      if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1);
      disk[m[1]] = v;
    }
  } catch { return []; }
  const warn = [];
  for (const [k, fileVal] of Object.entries(disk)) {
    const runVal = (process.env[k] ?? '').trim();
    if (fileVal && runVal && runVal !== fileVal) {
      warn.push(`${k} em uso (${runVal.slice(0, 8)}…) difere do .env (${fileVal.slice(0, 8)}…) — uma variável herdada do terminal está sobrescrevendo o .env; abra um terminal NOVO e reinicie.`);
    }
  }
  return warn;
}

/** Testa a conexão com o Gitea e devolve a versão do servidor. */
async function testConnection() {
  if (!getBaseUrl()) return { connected: false, message: 'GITEA_BASE_URL não definido no .env.' };
  const started = Date.now();
  const BASE = getBaseUrl();
  const TOKEN = getToken();
  try {
    const res = await fetch(`${BASE}/api/v1/version`, {
      headers: TOKEN ? authHeaders() : {},
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Date.now() - started;
    const body = await res.text();
    const mismatch = envMismatchWarnings();
    if (!res.ok) {
      return { connected: false, httpStatus: res.status, latencyMs, envMismatch: mismatch, message: `Gitea respondeu HTTP ${res.status}. ${body.slice(0, 200)}${mismatch.length ? ' — ' + mismatch.join(' | ') : ''}` };
    }
    let version = '';
    try { version = JSON.parse(body).version || ''; } catch { /* body pode não ser JSON */ }
    return {
      connected: true,
      httpStatus: res.status,
      latencyMs,
      version,
      envMismatch: mismatch,
      message: `Gitea ${version || 'online'} acessível em ${BASE} (${latencyMs}ms).${mismatch.length ? ' ⚠️ ' + mismatch.join(' | ') : ''}`,
    };
  } catch (err) {
    const mismatch = envMismatchWarnings();
    return {
      connected: false,
      latencyMs: Date.now() - started,
      envMismatch: mismatch,
      message: `Não foi possível alcançar o Gitea em ${BASE}: ${err.message}. Suba o container gitea (ver docker-compose abaixo).${mismatch.length ? ' ⚠️ ' + mismatch.join(' | ') : ''}`,
    };
  }
}

/** Lista repositórios do owner autenticado (ou do OWNER configurado). */
async function listRepos() {
  const BASE = getBaseUrl();
  const TOKEN = getToken();
  if (!TOKEN) return { ok: false, repos: [], message: 'GITEA_TOKEN não definido — não é possível listar repositórios.' };
  try {
    const res = await fetch(`${BASE}/api/v1/user/repos?limit=50`, { headers: authHeaders(), signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, repos: [], message: `HTTP ${res.status} ao listar repos.` };
    const repos = await res.json();
    return {
      ok: true,
      repos: (Array.isArray(repos) ? repos : []).map((r) => ({
        name: r.name, fullName: r.full_name, private: r.private,
        cloneUrl: r.clone_url, sshUrl: r.ssh_url, defaultBranch: r.default_branch,
        updatedAt: r.updated_at, openIssues: r.open_issues_count,
      })),
      message: '',
    };
  } catch (err) {
    return { ok: false, repos: [], message: `Falha de rede: ${err.message}` };
  }
}

/** Lista webhooks de um repositório. */
async function listWebhooks(repo) {
  const BASE = getBaseUrl();
  const TOKEN = getToken();
  const OWNER = getOwner();
  if (!TOKEN || !OWNER || !repo) return { ok: false, hooks: [], message: 'GITEA_TOKEN, GITEA_OWNER e repo são necessários.' };
  try {
    const res = await fetch(`${BASE}/api/v1/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(repo)}/hooks`, {
      headers: authHeaders(), signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, hooks: [], message: `HTTP ${res.status} ao listar webhooks.` };
    const hooks = await res.json();
    return {
      ok: true,
      hooks: (Array.isArray(hooks) ? hooks : []).map((h) => ({
        id: h.id, type: h.type, active: h.active, events: h.events, url: h.config && h.config.url,
      })),
      message: '',
    };
  } catch (err) {
    return { ok: false, hooks: [], message: `Falha de rede: ${err.message}` };
  }
}

/** Cria um webhook do tipo "gitea" apontando para uma URL de destino. */
async function createWebhook(repo, targetUrl, events = ['push', 'pull_request', 'issues']) {
  const BASE = getBaseUrl();
  const TOKEN = getToken();
  const OWNER = getOwner();
  if (!TOKEN || !OWNER || !repo) return { ok: false, message: 'GITEA_TOKEN, GITEA_OWNER e repo são necessários.' };
  if (!targetUrl) return { ok: false, message: 'Informe a URL de destino do webhook.' };
  try {
    const res = await fetch(`${BASE}/api/v1/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(repo)}/hooks`, {
      method: 'POST',
      headers: authHeaders(),
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ type: 'gitea', active: true, events, config: { url: targetUrl, content_type: 'json' } }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, message: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const hook = await res.json();
    return { ok: true, hook: { id: hook.id, url: hook.config && hook.config.url, events: hook.events }, message: `Webhook #${hook.id} criado para ${repo}.` };
  } catch (err) {
    return { ok: false, message: `Falha de rede: ${err.message}` };
  }
}

/**
 * Backup local do repositório git atual usando `git bundle`.
 * Gera um arquivo único portátil (contém todo o histórico) — proteção
 * contra erros e base para rollback, sem depender do Gitea estar no ar.
 */
function createLocalBackup(destDir = 'backups') {
  const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim() || 'main';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.isAbsolute(destDir) ? destDir : path.join(repoRoot, destDir);
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `hermes-${branch}-${stamp}.bundle`);
  try {
    execSync(`git bundle create "${file}" --all`, { cwd: repoRoot, stdio: 'ignore' });
    const bytes = fs.statSync(file).size;
    return { ok: true, file: path.relative(repoRoot, file), bytes, branch, message: `Bundle criado (${(bytes / 1024).toFixed(1)} KB).` };
  } catch (err) {
    return { ok: false, message: `Falha ao criar bundle: ${err.message}` };
  }
}

/** Lista os bundles de backup já gerados localmente. */
function listBackups(destDir = 'backups') {
  try {
    const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    const outDir = path.isAbsolute(destDir) ? destDir : path.join(repoRoot, destDir);
    if (!fs.existsSync(outDir)) return { ok: true, backups: [] };
    const backups = fs
      .readdirSync(outDir)
      .filter((f) => f.endsWith('.bundle'))
      .map((f) => {
        const st = fs.statSync(path.join(outDir, f));
        return { file: f, bytes: st.size, createdAt: st.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, backups };
  } catch (err) {
    return { ok: false, backups: [], message: err.message };
  }
}

export { testConnection, listRepos, listWebhooks, createWebhook, createLocalBackup, listBackups, getBaseUrl, getOwner, getToken };

