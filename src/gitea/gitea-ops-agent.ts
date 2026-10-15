/**
 * GiteaOpsAgent — Subagente autonomo para versionamento local no Gitea.
 * Backups em F:\Projetos Backup\{projeto}\.
 * Modelos gratis OpenRouter/Google, fallback DeepSeek barato.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { auditLogger } from '../core/audit-logger.js';
import { eventBus } from '../core/event-bus.js';
import { testConnection, listRepos, createWebhook, BASE as GITEA_BASE, OWNER as GITEA_OWNER, TOKEN as GITEA_TOKEN } from '../../scripts/gitea-client.js';

const BACKUP_ROOT = 'F:\\Projetos Backup';
const FREE_MODELS = ['openrouter-qwen-free','gemini-flash-free','openrouter-deepseek-free','openrouter-mistral-free','gemini-flash','deepseek-code'];

export interface GiteaRepoConfig { projectName: string; repoName: string; description: string; }
export interface GiteaOpsResult { ok: boolean; step: string; detail: string; data?: unknown; }
export interface AutoCommitResult extends GiteaOpsResult { filesCommitted: string[]; commitHash: string; branch: string; }
export interface BackupResult extends GiteaOpsResult { backupPath: string; sizeBytes: number; files: string[]; }
export interface GiteaOpsHealth { giteaConnected: boolean; giteaVersion: string; authenticated: boolean; repos: number; lastBackup: string | null; projectName: string; }
export class GiteaOpsAgent {
  readonly projectName: string;
  readonly repoName: string;
  readonly localPath: string;
  readonly backupPath: string;

  constructor(config: GiteaRepoConfig) {
    this.projectName = config.projectName;
    this.repoName = config.repoName.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
    this.localPath = process.cwd();
    this.backupPath = join(BACKUP_ROOT, this.projectName);
    mkdirSync(this.backupPath, { recursive: true });
    auditLogger.log({ actor: 'SUBAGENT', event: 'gitea-ops:init', payload: { project: this.projectName, repo: this.repoName } });
  }

  async healthCheck(): Promise<GiteaOpsHealth> {
    const c = await testConnection();
    const r = await listRepos();
    const b = this.listBackups();
    return { giteaConnected: c.connected, giteaVersion: c.version || '?', authenticated: !!(GITEA_TOKEN && GITEA_OWNER), repos: r.ok ? r.repos.length : 0, lastBackup: b.length > 0 ? b[0].createdAt : null, projectName: this.projectName };
  }

  async createRepository(): Promise<GiteaOpsResult> {
    if (!GITEA_TOKEN || !GITEA_OWNER) return { ok: false, step: 'repo', detail: 'GITEA_TOKEN/OWNER ausentes' };
    try {
      const body = JSON.stringify({ name: this.repoName, description: 'Hermes GiteaOps', private: true, auto_init: false, default_branch: 'main' });
      const res = await fetch(`${GITEA_BASE}/api/v1/user/repos`, { method: 'POST', headers: { Authorization: `token ${GITEA_TOKEN}`, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(10000) });
      if (!res.ok && res.status !== 409) return { ok: false, step: 'repo', detail: `HTTP ${res.status}` };
      const remoteUrl = `${GITEA_BASE}/${GITEA_OWNER}/${this.repoName}.git`;
      try { execSync(`git remote add gitea ${remoteUrl}`, { cwd: this.localPath, stdio: 'ignore' }); }
      catch { execSync(`git remote set-url gitea ${remoteUrl}`, { cwd: this.localPath, stdio: 'ignore' }); }
      try { execSync('git push -u gitea main', { cwd: this.localPath, stdio: 'pipe' }); } catch { /* ok */ }
      eventBus.publish('gitea:repo:ready', { project: this.projectName, repo: this.repoName });
      return { ok: true, step: 'repo', detail: `Repo ${this.repoName} pronto` };
    } catch (e) { return { ok: false, step: 'repo', detail: (e as Error).message }; }
  }

  async autoCommit(msg?: string): Promise<AutoCommitResult> {
    try {
      const status = execSync('git status --porcelain', { cwd: this.localPath, encoding: 'utf8' }).trim();
      if (!status) return { ok: true, step: 'commit', detail: 'Sem alteracoes', filesCommitted: [], commitHash: '', branch: this.branch() };
      const files = status.split('\n').map(l => l.slice(3).trim()).filter(Boolean);
      execSync('git add -A', { cwd: this.localPath, stdio: 'ignore' });
      const cm = msg || await this.genCommitMsg(files);
      execSync(`git commit -m "${cm.replace(/"/g, '\'').slice(0, 300)}"`, { cwd: this.localPath, stdio: 'pipe' });
      const hash = execSync('git rev-parse --short HEAD', { cwd: this.localPath, encoding: 'utf8' }).trim();
      const br = this.branch();
      try { execSync(`git push gitea ${br}`, { cwd: this.localPath, stdio: 'pipe' }); } catch { /* offline ok */ }
      auditLogger.log({ actor: 'SUBAGENT', event: 'gitea-ops:commit', payload: { hash, branch: br, n: files.length } });
      return { ok: true, step: 'commit', detail: `${hash} (${files.length} files)`, filesCommitted: files, commitHash: hash, branch: br };
    } catch (e) { return { ok: false, step: 'commit', detail: (e as Error).message, filesCommitted: [], commitHash: '', branch: '' }; }
  }