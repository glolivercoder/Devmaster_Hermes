/**
 * context7 — client da API Context7 (docs de bibliotecas sempre atualizados).
 *
 * Papel no anti-alucinação: quando um LLM precisa usar uma lib/API, ele deve
 * receber a assinatura REAL documentada, não a que decorou do treinamento
 * (que pode estar desatualizada). O Context7 resolve isso.
 *
 * Endpoints (API v2, testados):
 *   GET /v2/libs/search?libraryName=&query=  → JSON {results:[{id,title,...}]}
 *   GET /v2/context?libraryId=&query=        → Markdown (docs relevantes)
 * Auth: header X-API-Key (ctx7sk-...), opcional mas com rate-limit maior.
 *
 * Fluxo: search(prompt) → melhor lib → context(libId, prompt) → Markdown.
 * O chamador DEVE persistir o Markdown na memória (kind='doc') para que a
 * próxima sessão não precise buscar de novo (cache de conhecimento).
 */

const DEFAULT_BASE = 'https://context7.com/api';
const TIMEOUT = 25_000;

export interface Context7Hit {
  id: string;          // ex.: "/websites/fastapi_tiangolo"
  title: string;
  description: string;
  totalTokens: number;
  totalSnippets: number;
  trustScore: number;
}

export interface Context7Result {
  libraryId: string;
  title: string;
  markdown: string;
  chars: number;
}

function base(): string {
  const b = (process.env.CONTEXT7_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!b) return DEFAULT_BASE;
  // Host legado do catálogo (api.context7.com) não resolve mais — mapeia para
  // o endpoint de produção atual (context7.com/api).
  if (/^https?:\/\/api\.context7\.com/i.test(b)) return DEFAULT_BASE;
  // Aceita tanto "https://context7.com" quanto ".../api" — normaliza p/ /api.
  return /\/api$/.test(b) ? b : `${b}/api`;
}

function key(): string {
  return (process.env.CONTEXT7_API_KEY ?? process.env.CONTEXT7_API_KEY_ALT1 ?? '').trim();
}

export function context7Status(): { configured: boolean; baseUrl: string } {
  return { configured: !!key(), baseUrl: base() };
}

/** Busca bibliotecas; `libraryName` = termo curto, `query` = ranking de relevância. */
export async function searchLibraries(
  query: string,
  fast = false,
  libraryName?: string,
): Promise<Context7Hit[]> {
  const url = new URL(`${base()}/v2/libs/search`);
  // Context7 busca por `libraryName` — passar a frase inteira degrada o
  // ranking (casa palavras soltas). Usa termo curto: candidato extraído ou o
  // início da query.
  url.searchParams.set('libraryName', (libraryName ?? query).slice(0, 60));
  url.searchParams.set('query', query.slice(0, 400));
  if (fast) url.searchParams.set('fast', 'true');

  const headers: Record<string, string> = { Accept: 'application/json' };
  const k = key();
  if (k) headers['X-API-Key'] = k;

  const r = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`Context7 search HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json() as { results?: Partial<Context7Hit>[] };
  return (d.results ?? []).slice(0, 5).map((x) => ({
    id: String(x.id ?? ''),
    title: String(x.title ?? ''),
    description: String(x.description ?? ''),
    totalTokens: Number(x.totalTokens ?? 0),
    totalSnippets: Number(x.totalSnippets ?? 0),
    trustScore: Number(x.trustScore ?? 0),
  })).filter((x) => x.id);
}

/**
 * Puxa o contexto de documentação de uma library para uma pergunta.
 * Resposta vem em Markdown — pronto para injetar em prompt e guardar no RAG.
 */
export async function fetchContext(libraryId: string, query: string, language?: string): Promise<Context7Result> {
  const url = new URL(`${base()}/v2/context`);
  url.searchParams.set('libraryId', libraryId);
  url.searchParams.set('query', query.slice(0, 400));
  if (language) url.searchParams.set('language', language.slice(0, 40));

  const headers: Record<string, string> = { Accept: 'application/json' };
  const k = key();
  if (k) headers['X-API-Key'] = k;

  const r = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`Context7 context HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  // A v2 devolve Markdown puro (não JSON) — trata como texto.
  const md = (await r.text()).trim();
  if (!md) throw new Error(`Context7 sem conteúdo para ${libraryId}`);
  return { libraryId, title: libraryId, markdown: md, chars: md.length };
}

/**
 * Extrai candidatos de nome de lib/biblioteca de um prompt em linguagem natural.
 * Procura: nomes de frameworks conhecidos, tokens em `backticks`, termos com
 * ponto (ex.: next.js) e palavras CamelCase. Evita passar a frase inteira ao
 * `libraryName` do Context7 (que degrada o ranking).
 */
const KNOWN_LIBS = [
  'fastapi', 'react', 'next.js', 'nextjs', 'vue', 'nuxt', 'angular', 'svelte',
  'express', 'nest.js', 'nestjs', 'koa', 'django', 'flask', 'laravel', 'symfony',
  'spring', 'springboot', 'rails', 'gin', 'echo', 'fiber',
  'tailwind', 'prisma', 'drizzle', 'sequelize', 'typeorm', 'knex',
  'postgresql', 'postgres', 'mysql', 'sqlite', 'mongodb', 'redis',
  'docker', 'kubernetes', 'terraform', 'nginx', 'grafana',
  'openai', 'langchain', 'langgraph', 'llamaindex', 'pinecone', 'qdrant',
  'stripe', 'twilio', 'supabase', 'firebase', 'auth0', 'next-auth',
  'pandas', 'numpy', 'pytorch', 'tensorflow', 'scikit-learn',
  'vitest', 'jest', 'playwright', 'cypress', 'pytest',
];

export function extractLibCandidates(prompt: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const k = s.trim().toLowerCase();
    if (k && !seen.has(k)) { seen.add(k); out.push(s.trim()); }
  };
  const p = prompt.toLowerCase();

  // 1) Nomes de frameworks conhecidos mencionados no prompt.
  for (const lib of KNOWN_LIBS) if (p.includes(lib)) push(lib);
  // 2) Tokens em `backticks` (gerador de código cita a lib).
  for (const m of prompt.matchAll(/`([a-zA-Z][\w.\-]{1,30})`/g)) push(m[1]);
  // 3) Termos com ponto (next.js, scikit-learn tratados acima; aqui vue.router etc).
  for (const m of prompt.matchAll(/\b([a-z][a-z0-9]{1,15}\.[a-z][a-z0-9]{1,15})\b/g)) push(m[1]);
  return out.slice(0, 6);
}

/**
 * Pipeline completo: acha libs relevantes para o prompt e puxa os docs.
 * Resiliente: tenta os candidatos extraídos e, se nenhum, o search genérico —
 * varrendo vários hits até coletar `maxLibs` sucessos. Uma lib que falha
 * (ex.: no_relevant_snippets) não zera o resultado.
 */
export async function resolveDocs(
  prompt: string,
  opts: { maxLibs?: number; language?: string } = {},
): Promise<Context7Result[]> {
  const want = Math.max(1, opts.maxLibs ?? 2);
  const candidates = extractLibCandidates(prompt);

  // Tenta cada candidato como libraryName; acumula hits (dedup por id).
  const hits: Context7Hit[] = [];
  const seenIds = new Set<string>();
  const collect = (arr: Context7Hit[]) => {
    for (const h of arr) if (!seenIds.has(h.id)) { seenIds.add(h.id); hits.push(h); }
  };
  for (const c of candidates.slice(0, 3)) {
    try { collect(await searchLibraries(prompt, false, c)); } catch { /* segue */ }
    if (hits.length >= 4) break;
  }
  // Fallback: busca genérica com a prompt (sem candidato extraído).
  if (!hits.length) {
    try { collect(await searchLibraries(prompt.slice(0, 60))); } catch { /* segue */ }
  }
  if (!hits.length) return [];

  const out: Context7Result[] = [];
  for (const h of hits.slice(0, Math.max(4, want))) {
    if (out.length >= want) break;
    try {
      const ctx = await fetchContext(h.id, prompt, opts.language);
      out.push({ ...ctx, title: h.title || h.id });
    } catch { /* lib sem snippet relevante/inacessível — tenta a próxima */ }
  }
  return out;
}
