/**
 * n8n-client — cliente REST da API pública n8n (X-N8N-API-KEY).
 *
 * Segurança:
 *  - A API Key fica APENAS em memória do processo (nunca em disco, nunca em
 *    resposta HTTP, nunca em log). Todas as mensagens de erro passam por
 *    redact() para garantir que o valor nunca vaze.
 *  - As respostas citam só o NOME das variáveis (N8N_API_KEY etc.).
 *
 * Endpoints usados (docs: https://docs.n8n.io/api/):
 *  GET    /healthz                      → saúde da instância (sem auth)
 *  GET    /api/v1/workflows             → lista
 *  GET    /api/v1/workflows/:id         → JSON completo
 *  POST   /api/v1/workflows             → cria
 *  PATCH  /api/v1/workflows/:id         → atualiza
 *  POST   /api/v1/workflows/:id/activate|deactivate
 *  GET    /api/v1/executions            → execuções
 *  GET    /api/v1/executions/:id        → detalhe da execução
 */

export interface N8nConnection {
  url: string;        // normalizada (sem /api/v1)
  apiKey: string;     // nunca sai deste módulo
}

let conn: N8nConnection | null = null;

export function normalizeUrl(raw: string): string {
  let u = String(raw || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  u = u.replace(/\/api\/v1$/i, '');
  return u;
}

export function setConnection(url: string, apiKey: string): void {
  conn = { url: normalizeUrl(url), apiKey: String(apiKey || '').trim() };
}

export function clearConnection(): void { conn = null; }

/** Nunca devolve a chave — só metadados. */
export function connectionInfo(): { connected: boolean; url: string | null; varNames: string[] } {
  return {
    connected: !!conn,
    url: conn?.url ?? null,
    varNames: ['N8N_API_URL', 'N8N_API_KEY'],  // só os NOMES
  };
}

/** Mascara a chave (e variações) em qualquer texto de saída. */
export function redact(text: string): string {
  let s = String(text ?? '');
  if (conn?.apiKey) s = s.split(conn.apiKey).join('***');
  s = s.replace(/(X-N8N-API-KEY["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, '$1***');
  s = s.replace(/\bsk-[A-Za-z0-9]{10,}/g, 'sk-***');
  return s;
}

const TIMEOUT_MS = 15_000;

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!conn) throw new Error('instância não conectada — informe URL + N8N_API_KEY (rota /api/n8n/connect)');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${conn.url}/api/v1${path}`, {
      method,
      headers: {
        'X-N8N-API-KEY': conn.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) {
      const msg = typeof data === 'object' && data
        ? (data.message || data.error || JSON.stringify(data).slice(0, 300))
        : String(data).slice(0, 300);
      throw new Error(`n8n API ${r.status}: ${redact(msg)}`);
    }
    return data as T;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(`timeout ${TIMEOUT_MS / 1000}s — instância lenta ou inacessível`);
    throw new Error(redact(String(e?.message ?? e)));
  } finally {
    clearTimeout(t);
  }
}

// ─── Operações ───────────────────────────────────────────────────────────────

export async function testConnection(): Promise<{
  ok: boolean; version?: string; workflows?: number; url: string; error?: string;
}> {
  if (!conn) return { ok: false, url: '', error: 'não conectado' };
  try {
    // /healthz responde {"status":"ok"} em instâncias n8n (sem auth).
    let version: string | undefined;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const h = await fetch(`${conn.url}/healthz`, { signal: ctrl.signal }).catch(() => null);
      clearTimeout(t);
      if (h?.ok) {
        const hj: any = await h.json().catch(() => ({}));
        version = hj?.version ?? hj?.releaseData?.version;
      }
    } catch { /* healthz opcional */ }

    const list = await api<{ data?: any[] }>('GET', '/workflows?limit=5');
    const count = Array.isArray(list?.data) ? list.data.length : 0;
    return { ok: true, version, workflows: count, url: conn.url };
  } catch (e) {
    return { ok: false, url: conn.url, error: redact(String(e instanceof Error ? e.message : e)) };
  }
}

export async function listWorkflows(limit = 50): Promise<any[]> {
  const r = await api<{ data?: any[] }>('GET', `/workflows?limit=${Math.min(250, Math.max(1, limit))}`);
  return Array.isArray(r?.data) ? r.data : [];
}

export async function getWorkflow(id: string): Promise<any> {
  return api('GET', `/workflows/${encodeURIComponent(id)}`);
}

export async function createWorkflow(workflow: any): Promise<any> {
  const payload = {
    name: String(workflow?.name || 'Workflow criado pelo Hermes'),
    nodes: Array.isArray(workflow?.nodes) ? workflow.nodes : [],
    connections: workflow?.connections ?? {},
    settings: workflow?.settings ?? {},
    staticData: workflow?.staticData ?? null,
  };
  return api('POST', '/workflows', payload);
}

export async function updateWorkflow(id: string, workflow: any): Promise<any> {
  return api('PATCH', `/workflows/${encodeURIComponent(id)}`, {
    name: workflow?.name,
    nodes: workflow?.nodes,
    connections: workflow?.connections,
    settings: workflow?.settings,
  });
}

export async function setActive(id: string, active: boolean): Promise<any> {
  return api('POST', `/workflows/${encodeURIComponent(id)}/${active ? 'activate' : 'deactivate'}`);
}

export async function listExecutions(workflowId?: string, limit = 20): Promise<any[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (workflowId) q.set('workflowId', String(workflowId));
  const r = await api<{ data?: any[] }>('GET', `/executions?${q}`);
  return Array.isArray(r?.data) ? r.data : [];
}

export async function getExecution(id: string): Promise<any> {
  return api('GET', `/executions/${encodeURIComponent(id)}`);
}
