/**
 * optimizer-routes — API do Otimizador de Prompts.
 *
 * POST /api/optimizer/optimize {prompt, pdfUrls?, docUrls?, project?}
 *      → pipeline completo: intent → análise fria → pesquisa → expansão → otimização
 * POST /api/optimizer/discuss  {prompt, optimized, issues[], messages[]}
 *      → discussão interativa (confrontar sugestões; a LLM pode perguntar o projeto)
 * GET  /api/optimizer/seo-repo
 *      → melhor skill/repos GitHub para SEO (busca ao vivo + fallback curado)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runOptimizer, discuss } from './pipeline.js';

// ─── SEO Optimizer: repositório/skill de SEO ─────────────────────────────────

interface SeoRepo {
  name: string;
  fullName: string;
  url: string;
  stars: number;
  license: string;
  description: string;
  highlights: string[];
  source: 'github-live' | 'curado';
}

/** Fallback curado (usado se a API do GitHub estiver fora do ar/limite). */
const CURATED_BEST: SeoRepo = {
  name: 'claude-seo',
  fullName: 'AgriciDaniel/claude-seo',
  url: 'https://github.com/AgriciDaniel/claude-seo',
  stars: 19100,
  license: 'MIT',
  description: 'Skill de SEO para agentes Claude:26 sub-skills e 19 agentes especializados (SEO técnico, E-E-A-T, Schema, GEO/AEO, llms.txt, local, e-commerce, internacional, Core Web Vitals).',
  highlights: [
    'comando /seo plan <type> separa a estratégia por categoria (saas, local, ecommerce, publisher, agency)',
    'cada recomendação traz a observação que a justifica + um teste para saber se funcionou',
    '26 sub-skills + 19 agentes especializados',
  ],
  source: 'curado',
};

const CURATED_ALTS: SeoRepo[] = [
  {
    name: 'Agentic-SEO-Skill', fullName: 'varunpasricha/Agentic-SEO-Skill',
    url: 'https://github.com/varunpasricha/Agentic-SEO-Skill', stars: 0, license: '—',
    description: 'Funciona em Cursor, Windsurf, Copilot e Codex; modelos por setor; achados marcados com nível de confiança (Confirmado, Provável, Hipótese).',
    highlights: ['multi-IDE', 'níveis de confiança por achado'], source: 'curado',
  },
  {
    name: 'geo-seo-claude', fullName: 'ryw-ai/geo-seo-claude',
    url: 'https://github.com/ryw-ai/geo-seo-claude', stars: 0, license: '—',
    description: 'Foco em GEO: ser citado pelas IAs (ChatGPT, Perplexity, Google AI Overviews).',
    highlights: ['GEO/AEO'], source: 'curado',
  },
  {
    name: 'marketingskills', fullName: 'coreyhaines31/marketingskills',
    url: 'https://github.com/coreyhaines31/marketingskills', stars: 0, license: '—',
    description: 'Maior pacote de skills de marketing; inclui SEO, mas é mais amplo.',
    highlights: ['suíte ampla de marketing'], source: 'curado',
  },
];

async function fetchSeoRepos(): Promise<{ best: SeoRepo; alternatives: SeoRepo[] }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(
      'https://api.github.com/search/repositories?q=claude+seo+skill+in:name,description&sort=stars&order=desc&per_page=6',
      { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'hermes-optimizer' }, signal: ctrl.signal },
    );
    clearTimeout(t);
    if (!r.ok) throw new Error(`github ${r.status}`);
    const j = await r.json() as { items?: any[] };
    const items = (j.items ?? []).filter((i) => i && typeof i.stargazers_count === 'number');
    if (!items.length) throw new Error('sem resultados');
    const map = (i: any, idx: number): SeoRepo => ({
      name: i.name,
      fullName: i.full_name,
      url: i.html_url,
      stars: i.stargazers_count,
      license: i.license?.spdx_id || '—',
      description: String(i.description ?? '').slice(0, 300),
      // Destaques curados só para o repo conhecido; os demais ganham contexto genérico.
      highlights: /claude-seo/i.test(i.full_name)
        ? CURATED_BEST.highlights
        : ['skill/repos de SEO para agentes — avalie aderência ao seu stack'],
      source: 'github-live',
    });
    const list = items.map(map);
    // Garante que o claude-seo curado apareça primeiro se estiver no resultado.
    const bestIdx = list.findIndex((r) => /AgriciDaniel\/claude-seo/i.test(r.fullName));
    const best = bestIdx > 0 ? list.splice(bestIdx, 1)[0] : list.shift()!;
    return { best, alternatives: [...list, ...CURATED_ALTS.filter(a => !list.some(l => l.fullName === a.fullName))].slice(0, 4) };
  } catch {
    // GitHub fora do ar / rate-limit (API anônima: 10 req/min) → curado.
    return { best: CURATED_BEST, alternatives: CURATED_ALTS };
  }
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 256 * 1024) throw new Error('corpo muito grande');
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('JSON inválido'); }
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export async function handleOptimizerRoutes(
  req: IncomingMessage, res: ServerResponse, pathname: string,
): Promise<boolean> {
  if (!pathname.startsWith('/api/optimizer/')) return false;
  const method = req.method ?? 'GET';

  try {
    if (pathname === '/api/optimizer/optimize' && method === 'POST') {
      const b = await readBody(req);
      const prompt = String(b.prompt ?? '').trim();
      if (!prompt) { send(res, 400, { error: 'prompt obrigatório' }); return true; }
      const result = await runOptimizer({
        prompt,
        pdfUrls: Array.isArray(b.pdfUrls) ? b.pdfUrls.map(String) : [],
        docUrls: Array.isArray(b.docUrls) ? b.docUrls.map(String) : [],
        project: b.project ? String(b.project) : undefined,
      });
      send(res, 200, result);
      return true;
    }

    if (pathname === '/api/optimizer/discuss' && method === 'POST') {
      const b = await readBody(req);
      const prompt = String(b.prompt ?? '').trim();
      if (!prompt) { send(res, 400, { error: 'prompt obrigatório' }); return true; }
      send(res, 200, await discuss({
        prompt,
        optimized: String(b.optimized ?? ''),
        issues: Array.isArray(b.issues) ? b.issues.map(String) : [],
        messages: Array.isArray(b.messages) ? b.messages : [],
      }));
      return true;
    }

    if (pathname === '/api/optimizer/seo-repo' && method === 'GET') {
      send(res, 200, await fetchSeoRepos());
      return true;
    }

    return false;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /obrigat|inválid|JSON/i.test(msg) ? 400 : 500;
    if (!res.headersSent) send(res, status, { error: msg });
    return true;
  }
}
