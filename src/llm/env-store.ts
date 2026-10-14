/**
 * env-store — persistência das API keys no arquivo .env local.
 *
 * Objetivo: permitir que a UI (aba LiteLLM & Custos) insira/troque uma chave,
 * grave direto no .env (com backup) e reflita imediatamente em process.env,
 * sem precisar reiniciar o Hermes. Preserva comentários e a ordem das linhas.
 */
import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { maskSecret } from './providers-llm.js';

const ENV_PATH = join(process.cwd(), '.env');

/** Cita um valor para o formato .env quando ele contém espaços, # ou aspas. */
function quoteValue(value: string): string {
  if (/[\s#"']/.test(value)) {
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return value;
}

export interface SetEnvResult {
  env: string;
  /** true se a linha já existia e foi atualizada; false se foi criada. */
  updated: boolean;
  masked: string;
  /** Caminho do backup gerado antes da escrita. */
  backupPath: string | null;
}

/**
 * Define (cria ou substitui) uma variável no .env, faz backup antes,
 * e sincroniza process.env em runtime para efeito imediato.
 */
export async function setEnvVar(envName: string, rawValue: string): Promise<SetEnvResult> {
  const name = envName.trim();
  if (!/^[A-Z0-9_]+$/i.test(name)) {
    throw new Error(`Nome de variável inválido: "${name}"`);
  }
  const value = rawValue.trim();
  if (!value) {
    throw new Error('Valor vazio — nada a salvar.');
  }

  let content = '';
  let existed = false;
  try {
    content = await readFile(ENV_PATH, 'utf8');
    existed = true;
  } catch {
    content = '';
  }

  // Backup antes de qualquer escrita (best-effort, nunca bloqueia o save).
  let backupPath: string | null = null;
  if (existed) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
    backupPath = `${ENV_PATH}.backup-${stamp}`;
    try {
      await copyFile(ENV_PATH, backupPath);
    } catch {
      backupPath = null;
    }
  }

  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.length ? content.split(/\r?\n/) : [];
  const re = new RegExp(`^(\\s*(?:export\\s+)?)${name}\\s*=.*$`);
  let updated = false;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      lines[i] = `${name}=${quoteValue(value)}`;
      updated = true;
      break;
    }
  }
  if (!updated) {
    // Garante separação antes do bloco novo e registra a origem.
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(`# adicionado/atualizado via UI LiteLLM & Custos`);
    lines.push(`${name}=${quoteValue(value)}`);
  }

  const out = lines.join(eol).replace(/\s+$/, '') + eol;
  await writeFile(ENV_PATH, out, 'utf8');

  // Efeito imediato: o processo em execução passa a ver a nova chave.
  process.env[name] = value;

  return { env: name, updated, masked: maskSecret(value), backupPath };
}

/** true se o arquivo .env existe. */
export async function envFileExists(): Promise<boolean> {
  try {
    await access(ENV_PATH);
    return true;
  } catch {
    return false;
  }
}
