/**
 * opencode-bridge — ponte para o servidor headless do OpenCode (`opencode serve`).
 *
 * Gerencia o ciclo de vida (spawn sob demanda na porta local) e expõe um proxy
 * para a API REST do OpenCode. Rotas validadas empiricamente contra a 1.1.34:
 *   GET    /session                → lista de sessões (JSON array)
 *   POST   /session                → cria sessão {title}
 *   DELETE /session/:id            → remove sessão
 *   GET    /session/:id/message    → transcript [{info:{role,...}, parts:[{type,...}]}]
 *   POST   /session/:id/message    → executa prompt SÍNCRONO
 *                                    {model:{providerID,modelID}, parts:[{type:'text',text}]}
 *   GET    /provider               → {all:[{id, models:{...}}]} (catálogo p/ seletor)
 *
 * O servidor roda em127.0.0.1 (não exposto), com cwd = raiz do projeto para
 * que os agentes enxerguem o código do Hermes.
 */
import { spawn } from 'node:child_process';

const PORT = Number(process.env.OPENCODE_SERVE_PORT || 4196);
const BASE = `http://127.0.0.1:${PORT}`;
// Shim global do npm; sobrescrevível via OPENCODE_BIN (binário standalone).
const BIN = process.env.OPENCODE_BIN || 'C:\\Users\\gloli\\AppData\\Roaming\\npm\\opencode.cmd';
const WORKDIR = process.env.OPENCODE_WORKDIR || process.cwd();

let spawnTentativa: Promise<boolean> | null = null;

async function ping(timeoutMs = 2500): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(`${BASE}/config`, { signal: ctl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

/** Status do servidor para a UI (não garante uptime — só reporta). */
export async function opencodeStatus(): Promise<Record<string, unknown>> {
  const running = await ping(1500);
  return { running, port: PORT, baseUrl: BASE, bin: BIN, workdir: WORKDIR };
}

/** Garante o servidor vivo (reusa se já rodando; senão faz spawn e espera). */
export async function ensureServer(): Promise<boolean> {
  if (await ping()) return true;
  if (spawnTentativa) return spawnTentativa;
  spawnTentativa = (async () => {
    try {
      const isCmd = /\.cmd$/i.test(BIN);
      const child = spawn(BIN, ['serve', '--port', String(PORT), '--hostname', '127.0.0.1'], {
        cwd: WORKDIR,
        windowsHide: true,
        stdio: 'ignore',
        // Windows não executa .cmd direto (spawn EINVAL síncrono desde Node18.20+)
        // — shell:true delega ao cmd.exe.
        shell: isCmd,
      });
      child.on('error', (e) => { console.error('[OPENCODE] erro do processo serve:', String(e)); });
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 600));
        if (await ping(1500)) return true;
      }
      console.error('[OPENCODE] servidor não respondeu em30s (bin=%s)', BIN);
      return false;
    } catch (e) {
      console.error('[OPENCODE] falha ao spawnar servidor:', String(e));
      return false;
    } finally {
      spawnTentativa = null;
    }
  })();
  return spawnTentativa;
}

export interface OcResult {
  ok: boolean;
  status: number;
  json: any;
}

/** Proxy HTTP para o servidor OpenCode com timeout controlado. */
export async function ocFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<OcResult> {
  const alive = await ensureServer();
  if (!alive) {
    return { ok: false, status: 0, json: { error: 'Servidor OpenCode indisponível (opencode serve não subiu)' } };
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), init.timeoutMs ?? 120_000);
  try {
    const r = await fetch(`${BASE}${path}`, { ...init, signal: ctl.signal });
    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 4000) }; }
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: { error: `Falha de rede com o OpenCode: ${String(e)}` } };
  } finally {
    clearTimeout(t);
  }
}
