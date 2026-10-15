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

const BASE = (process.env.GITEA_BASE_URL || 'http://localhost:3011').replace(/\/+$/, '');
const TOKEN = process.env.GITEA_TOKEN || '';
const OWNER = process.env.GITEA_OWNER || '';

function authHeaders() {
  return { Authorization: `token ${TOKEN}`, 'Content-Type': 'application/json' };
}

/** Testa a conexão com o Gitea e devolve a versão do servidor. */
async function testConnection() {
  if (!BASE) return { connected: false, message: 'GITEA_BASE_URL não definido no .env.' };
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/api/v1/version`, {
      headers: TOKEN ? authHeaders() : {},
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Date.now() - started;
    const body = await res.text();
    if (!res.ok) {
      return { connected: false, httpStatus: res.status, latencyMs, message: `Gitea respondeu HTTP ${res.status}. ${body.slice(0, 200)}` };
    }
    let version = '';
    try { version = JSON.parse(body).version || ''; } catch { /* body pode não ser JSON */ }
    return {
      connected: true,
      httpStatus: res.status,
      latencyMs,
      version,
      message: `Gitea ${version || 'online'} acessível em ${BASE} (${latencyMs}ms).`,
    };
  } catch (err) {
    return {
      connected: false,
      latencyMs: Date.now() - started,
      message: `Não foi possível alcançar o Gitea em ${BASE}: ${err.message}. Suba o container gitea (ver docker-compose abaixo).`,
    };
  }
}

/** Lista repositórios do owner autenticado (ou do OWNER configurado). */
async function listRepos() {
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

export { testConnection, listRepos, listWebhooks, createWebhook, createLocalBackup, listBackups, BASE, OWNER, TOKEN };

