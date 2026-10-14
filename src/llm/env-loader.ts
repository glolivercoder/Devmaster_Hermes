/**
 * env-loader — carrega o arquivo .env do cwd para process.env no boot.
 *
 * Regra do dotenv: variáveis JÁ definidas no ambiente têm precedência e NÃO
 * são sobrescritas. Assim, chaves gravadas pela UI (aba LiteLLM & Custos)
 * sobrevivem a reinícios, e overrides de shell/container continuam valendo.
 * Extraído num módulo isolado para ser testável sem disparar o bootstrap
 * (que iniciaria servidores HTTP e o bridge do Telegram).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const ENV_PATH = join(process.cwd(), '.env');

/** Remove aspas envolvendo um valor .env e trata escapes básicos. */
export function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    const inner = t.slice(1, -1);
    return t[0] === '"' ? inner.replace(/\\n/g, '\n').replace(/\\"/g, '"') : inner;
  }
  return t;
}

/** Carrega o .env do disco para process.env. Nunca lança — ausência é silenciosa. */
export async function loadDotEnv(
  envPath: string = ENV_PATH,
): Promise<{ loaded: number; path: string }> {
  let content = '';
  try {
    content = await readFile(envPath, 'utf8');
  } catch {
    return { loaded: 0, path: envPath };
  }
  let loaded = 0;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const name = m[1];
    if (process.env[name] !== undefined) continue; // ambiente existente vence
    let valRaw = m[2].trim();
    // Comentário inline (# precedido de espaço) só vale FORA de aspas.
    // Dentro de aspas o conteúdo é literal (ex.: KEY="abc # ainda valor").
    if (!valRaw.startsWith('"') && !valRaw.startsWith("'")) {
      valRaw = valRaw.replace(/\s+#.*$/, '').trim();
    }
    const value = unquote(valRaw);
    process.env[name] = value;
    loaded++;
  }
  return { loaded, path: envPath };
}
