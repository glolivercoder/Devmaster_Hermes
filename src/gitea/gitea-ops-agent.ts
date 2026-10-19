/**
 * GiteaOpsAgent — Subagente autonomo para versionamento local no Gitea.
 * Backups em F:\Projetos Backup\{projeto}\.
 * Modelos grátis OmniRoute/OpenRouter, fallback DeepSeek.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { auditLogger } from '../core/audit-logger.js';
import { eventBus } from '../core/event-bus.js';
import { testConnection, listRepos, createWebhook, getBaseUrl, getOwner, getToken } from '../../scripts/gitea-client.js';

const BACKUP_ROOT = 'F:\\Projetos Backup';
const FREE_MODELS = ['omniroute-code','openrouter-qwen-free','openrouter-deepseek-free','openrouter-mistral-free','deepseek-code'];

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
    return { giteaConnected: c.connected, giteaVersion: c.version || '?', authenticated: !!(getToken() && getOwner()), repos: r.ok ? r.repos.length : 0, lastBackup: b.length > 0 ? b[0].createdAt : null, projectName: this.projectName };
  }

  async createRepository(): Promise<GiteaOpsResult> {
    const GITEA_BASE = getBaseUrl();
    const GITEA_TOKEN = getToken();
    const GITEA_OWNER = getOwner();
    if (!GITEA_TOKEN || !GITEA_OWNER) return { ok: false, step: 'repo', detail: 'GITEA_TOKEN/OWNER ausentes' };
    try {
      const body = JSON.stringify({ name: this.repoName, description: 'Hermes GiteaOps', private: true, auto_init: false, default_branch: 'main' });
      const res = await fetch(`${GITEA_BASE}/api/v1/user/repos`, { method: 'POST', headers: { Authorization: `token ${GITEA_TOKEN}`, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(10000) });
      if (!res.ok && res.status !== 409) return { ok: false, step: 'repo', detail: `HTTP ${res.status}` };
      const remoteUrl = `${GITEA_BASE}/${GITEA_OWNER}/${this.repoName}.git`;
      try { execSync(`git remote add gitea ${remoteUrl}`, { cwd: this.localPath, stdio: 'ignore' }); }
      catch { execSync(`git remote set-url gitea ${remoteUrl}`, { cwd: this.localPath, stdio: 'ignore' }); }
      try { execSync('git push -u gitea main', { cwd: this.localPath, stdio: 'pipe' }); } catch { /* ok */ }
      auditLogger.log({ actor: 'SUBAGENT', event: 'gitea-ops:repo:ready', payload: { project: this.projectName, repo: this.repoName } });
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

  private async genCommitMsg(files: string[]): Promise<string> {
    const diff = this.diffStat();
    for (const m of FREE_MODELS) {
      try {
        const base = process.env.LITELLM_BASE_URL || 'http://localhost:4000';
        const key = process.env.LITELLM_MASTER_KEY || '';
        const r = await fetch(`${base}/v1/chat/completions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model: m, messages: [{ role: 'user', content: `Commit msg concisa (pt-BR, conventional commits): Files: ${files.join(', ')}. Diff: ${diff}` }], max_tokens: 80, temperature: 0.3 }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) continue;
        const d = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
        const txt = d.choices?.[0]?.message?.content?.trim();
        if (txt) return txt;
      } catch { continue; }
    }
    return `chore: update ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` +${files.length - 3}` : ''}`;
  }

  async createFullBackup(): Promise<BackupResult> {
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fls: string[] = [];
      const bf = join(this.backupPath, `${this.repoName}-${ts}.bundle`);
      try { execSync(`git bundle create "${bf}" --all`, { cwd: this.localPath, stdio: 'pipe' }); fls.push(bf); } catch { /* ok */ }
      const ep = join(this.localPath, '.env');
      if (existsSync(ep)) {
        const eb = join(this.backupPath, `${this.repoName}-${ts}-env.txt`);
        writeFileSync(eb, `# Backup .env (masked) - ${ts}\n${readFileSync(ep, 'utf8').replace(/=([^#\n\r]{4,})/g, '=***MASKED***')}`, 'utf8');
        fls.push(eb);
      }
      const mf = join(this.backupPath, `${this.repoName}-${ts}-meta.json`);
      writeFileSync(mf, JSON.stringify({ project: this.projectName, repo: this.repoName, ts, branch: this.branch(), hash: this.hash() }, null, 2), 'utf8');
      fls.push(mf);
      const sz = fls.reduce((s, f) => { try { return s + statSync(f).size; } catch { return s; } }, 0);
      auditLogger.log({ actor: 'SUBAGENT', event: 'gitea-ops:backup', payload: { path: this.backupPath, n: fls.length, bytes: sz } });
      return { ok: true, step: 'backup', detail: `${(sz / 1024).toFixed(1)} KB`, backupPath: this.backupPath, sizeBytes: sz, files: fls.map(f => basename(f)) };
    } catch (e) { return { ok: false, step: 'backup', detail: (e as Error).message, backupPath: this.backupPath, sizeBytes: 0, files: [] }; }
  }

  listBackups(): { file: string; bytes: number; createdAt: string }[] {
    try { return readdirSync(this.backupPath).filter(f => f.startsWith(this.repoName)).map(f => { const s = statSync(join(this.backupPath, f)); return { file: f, bytes: s.size, createdAt: s.mtime.toISOString() }; }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
    catch { return []; }
  }

  restoreBackup(bundleFile: string): GiteaOpsResult {
    const p = join(this.backupPath, bundleFile);
    if (!existsSync(p)) return { ok: false, step: 'restore', detail: 'Bundle nao encontrado' };
    try { execSync(`git fetch "${p}" refs/*:refs/*`, { cwd: this.localPath, stdio: 'pipe' }); return { ok: true, step: 'restore', detail: `Restaurado: ${bundleFile}` }; }
    catch (e) { return { ok: false, step: 'restore', detail: (e as Error).message }; }
  }

  async setupWebhook(url: string, events: string[] = ['push', 'pull_request']): Promise<GiteaOpsResult> {
    try { const r = await createWebhook(this.repoName, url, events); return { ok: r.ok ?? false, step: 'webhook', detail: r.message ?? '' }; }
    catch (e) { return { ok: false, step: 'webhook', detail: (e as Error).message }; }
  }

  async bootstrap(): Promise<GiteaOpsResult[]> {
    const R: GiteaOpsResult[] = [];
    const h = await this.healthCheck();
    R.push({ ok: h.giteaConnected, step: 'health', detail: h.giteaConnected ? `Gitea ${h.giteaVersion}` : 'offline' });
    if (h.giteaConnected && h.authenticated) R.push(await this.createRepository());
    R.push(await this.autoCommit());
    R.push(await this.createFullBackup());
    auditLogger.log({ actor: 'SUBAGENT', event: 'gitea-ops:bootstrap:done', payload: { project: this.projectName, allOk: R.every(r => r.ok) } });
    return R;
  }

  private branch(): string { try { return execSync('git rev-parse --abbrev-ref HEAD', { cwd: this.localPath, encoding: 'utf8' }).trim(); } catch { return 'main'; } }
  private hash(): string { try { return execSync('git rev-parse --short HEAD', { cwd: this.localPath, encoding: 'utf8' }).trim(); } catch { return '?'; } }
  private diffStat(): string { try { return execSync('git diff --cached --stat', { cwd: this.localPath, encoding: 'utf8', stdio: 'pipe' }).slice(0, 600); } catch { return 'indisponivel'; } }
}