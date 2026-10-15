/**
 * env-db-store — persistência das API keys em data/env-settings.json.
 *
 * Diferentemente do env-store (que grava direto no .env), este módulo
 * mantém um registro completo e estruturado de todas as configurações
 * de API em um arquivo JSON dentro de data/, servindo como "banco de dados"
 * local para o frontend consultar e persistir configurações mesmo quando
 * o .env for recriado.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { maskSecret } from './providers-llm.js';

const DB_DIR = join(process.cwd(), 'data');
const DB_FILE = join(DB_DIR, 'env-settings.json');

export interface EnvSetting {
  key: string;
  value: string;
  masked: string;
  updatedAt: string;
}

export interface EnvDbState {
  settings: Record<string, EnvSetting>;
  lastFullSync: string | null;
}

async function loadDb(): Promise<EnvDbState> {
  try {
    const raw = await readFile(DB_FILE, 'utf-8');
    return JSON.parse(raw) as EnvDbState;
  } catch {
    return { settings: {}, lastFullSync: null };
  }
}

async function saveDb(state: EnvDbState): Promise<void> {
  await mkdir(DB_DIR, { recursive: true });
  state.lastFullSync = new Date().toISOString();
  await writeFile(DB_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

/** Retorna todas as configurações salvas no BD (valores mascarados). */
export async function getEnvSettings(): Promise<EnvDbState> {
  return loadDb();
}

/** Salva ou atualiza uma variável de ambiente no BD e sincroniza com process.env. */
export async function setEnvSetting(key: string, value: string): Promise<EnvSetting> {
  const state = await loadDb();
  const masked = maskSecret(value);
  const setting: EnvSetting = {
    key,
    value,
    masked,
    updatedAt: new Date().toISOString(),
  };
  state.settings[key] = setting;
  await saveDb(state);
  // Efeito imediato em runtime
  process.env[key] = value;
  return setting;
}

/** Remove uma variável do BD (sem apagar do .env). */
export async function deleteEnvSetting(key: string): Promise<boolean> {
  const state = await loadDb();
  if (!(key in state.settings)) return false;
  delete state.settings[key];
  await saveDb(state);
  return true;
}

/** Sincroniza o .env atual para o BD (importa chaves que estão no .env mas não no BD). */
export async function syncEnvToDb(envVars: Record<string, string>): Promise<number> {
  const state = await loadDb();
  let count = 0;
  for (const [key, value] of Object.entries(envVars)) {
    if (!value) continue;
    if (!(key in state.settings) || state.settings[key].value !== value) {
      state.settings[key] = {
        key,
        value,
        masked: maskSecret(value),
        updatedAt: new Date().toISOString(),
      };
      count++;
    }
  }
  await saveDb(state);
  return count;
}