/**
 * market-analysis — análise de mercado crua e realista (anti-sicofância).
 *
 * Pipeline:
 *  1. Research: web search (Tavily/SerpAPI/...) + notícias + posts do Reddit
 *     (o maior forum de usuários do mundo — dor real pedida por quem compra).
 *  2. LLM com prompt Devil's Advocate: extrai pontos fortes/fracos, participação
 *     de mercado (%), concorrentes e gaps. Proibido elogiar o usuário.
 *  3. Renderiza um DASHBOARD HTML interativo (Tailwind + Chart.js via CDN)
 *     salvo em data/market-reports/ — visível na aba Previews do Hermes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { searchWeb, scrapeUrl, type SearchProvider } from '../research/researcher.js';
import { getGateway, getVirtualKey } from '../gateway/gateway-singleton.js';
import { resolveModel } from '../llm/routing-store.js';
import { auditLogger } from '../core/audit-logger.js';
import { eventBus } from '../core/event-bus.js';

const OUT_DIR = join(process.cwd(), 'data', 'market-reports');

export interface RedditPost {
  title: string; subreddit: string; score: number; numComments: number;
  url: string; excerpt: string; upvoteRatio: number | null;
}

export interface Competitor {
  name: string; sharePercent: number; positioning: string; strengths: string; weaknesses: string;
}

export interface MarketReport {
  topic: string;
  generatedAt: string;
  executiveSummary: string;
  verdict: string;                 // honesto, sem lisonja
  strengths: string[];
  weaknesses: string[];
  competitors: Competitor[];       // sharePercent soma ~100
  opportunities: string[];
  threats: string[];
  redditInsights: { painPoints: string[]; requestedFeatures: string[]; topPosts: RedditPost[] };
  sources: { title: string; url: string }[];
  dashboardPath: string;           // relativo ao cwd p/ abrir na aba Previews
}

// ─── Reddit (via busca Tavily site:reddit.com) ──────────────────────────────
// O Reddit bloqueia clientes diretos (403/429 até com impersonation de Chrome).
// A rota robusta é buscar via Tavily com `site:reddit.com` — devolve título +
// URL + snippet do post real. Excertos vêm do snippet (não scrapeamos o Reddit).
async function collectReddit(query: string, limit = 10): Promise<RedditPost[]> {
  try {
    const res = await searchWeb(`site:reddit.com ${query}`, undefined, limit);
    return res.results
      .filter((h) => /reddit\.com\/r\//i.test(h.url))
      .map((h) => {
        const sub = /\/r\/([^/]+)/i.exec(h.url)?.[1] ?? '';
        return {
          title: h.title || '',
          subreddit: sub,
          score: 0,               // Tavily não expõe score — mantém 0 (honesto)
          numComments: 0,
          url: h.url,
          excerpt: (h.snippet || '').slice(0, 500),
          upvoteRatio: null,
        };
      });
  } catch { return []; }
}

// ─── LLM: análise crua estruturada ──────────────────────────────────────────
const ANALYSIS_PROMPT = (topic: string, ctx: string) => `Você é um ANALISTA DE MERCADO BRUTALMENTE HONESTO (estilo Devil's Advocate / concil analise). REGRAS ABSOLUTAS:
- NUNCA elogie o usuário, NUNCA puxe saco, NUNCA use eufemismo. Realismo acima de tudo.
- Se o produto/tema for fraco, diga. Se for medíocre, diga. Se for bom em algo, diga o PORQUÊ com dado.
- Separe OPINIÃO de DADO. Cite o número/quando o dado existir; quando estimar, marque "(estimativa)".
- Use o Reddit como voz do usuário real (dor, pedido, reclamação) — não como Marketing.
- SEJA CONCISO: cada string deve ter no máximo 1-2 frases. Não escreva parágrafos longos — isso corta seu JSON.

Tema analisado: "${topic}"

DADOS COLETADOS (web, notícias e Reddit):
${ctx}

Responda SOMENTE com JSON válido (sem markdown, sem crases, sem comentários). Use exatamente esta estrutura (os valores abaixo são EXEMPLOS — substitua pelos seus dados reais):
{
  "executiveSummary": "3-5 frases cruas e diretas",
  "verdict": "veredito honesto em 2-3 frases (vale a pena? para quem? com que ressalvas?)",
  "strengths": ["ponto forte concreto", "outro ponto forte"],
  "weaknesses": ["ponto fraco concreto", "outro ponto fraco"],
  "competitors": [
    {"name": "NomeDoPlayer", "sharePercent": 35, "positioning": "como se posiciona", "strengths": "seu forte", "weaknesses": "seu fraco"},
    {"name": "OutroPlayer", "sharePercent": 30, "positioning": "como se posiciona", "strengths": "seu forte", "weaknesses": "seu fraco"}
  ],
  "opportunities": ["oportunidade/gapa identificada", "outra oportunidade"],
  "threats": ["ameaça real", "outra ameaça"],
  "redditInsights": {
    "painPoints": ["dor recorrente relatada", "outra dor"],
    "requestedFeatures": ["recurso muito pedido pelos usuários", "outro recurso"]
  }
}
Regras dos "competitors": devem somar ~100% de sharePercent (inclua o próprio tema se for um produto, ou o líder de mercado se for categoria). Mínimo 3, máximo 6 concorrentes. Cada campo de string deve ter conteúdo real, nunca vazio.`;

function parseJson<T>(raw: string): T {
  // Remove cercas de código markdown e texto antes do primeiro {.
  let s = raw.replace(/```(?:json)?/gi, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`LLM não retornou JSON (saída: ${raw.slice(0, 200)})`);
  }
  s = s.slice(start, end + 1);
  try {
    return JSON.parse(s) as T;
  } catch {
    // Reparo comum: vírgula final antes de } ou ] que o modelo às vezes deixa.
    const repaired = s.replace(/,(\s*[}\]])/g, '$1');
    try {
      return JSON.parse(repaired) as T;
    } catch (e) {
      throw new Error(`JSON inválido do LLM (${String(e)}): ${s.slice(0, 200)}`);
    }
  }
}

// ─── Dashboard HTML ─────────────────────────────────────────────────────────
function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function renderDashboard(r: MarketReport): string {
  const comp = r.competitors;
  const colors = ['#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#ef4444', '#06b6d4'];
  const donutData = comp.map((c) => c.sharePercent);
  const donutColors = comp.map((_, i) => colors[i % colors.length]);

  const li = (arr: string[], cls: string) =>
    arr.map((x) => `<li class="flex gap-2 items-start"><span class="${cls} mt-0.5">•</span><span>${esc(x)}</span></li>`).join('');

  const compRows = comp.map((c, i) => `
    <tr class="border-t border-gray-800 hover:bg-gray-900/40">
      <td class="px-3 py-2 font-semibold"><span class="inline-block w-2.5 h-2.5 rounded-full mr-2" style="background:${colors[i % colors.length]}"></span>${esc(c.name)}</td>
      <td class="px-3 py-2 text-amber-400 font-mono font-bold">${c.sharePercent}%</td>
      <td class="px-3 py-2 text-gray-400">${esc(c.positioning)}</td>
      <td class="px-3 py-2 text-emerald-400/90">${esc(c.strengths)}</td>
      <td class="px-3 py-2 text-red-400/90">${esc(c.weaknesses)}</td>
    </tr>`).join('');

  const posts = r.redditInsights.topPosts.slice(0, 8).map((p) => `
    <a href="${esc(p.url)}" target="_blank" rel="noopener" class="block bg-gray-900/60 border border-gray-800 rounded-lg p-3 hover:border-amber-700/60 transition">
      <div class="flex items-center gap-2 text-[10px] font-mono text-gray-500 mb-1">
        <span class="text-orange-400">r/${esc(p.subreddit)}</span>
      </div>
      <div class="text-xs text-gray-200 leading-snug">${esc(p.title)}</div>
      ${p.excerpt ? `<div class="text-[11px] text-gray-500 mt-1 leading-snug line-clamp-2">${esc(p.excerpt.slice(0, 160))}</div>` : ''}
    </a>`).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Análise de Mercado — ${esc(r.topic)}</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>body{font-family:Inter,system-ui,sans-serif}</style>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen">
<div class="max-w-6xl mx-auto p-6 space-y-6">

  <header class="border-b border-gray-800 pb-4">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <h1 class="text-2xl font-bold">📊 Análise de Mercado — ${esc(r.topic)}</h1>
      <span class="text-xs font-mono text-gray-500">${esc(r.generatedAt)}</span>
    </div>
    <p class="text-[11px] text-amber-500/80 mt-1 font-mono">Análise crua e realista (anti-sicofância) · fontes: web, notícias e Reddit</p>
  </header>

  <section class="bg-gray-900/50 border border-amber-900/40 rounded-xl p-4">
    <h2 class="text-sm font-bold text-amber-400 mb-2">🎯 Resumo executivo</h2>
    <p class="text-sm text-gray-200 leading-relaxed">${esc(r.executiveSummary)}</p>
  </section>

  <section class="bg-red-950/20 border border-red-900/40 rounded-xl p-4">
    <h2 class="text-sm font-bold text-red-400 mb-2">⚖️ Veredito (sem lisonja)</h2>
    <p class="text-sm text-gray-200 leading-relaxed">${esc(r.verdict)}</p>
  </section>

  <div class="grid md:grid-cols-2 gap-4">
    <section class="bg-gray-900/40 border border-emerald-900/40 rounded-xl p-4">
      <h2 class="text-sm font-bold text-emerald-400 mb-2">✅ Pontos fortes</h2>
      <ul class="text-sm space-y-1.5 text-gray-300">${li(r.strengths, 'text-emerald-400')}</ul>
    </section>
    <section class="bg-gray-900/40 border border-red-900/40 rounded-xl p-4">
      <h2 class="text-sm font-bold text-red-400 mb-2">⚠️ Pontos fracos</h2>
      <ul class="text-sm space-y-1.5 text-gray-300">${li(r.weaknesses, 'text-red-400')}</ul>
    </section>
  </div>

  <section class="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
    <h2 class="text-sm font-bold text-amber-400 mb-3">🥧 Participação de mercado</h2>
    <div class="grid md:grid-cols-2 gap-6 items-center">
      <div class="relative h-64"><canvas id="donut"></canvas></div>
      <div class="space-y-2">
        ${comp.map((c, i) => `
        <div class="flex items-center gap-3">
          <span class="w-3 h-3 rounded-full shrink-0" style="background:${colors[i % colors.length]}"></span>
          <span class="text-sm flex-1">${esc(c.name)}</span>
          <span class="text-sm font-mono font-bold text-amber-400">${c.sharePercent}%</span>
        </div>`).join('')}
      </div>
    </div>
    <div class="mt-4 space-y-2">
      ${comp.map((c, i) => `
      <div>
        <div class="flex justify-between text-[11px] text-gray-400 mb-1"><span>${esc(c.name)}</span><span class="font-mono">${c.sharePercent}%</span></div>
        <div class="h-2.5 bg-gray-800 rounded-full overflow-hidden">
          <div class="h-full rounded-full" style="width:${Math.min(100, c.sharePercent)}%;background:${colors[i % colors.length]}"></div>
        </div>
      </div>`).join('')}
    </div>
  </section>

  <section class="bg-gray-900/40 border border-gray-800 rounded-xl p-4 overflow-x-auto">
    <h2 class="text-sm font-bold text-amber-400 mb-3">🏁 Concorrentes — comparação direta</h2>
    <table class="w-full text-xs min-w-[700px]">
      <thead><tr class="text-gray-500 text-left">
        <th class="px-3 py-2">Player</th><th class="px-3 py-2">Share</th>
        <th class="px-3 py-2">Posicionamento</th><th class="px-3 py-2">Forte</th><th class="px-3 py-2">Fraco</th>
      </tr></thead>
      <tbody>${compRows}</tbody>
    </table>
  </section>

  <div class="grid md:grid-cols-2 gap-4">
    <section class="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
      <h2 class="text-sm font-bold text-cyan-400 mb-2">🚀 Oportunidades</h2>
      <ul class="text-sm space-y-1.5 text-gray-300">${li(r.opportunities, 'text-cyan-400')}</ul>
    </section>
    <section class="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
      <h2 class="text-sm font-bold text-red-400 mb-2">💣 Ameaças</h2>
      <ul class="text-sm space-y-1.5 text-gray-300">${li(r.threats, 'text-red-400')}</ul>
    </section>
  </div>

  <section class="bg-gray-900/40 border border-orange-900/40 rounded-xl p-4">
    <h2 class="text-sm font-bold text-orange-400 mb-3">🗣️ Voz do usuário real (Reddit)</h2>
    <div class="grid md:grid-cols-2 gap-4 mb-4">
      <div>
        <h3 class="text-xs font-bold text-gray-400 mb-1.5">Dores recorrentes</h3>
        <ul class="text-sm space-y-1 text-gray-300">${li(r.redditInsights.painPoints, 'text-orange-400')}</ul>
      </div>
      <div>
        <h3 class="text-xs font-bold text-gray-400 mb-1.5">Recursos muito pedidos</h3>
        <ul class="text-sm space-y-1 text-gray-300">${li(r.redditInsights.requestedFeatures, 'text-amber-400')}</ul>
      </div>
    </div>
    ${posts ? `<div class="grid sm:grid-cols-2 gap-2">${posts}</div>` : '<p class="text-xs text-gray-500">Nenhum post coletado.</p>'}
  </section>

  <section class="bg-gray-90/30 border border-gray-800 rounded-xl p-4">
    <h2 class="text-sm font-bold text-gray-400 mb-2">📚 Fontes</h2>
    <ul class="text-xs space-y-1">
      ${r.sources.map((s) => `<li><a class="text-amber-500/80 hover:underline" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a></li>`).join('')}
    </ul>
  </section>

  <footer class="text-center text-[10px] text-gray-600 pt-4">Hermes Control Center · gerado automaticamente pelo Agente Pesquisador + Orquestrador</footer>
</div>

<script>
new Chart(document.getElementById('donut'), {
  type: 'doughnut',
  data: { labels: ${JSON.stringify(comp.map((c) => c.name))},
          datasets: [{ data: ${JSON.stringify(donutData)}, backgroundColor: ${JSON.stringify(donutColors)},
                       borderColor: '#0b0f19', borderWidth: 2, hoverOffset: 8 }] },
  options: {
    responsive: true, maintainAspectRatio: false, cutout: '62%',
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (c) => ' ' + c.label + ': ' + c.parsed + '%' } }
    }
  }
});
</script>
</body></html>`;
}

// ─── Pipeline principal ─────────────────────────────────────────────────────
export async function runMarketAnalysis(
  topic: string,
  opts: { provider?: SearchProvider; project?: string } = {},
): Promise<MarketReport> {
  const started = Date.now();
  eventBus.publish('research:started', { query: `[mercado] ${topic}` });

  // 1) Pesquisa web (visão geral + tendências + concorrentes)
  const searches: Array<{ q: string; label: string }> = [
    { q: `${topic} mercado concorrentes market share 2026`, label: 'mercado' },
    { q: `${topic} review comparison pros cons`, label: 'comparativo' },
    { q: `${topic} notícias lançamento trends`, label: 'notícias' },
  ];
  const allHits: { title: string; url: string; snippet: string }[] = [];
  const sources: { title: string; url: string }[] = [];
  const docs: string[] = [];

  for (const s of searches) {
    try {
      const res = await searchWeb(s.q, opts.provider, 4);
      for (const h of res.results) {
        allHits.push(h);
        sources.push({ title: h.title, url: h.url });
      }
    } catch { /* segue com o que tem */ }
  }

  // Scrape dos top resultados (teto 6 p/ custo)
  const seen = new Set<string>();
  let scraped = 0;
  for (const h of allHits) {
    if (scraped >= 6 || seen.has(h.url)) continue;
    seen.add(h.url);
    try {
      const sc = await scrapeUrl(h.url, 'curl_cffi');
      if (sc.ok && sc.text) { docs.push(`--- FONTE: ${h.title} (${h.url})\n${sc.text.slice(0, 5000)}`); scraped++; }
      else docs.push(`--- FONTE (snippet): ${h.title} (${h.url})\n${h.snippet}`);
    } catch { docs.push(`--- FONTE (snippet): ${h.title} (${h.url})\n${h.snippet}`); }
  }

  // 2) Reddit — voz do usuário real (máx 2 consultas p/ custo/latência)
  const redditQueries = [`${topic} experience review`, `${topic} missing feature request`];
  const posts: RedditPost[] = [];
  for (const q of redditQueries) {
    const p = await collectReddit(q, 15);
    posts.push(...p);
    if (p.length) sources.push({ title: `Reddit: ${q}`, url: `https://www.reddit.com/search/?q=${encodeURIComponent(q)}` });
  }
  const redditText = posts.length
    ? `\n\nPOSTS DO REDDIT (maior forum de usuários — dor e pedido real, via busca site:reddit.com):\n` +
      posts.slice(0, 20).map((p) => `[r/${p.subreddit}] ${p.title}${p.excerpt ? ` — ${p.excerpt.slice(0, 220)}` : ''}`).join('\n')
    : '\n\n(reddit indisponível nesta rodada)';

  // 3) LLM — análise crua estruturada, com retry (modelos grátis às vezes
  //    devolvem JSON malformado — aspas não escapadas / vírgula faltando).
  const model = await resolveModel('svc-serpapi');
  const virtualKey = await getVirtualKey('market');
  const userContent = ANALYSIS_PROMPT(topic, docs.join('\n\n').slice(0, 24000) + redditText);
  type ParsedAnalysis = {
    executiveSummary: string; verdict: string; strengths: string[]; weaknesses: string[];
    competitors: Competitor[]; opportunities: string[]; threats: string[];
    redditInsights: { painPoints: string[]; requestedFeatures: string[] };
  };
  let parsed: ParsedAnalysis | undefined;
  let lastErr = '';
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // No retry, aponta o erro e pede para corrigir (reusa a saída anterior).
    const messages = attempt === 1
      ? [
          { role: 'system' as const, content: 'Você é um analista de mercado anti-sicofância. Responda APENAS com JSON válido — nenhuma outra palavra.' },
          { role: 'user' as const, content: userContent },
        ]
      : [
          { role: 'system' as const, content: 'Você é um analista de mercado anti-sicofância. Responda APENAS com JSON válido — nenhuma outra palavra. Escape aspas duplas dentro de strings com \\" e não esqueça vírgulas.' },
          { role: 'user' as const, content: userContent },
          { role: 'assistant' as const, content: lastErr.slice(0, 2000) },
          { role: 'user' as const, content: 'Sua resposta anterior era JSON inválido. Corrija os erros de sintaxe (aspas escapadas, vírgulas) e devolva APENAS o JSON corrigido, completo, começando com { e terminando com }.' },
        ];
    const out = await getGateway().complete({ model, virtualKey, maxTokens: 4096, temperature: 0.3, messages });
    try {
      parsed = parseJson<ParsedAnalysis>(out.content);
      break;
    } catch (e) {
      lastErr = out.content || String(e);
      if (attempt === MAX_ATTEMPTS) throw e;
    }
  }
  if (!parsed) throw new Error(`JSON do LLM após ${MAX_ATTEMPTS} tentativas: ${lastErr.slice(0, 160)}`);

  // Normaliza: garante share somando ~100 e campos presentes
  const competitors = (parsed.competitors ?? []).slice(0, 6);
  const totalShare = competitors.reduce((a, c) => a + (Number(c.sharePercent) || 0), 0);
  if (totalShare > 0 && Math.abs(totalShare - 100) > 3) {
    for (const c of competitors) c.sharePercent = Math.round((c.sharePercent / totalShare) * 100);
  }

  const report: MarketReport = {
    topic,
    generatedAt: new Date().toISOString(),
    executiveSummary: parsed.executiveSummary ?? '',
    verdict: parsed.verdict ?? '',
    strengths: parsed.strengths ?? [],
    weaknesses: parsed.weaknesses ?? [],
    competitors,
    opportunities: parsed.opportunities ?? [],
    threats: parsed.threats ?? [],
    redditInsights: {
      painPoints: parsed.redditInsights?.painPoints ?? [],
      requestedFeatures: parsed.redditInsights?.requestedFeatures ?? [],
      topPosts: posts.slice(0, 8),
    },
    sources: sources.slice(0, 20),
    dashboardPath: '',
  };

  // 4) Renderiza e salva o dashboard
  mkdirSync(OUT_DIR, { recursive: true });
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report';
  const file = `${slug}-${Date.now().toString(36)}.html`;
  writeFileSync(join(OUT_DIR, file), renderDashboard(report), 'utf8');
  report.dashboardPath = `data/market-reports/${file}`;

  auditLogger.log({
    actor: 'SUBAGENT', event: 'market:analysis',
    payload: { topic, model, competitors: competitors.length, posts: posts.length, file: report.dashboardPath },
  });
  eventBus.publish('research:completed', { query: `[mercado] ${topic}`, model });
  void started;
  return report;
}
