/**
 * n8n-templates — base de templates oficiais do n8n.
 *
 * A página oficial https://n8n.io/workflows/ é client-side (Nuxt) e alimenta o
 * listing pela API pública `api.n8n.io` (descoberta no runtimeConfig da própria
 * página: templatesSearchApiUrl / categoriesApiUrl). Este módulo consome as
 * mesmas fontes que a página oficial usa → "scraping" fiel sem HTML frágil.
 *
 * Fallback: se a API cair, devolve categorias + templates curados apontando
 * para as páginas oficiais (nunca 500).
 */

export interface TemplateSummary {
  id: number;
  name: string;
  description: string;
  url: string;
  views: number;
  nodes: string[];
  createdAt?: string;
}

export interface TemplateCategory {
  id: number;
  name: string;
  displayName?: string | null;
}

const SEARCH_API = 'https://api.n8n.io/api/templates/search';
const CATS_API = 'https://api.n8n.io/api/templates/categories';
const TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { at: number; data: unknown }>();

async function getJson(url: string, timeoutMs = 12_000): Promise<any> {
  const key = `get:${url}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (Hermes-N8N)' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    cache.set(key, { at: Date.now(), data });
    return data;
  } finally {
    clearTimeout(t);
  }
}

function slugify(name: string): string {
  return String(name).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // remove acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function mapWorkflow(w: any): TemplateSummary {
  let nodes: string[] = [];
  if (Array.isArray(w?.nodes)) {
    nodes = w.nodes.map((n: any) =>
      typeof n === 'string' ? n : String(n?.name ?? n?.type ?? '')).filter(Boolean).slice(0, 12);
  }
  let desc = String(w?.description ?? '').replace(/\s+/g, ' ').trim();
  if (desc.length > 220) desc = desc.slice(0, 217) + '…';
  return {
    id: Number(w?.id ?? 0),
    name: String(w?.name ?? 'Template'),
    description: desc,
    url: `https://n8n.io/workflows/${w?.id}-${slugify(String(w?.name ?? ''))}`,
    views: Number(w?.totalViews ?? 0),
    nodes,
    createdAt: w?.createdAt ? String(w.createdAt) : undefined,
  };
}

/** Templates oficiais (busca textual e/ou por categoria). */
export async function fetchTemplates(opts: { search?: string; category?: string; limit?: number } = {}): Promise<{
  source: 'api-oficial' | 'curado';
  total?: number;
  templates: TemplateSummary[];
}> {
  const limit = Math.min(24, Math.max(1, Number(opts.limit ?? 12)));
  const q = new URLSearchParams({ limit: String(limit) });
  if (opts.search) q.set('search', opts.search.slice(0, 80));
  if (opts.category) q.set('category', opts.category.slice(0, 60));
  try {
    const j = await getJson(`${SEARCH_API}?${q}`);
    const list = Array.isArray(j?.workflows) ? j.workflows.map(mapWorkflow) : [];
    if (!list.length && !opts.search && !opts.category) throw new Error('vazio');
    return { source: 'api-oficial', total: Number(j?.totalWorkflows) || undefined, templates: list };
  } catch {
    return { source: 'curado', templates: CURATED };
  }
}

/** Categorias oficiais (filtros do wizard/UI). */
export async function fetchCategories(): Promise<{ source: 'api-oficial' | 'curado'; categories: TemplateCategory[] }> {
  try {
    const j = await getJson(CATS_API);
    const cats = Array.isArray(j?.categories)
      ? j.categories.map((c: any) => ({ id: Number(c?.id ?? 0), name: String(c?.name ?? ''), displayName: c?.displayName ?? null }))
      : [];
    if (!cats.length) throw new Error('vazio');
    return { source: 'api-oficial', categories: cats };
  } catch {
    return { source: 'curado', categories: CURATED_CATS };
  }
}

// ─── Fallback curado (API fora do ar) — sempre aponta p/ as fontes oficiais ──

const CURATED: TemplateSummary[] = [
  { id: 0, name: 'AI Agent com ferramentas (RAG)', description: 'Agente IA com busca + memória — base p/ chatbots e assistentes internos.', url: 'https://n8n.io/workflows/categories/ai/', views: 0, nodes: ['AI Agent', 'Vector Store Tool', 'HTTP Request'] },
  { id: 0, name: 'Webhook → validação → Slack', description: 'Entrada de dados via webhook com validação e notificação em canal.', url: 'https://n8n.io/workflows/categories/it-ops/', views: 0, nodes: ['Webhook', 'IF', 'Slack'] },
  { id: 0, name: 'Lead de formulário → CRM + email', description: 'Captação e qualificação de leads com notificação de vendas.', url: 'https://n8n.io/workflows/categories/sales/', views: 0, nodes: ['Webhook', 'HubSpot', 'Email Send'] },
  { id: 0, name: 'Abandono de carrinho (e-commerce)', description: 'Lembrete automatizado p/ carrinhos não concluídos.', url: 'https://n8n.io/workflows/categories/marketing/', views: 0, nodes: ['Webhook', 'Wait', 'Email Send'] },
  { id: 0, name: 'Relatório diário agendado', description: 'Schedule → coleta de métricas → resumo no Slack/email.', url: 'https://n8n.io/workflows/categories/it-ops/', views: 0, nodes: ['Schedule Trigger', 'HTTP Request', 'Code', 'Slack'] },
  { id: 0, name: 'Classificação de tickets (suporte)', description: 'Triagem automática de chamados por intenção/prioridade.', url: 'https://n8n.io/workflows/categories/support/', views: 0, nodes: ['Webhook', 'AI Agent', 'Switch'] },
];

const CURATED_CATS: TemplateCategory[] = [
  { id: 25, name: 'AI' }, { id: 30, name: 'Sales' }, { id: 27, name: 'Marketing' },
  { id: 29, name: 'IT Ops' }, { id: 26, name: 'Support' }, { id: 31, name: 'Content Creation' },
];
