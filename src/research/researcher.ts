/**
 * researcher — agente pesquisador do ecossistema Hermes.
 *
 * Capacidades:
 *  1. WEB SEARCH via APIs já cadastradas (Tavily, SerpAPI, Brave, Linkup —
 *     fallback automático na ordem de preferência).
 *  2. SCRAPING anti-detecção via worker Python (scripts/research/scrape.py):
 *       - curl_cffi (padrão): falsifica TLS/JA3/HTTP2 de navegadores reais,
 *         sem browser — rápido e passa por WAFs modernos.
 *       - seleniumbase (opcional): UC Mode para páginas com login/cliques.
 *       - botasaurus (opcional): all-in-one anti-bot.
 *  3. RESEARCH TASK: busca → scrape dos melhores resultados → síntese via
 *     smart-router (modelo do pipeline de pesquisa).
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { getGateway, getVirtualKey } from '../gateway/gateway-singleton.js';
import { resolveModel } from '../llm/routing-store.js';
import { auditLogger } from '../core/audit-logger.js';
import { eventBus } from '../core/event-bus.js';

const SCRAPE_PY = join(process.cwd(), 'scripts', 'research', 'scrape.py');
const PYTHON = process.env.PYTHON_BIN || 'python';

export type ScrapeTool = 'curl_cffi' | 'seleniumbase' | 'botasaurus';
export type SearchProvider = 'tavily' | 'serpapi' | 'brave' | 'linkup';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  provider: SearchProvider;
  results: SearchResult[];
}

export interface ScrapeResponse {
  ok: boolean;
  tool: ScrapeTool;
  url: string;
  title?: string;
  text?: string;
  chars?: number;
  links?: string[];
  error?: string;
}

export interface ResearchReport {
  query: string;
  searchProvider: SearchProvider | null;
  sources: Array<{ title: string; url: string; scraped: boolean; chars?: number; error?: string }>;
  synthesis: string;
  model: string;
}

function env(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = (process.env[k] ?? '').trim();
    if (v) return v;
  }
  return undefined;
}

/** Status das ferramentas e APIs para a UI/admin. */
export async function researcherStatus() {
  const tools: Record<string, { installed: boolean; note?: string }> = {
    curl_cffi: { installed: true, note: 'TLS/JA3 fingerprint (padrão — sem browser)' },
    seleniumbase: { installed: false, note: 'pip install seleniumbase (UC Mode, requer Chrome)' },
    botasaurus: { installed: false, note: 'pip install botasaurus (all-in-one anti-bot)' },
  };
  // Detecta instalações reais via import-spec (rápido, sem executar código do pacote).
  const probe = await new Promise<string>((resolve) => {
    const py = spawn(PYTHON, ['-c', 'import importlib.util as u;print(",".join(p for p in ["curl_cffi","seleniumbase","botasaurus"] if u.find_spec(p)))'], { windowsHide: true });
    let out = '';
    py.stdout.on('data', (d) => { out += d; });
    py.on('error', () => resolve(''));
    py.on('close', () => resolve(out.trim()));
  }).catch(() => '');
  for (const name of probe.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (tools[name]) tools[name].installed = true;
  }

  return {
    python: PYTHON,
    tools,
    searchApis: [
      { id: 'tavily', label: 'Tavily', configured: !!env('TAVILY_API_KEY') },
      { id: 'serpapi', label: 'SerpAPI', configured: !!env('SERPAPI_API_KEY') },
      { id: 'brave', label: 'Brave Search', configured: !!env('BRAVE_API_KEY') },
      { id: 'linkup', label: 'Linkup', configured: !!env('LINKUP_API_KEY') },
    ],
  };
}

async function searchTavily(query: string, max: number): Promise<SearchResult[]> {
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: env('TAVILY_API_KEY'), query, max_results: max, include_answer: false }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Tavily HTTP ${r.status}`);
  const d = await r.json() as { results?: { title: string; url: string; content: string }[] };
  return (d.results ?? []).map((x) => ({ title: x.title, url: x.url, snippet: (x.content ?? '').slice(0, 600) }));
}

async function searchSerpapi(query: string, max: number): Promise<SearchResult[]> {
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(max));
  url.searchParams.set('api_key', env('SERPAPI_API_KEY') ?? '');
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`SerpAPI HTTP ${r.status}`);
  const d = await r.json() as { organic_results?: { title: string; link: string; snippet?: string }[] };
  return (d.organic_results ?? []).slice(0, max).map((x) => ({ title: x.title, url: x.link, snippet: (x.snippet ?? '').slice(0, 600) }));
}

async function searchBrave(query: string, max: number): Promise<SearchResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(max));
  const r = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': env('BRAVE_API_KEY') ?? '' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Brave HTTP ${r.status}`);
  const d = await r.json() as { web?: { results?: { title: string; url: string; description: string }[] } };
  return (d.web?.results ?? []).map((x) => ({ title: x.title, url: x.url, snippet: (x.description ?? '').slice(0, 600) }));
}

async function searchLinkup(query: string, max: number): Promise<SearchResult[]> {
  const r = await fetch('https://api.linkup.so/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, depth: 'standard', outputType: 'text', api_key: env('LINKUP_API_KEY') }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Linkup HTTP ${r.status}`);
  const d = await r.json() as { results?: { name: string; url: string; snippets?: string[] }[] };
  return (d.results ?? []).slice(0, max).map((x) => ({ title: x.name, url: x.url, snippet: (x.snippets ?? []).join(' ').slice(0, 600) }));
}

const SEARCHERS: Record<SearchProvider, (q: string, max: number) => Promise<SearchResult[]>> = {
  tavily: searchTavily,
  serpapi: searchSerpapi,
  brave: searchBrave,
  linkup: searchLinkup,
};
const FALLBACK_ORDER: SearchProvider[] = ['tavily', 'serpapi', 'brave', 'linkup'];

/** Web search com fallback automático entre as APIs cadastradas. */
export async function searchWeb(query: string, provider?: SearchProvider, max = 6): Promise<SearchResponse> {
  const order = provider ? [provider, ...FALLBACK_ORDER.filter((p) => p !== provider)] : FALLBACK_ORDER;
  let lastErr = '';
  for (const p of order) {
    try {
      const results = await SEARCHERS[p](query, max);
      if (results.length > 0) return { provider: p, results };
      lastErr = `${p}: sem resultados`;
    } catch (e) {
      lastErr = `${p}: ${String(e)}`;
    }
  }
  throw new Error(`Todas as APIs de busca falharam — ${lastErr}`);
}

/** Scraping de uma URL via worker Python (com tool choice). */
export async function scrapeUrl(url: string, tool: ScrapeTool = 'curl_cffi', maxChars = 24_000): Promise<ScrapeResponse> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [
      SCRAPE_PY, '--url', url, '--tool', tool,
      '--max-chars', String(maxChars), '--timeout', '30',
    ], { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); }, 75_000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, tool, url, error: `python indisponível: ${String(e)}` });
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out.trim()) as ScrapeResponse);
      } catch {
        resolve({ ok: false, tool, url, error: `saída inválida do worker: ${(out || err).slice(0, 400)}` });
      }
    });
  });
}

/**
 * Pipeline completo: busca web → scrape dos top resultados → síntese LLM.
 * É a "pesquisa avançada" do orquestrador.
 */
export async function researchTask(
  query: string,
  opts: { maxResults?: number; tool?: ScrapeTool; provider?: SearchProvider } = {},
): Promise<ResearchReport> {
  const maxResults = Math.min(opts.maxResults ?? 3, 6);
  eventBus.publish('research:started', { query });

  const search = await searchWeb(query, opts.provider, 6);
  const top = search.results.slice(0, maxResults);

  const sources: ResearchReport['sources'] = [];
  const docs: string[] = [];
  for (const r of top) {
    const sc = await scrapeUrl(r.url, opts.tool ?? 'curl_cffi');
    sources.push({ title: r.title, url: r.url, scraped: sc.ok, chars: sc.chars, error: sc.error });
    if (sc.ok && sc.text) {
      docs.push(`--- FONTE: ${r.title} (${r.url})\n${sc.text.slice(0, 8000)}`);
    } else {
      docs.push(`--- FONTE (sem corpo, só snippet): ${r.title} (${r.url})\n${r.snippet}`);
    }
  }

  const model = await resolveModel('svc-serpapi');
  const virtualKey = await getVirtualKey('researcher');
  const synth = await getGateway().complete({
    model,
    virtualKey,
    maxTokens: 2048,
    messages: [
      {
        role: 'system',
        content: 'Você é o Agente Pesquisador do Hermes. Sintetize as fontes coletadas em briefing objetivo em pt-BR: fatos principais, números, nomes/empresas, e cite a fonte (título + URL) inline em cada afirmação relevante. Seja direto; sem enrolação; sinalize incertezas.',
      },
      { role: 'user', content: `Pergunta de pesquisa: ${query}\n\nFontes coletadas:\n\n${docs.join('\n\n')}` },
    ],
  });

  auditLogger.log({
    actor: 'SUBAGENT',
    event: 'research:completed',
    payload: { query, provider: search.provider, sources: sources.length, model },
  });
  eventBus.publish('research:completed', { query, model });

  return {
    query,
    searchProvider: search.provider,
    sources,
    synthesis: synth.content,
    model,
  };
}
