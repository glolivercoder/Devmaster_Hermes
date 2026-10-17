// Declarações de tipos para o cliente Gitea (gitea-client.js).
// O módulo é JavaScript puro; este arquivo dá ao TypeScript as assinaturas
// usadas em src/index.ts (rotas /api/gitea/*).
//
// ⚠️ getBaseUrl/getOwner/getToken são FUNÇÕES (leitura lazy do process.env),
// não constantes: o .env só é carregado em bootstrap(), depois dos imports.

export interface GiteaTestResult {
  connected: boolean;
  httpStatus?: number;
  latencyMs: number;
  version?: string;
  message: string;
  /** Divergências entre process.env e o .env (ex.: token antigo herdado do terminal). */
  envMismatch?: string[];
}

export interface GiteaRepo {
  name: string;
  fullName: string;
  private: boolean;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string;
  updatedAt: string;
  openIssues: number;
}

export interface GiteaHook {
  id: number;
  type: string;
  active: boolean;
  events: string[];
  url?: string;
}

export interface GiteaBackupFile {
  file: string;
  bytes: number;
  createdAt: string;
}

export declare function testConnection(): Promise<GiteaTestResult>;
export declare function listRepos(): Promise<{ ok: boolean; repos: GiteaRepo[]; message?: string }>;
export declare function listWebhooks(repo: string): Promise<{ ok: boolean; hooks: GiteaHook[]; message?: string }>;
export declare function createWebhook(
  repo: string,
  targetUrl: string,
  events?: string[],
): Promise<{ ok: boolean; hook?: GiteaHook; message: string }>;
export declare function createLocalBackup(destDir?: string): { ok: boolean; file?: string; bytes?: number; branch?: string; message: string };
export declare function listBackups(destDir?: string): { ok: boolean; backups: GiteaBackupFile[]; message?: string };

export declare function getBaseUrl(): string;
export declare function getOwner(): string;
export declare function getToken(): string;
