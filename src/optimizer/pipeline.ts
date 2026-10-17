/**
 * pipeline — Otimizador de Prompts (backend).
 *
 * Cada etapa é um serviço isolado (INTENT → ANÁLISE FRIA → PESQUISA → EXPANSÃO
 * → OTIMIZAÇÃO). Reusa os serviços existentes do Hermes em vez de puxar a stack
 * do template Next.js:
 *   • researcher.searchWeb/scrapeUrl  (Tavily/SerpAPI — Camada de pesquisa)
 *   • context7.searchLibraries/fetchContext (docs de libs, regra anti-alucinação)
 *   • MarkItDown via worker pdf2md    (PDFs → Markdown econômico)
 *   • gateway.complete                (LLM com modelo resolvido + retry de JSON)
 * Modelos grátis às vezes devolvem JSON malformado → helper structuredJson retrya.
 */
import { getGateway, getVirtualKey } from '../gateway/gateway-singleton.js';
import { resolveModel } from '../llm/routing-store.js';
import { searchWeb, scrapeUrl } from '../research/researcher.js';
import { searchLibraries, fetchContext } from '../research/context7.js';
import { auditLogger } from '../core/audit-logger.js';
import { eventBus } from '../core/event-bus.js';
import {
  sanitizeIntent, sanitizeAnalysis, sanitizeSources, lineDiff, CRITERIA,
  type PipelineResult, type Source, type Intent, type ColdAnalysis,
  type ChangelogEntry,
} from './contracts.js';

const PYTHON = process.env.PYTHON_BIN || 'python';
const MAX_ATTEMPTS = 3;

// ─── LLM estruturado com retry ──────────────────────────────────────────────
function parseJson<T>(raw: string): T {
  let s = raw.replace(/```(?:json)?/gi, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error(`sem JSON: ${raw.slice(0, 120)}`);
  s = s.slice(start, end + 1);
  try { return JSON.parse(s) as T; }
  catch {
    try { return JSON.parse(s.replace(/,(\s*[}\]])/g, '$1')) as T; }
    catch (e) { throw new Error(`JSON inválido (${e}): ${s.slice(0, 160)}`); }
  }
}

async function structuredJson<T>(
  model: string, virtualKey: string, system: string, user: string,
  maxTokens = 3072,
): Promise<T> {
  let last = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const messages = attempt === 1
      ? [{ role: 'system' as const, content: system }, { role: 'user' as const, content: user }]
      : [
          { role: 'system' as const, content: `${system} Escape aspas duplas dentro de strings com \\" e não esqueça vírgulas.` },
          { role: 'user' as const, content: user },
          { role: 'assistant' as const, content: last.slice(0, 2000) },
          { role: 'user' as const, content: 'JSON anterior inválido. Corrija a sintaxe e devolva APENAS o JSON completo, de { a }.' },
        ];
    const out = await getGateway().complete({ model, virtualKey, maxTokens, temperature: 0.3, messages });
    try { return parseJson<T>(out.content); }
    catch (e) { last = out.content || String(e); if (attempt === MAX_ATTEMPTS) throw e; }
  }
  throw new Error(`JSON após ${MAX_ATTEMPTS} tentativas: ${last.slice(0, 120)}`);
}

// ─── Contexto: PDFs + URLs + Context7 ───────────────────────────────────────
async function fetchPdfText(url: string): Promise<string> {
  // Baixa p/ arquivo temporário e roda o worker MarkItDown (pdf2md).
  const { spawn } = await import('node:child_process');
  const { join } = await import('node:path');
  const { writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  return new Promise((resolve) => {
    (async () => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(45_000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        const tmp = join(tmpdir(), `hermes-opt-${Date.now()}.pdf`);
        writeFileSync(tmp, buf);
        const child = spawn(PYTHON, [join(process.cwd(), 'scripts', 'research', 'pdf2md.py'), '--file', tmp], { windowsHide: true });
        let out = '';
        const t = setTimeout(() => child.kill(), 90_000);
        child.stdout.on('data', (d) => { out += d; });
        child.on('error', () => { clearTimeout(t); resolve(''); });
        child.on('close', () => {
          clearTimeout(t);
          try { resolve(String(JSON.parse(out.trim()).markdown ?? '')); } catch { resolve(''); }
          finally { try { rmSync(tmp); } catch { /* ok */ } }
        });
        void readFileSync;
      } catch { resolve(''); }
    })();
  });
}

async function gatherContext(pdfUrls: string[], docUrls: string[], prompt: string): Promise<{
  texts: string[]; sources: Source[]; context7Count: number;
}> {
  const texts: string[] = [];
  const sources: Source[] = [];
  let context7Count = 0;

  // PDFs → Markdown
  for (const u of pdfUrls.filter(Boolean).slice(0, 4)) {
    const md = await fetchPdfText(u);
    if (md) { texts.push(`--- PDF: ${u}\n${md.slice(0, 12000)}`); sources.push({ ref: u, kind: 'pdf', excerpt: md.slice(0, 400) }); }
  }
  // URLs → scrape
  for (const u of docUrls.filter(Boolean).slice(0, 5)) {
    try {
      const sc = await scrapeUrl(u, 'curl_cffi');
      if (sc.ok && sc.text) { texts.push(`--- DOC: ${u}\n${sc.text.slice(0, 12000)}`); sources.push({ ref: u, kind: 'web', excerpt: sc.text.slice(0, 400) }); }
    } catch { /* segue */ }
  }
  // Context7 → libs citadas no prompt
  try {
    const hits = await searchLibraries(prompt.slice(0, 120));
    for (const h of hits.slice(0, 2)) {
      try {
        const ctx = await fetchContext(h.id, prompt);
        texts.push(`--- CONTEXT7 (${h.title || h.id})\n${ctx.markdown.slice(0, 8000)}`);
        sources.push({ ref: `context7:${h.id}`, kind: 'context7', excerpt: ctx.markdown.slice(0, 400) });
        context7Count++;
      } catch { /* segue */ }
    }
  } catch { /* segue */ }

  return { texts, sources, context7Count };
}

// ─── Etapas (LLM) ───────────────────────────────────────────────────────────
async function intentAndAnalysis(model: string, vk: string, prompt: string): Promise<{ intent: Intent; analysis: ColdAnalysis }> {
  const system = `Você é um analista de prompts BRUTALMENTE HONESTO. Sem elogios, sem cortesia, sem frases de enrolação. Responda APENAS com JSON válido (escape aspas internas com \\" e não esqueça vírgulas).`;
  const user = `Analise o prompt abaixo. Extraia a INTENT e faça uma ANÁLISE FRIA.

PROMPT DO USUÁRIO:
"""
${prompt}
"""

Responda JSON com:
{
  "intent": {"objective":"...","audience":"...","deliverable":"...","implicitConstraints":["..."],"summary":"1-2 frases"},
  "analysis": {
    "scores": {"clareza":0-10,"ambiguidade":0-10,"contexto":0-10,"papel":0-10,"formato de saída":0-10,"restrições":0-10,"exemplos":0-10,"critérios de sucesso":0-10},
    "issues": [{"criterion":"clareza|ambiguidade|contexto|papel|formato de saída|restrições|exemplos|critérios de sucesso","excerpt":"trecho problemático","problem":"o que está mal","impacto":"consequência prática","severity":1-5}]
  }
}
Regras da análise: liste SÓ problemas (nada de pontos positivos). Cada issue no formato {criterion, excerpt, problem, impact, severity 1-5}. Scores são 0-10 por critério (0=péssimo, 10=perfeito). Mínimo 3 issues se houver problema real.`;
  const raw = await structuredJson<any>(model, vk, system, user, 3584);
  return { intent: sanitizeIntent(raw.intent), analysis: sanitizeAnalysis(raw.analysis) };
}

async function research(model: string, vk: string, prompt: string, intent: Intent, ctxTexts: string[]): Promise<string[]> {
  const web = await searchWeb(`${intent.objective || prompt} documentação melhores práticas`, undefined, 4).catch(() => null);
  const webCtx = web?.results.map((r) => `- ${r.title} (${r.url}): ${r.snippet}`).join('\n') ?? '';
  const system = `Você é um pesquisador técnico. Responda APENAS com JSON válido. Sustente cada afirmação com uma fonte {ref, kind:"web|pdf|context7", excerpt}.`;
  const user = `PROMPT: """${prompt}"""\nINTENT: ${intent.summary || intent.objective}\n\nCONTEXTO COLETADO (PDFs/URLs/Context7):\n${ctxTexts.join('\n\n').slice(0, 20000)}\n\nRESULTADOS WEB:\n${webCtx}\n\nListe 3-6 FINDINGS que sustentem como este prompt deve ser tratado (tecnologias, APIs, requisitos reais). JSON: {"findings":["afirmação com respaldo","..."],"sources":[{"ref":"url|arquivo","kind":"web|pdf|context7","excerpt":"trecho"}]}`;
  const raw = await structuredJson<any>(model, vk, system, user, 2560);
  return Array.isArray(raw.findings) ? raw.findings.filter((f: any) => typeof f === 'string') : [];
}

async function expansionAndOptimize(
  model: string, vk: string, prompt: string, intent: Intent, analysis: ColdAnalysis, findings: string[],
): Promise<{ applied: string; added: string[]; guardrails: string[]; optimized: string; changelog: ChangelogEntry[] }> {
  const system = `Você é engenheiro-chefe de prompts. Responda APENAS com JSON válido (escape aspas internas com \\", sem vírgulas faltando). Entregue resultado APLICADO, nunca lista de sugestões soltas. Não invente requisitos fora da intenção extraída.`;
  const issues = analysis.issues.map((i) => `- [${i.criterion} sev${i.severity}] ${i.problem}`).join('\n');
  const user = `PROMPT ORIGINAL:\n"""\n${prompt}\n"""\n\nINTENT: ${intent.summary}\nPROBLEMAS ENCONTRADOS:\n${issues || '(nenhum crítico)'}\nACHADOS PESQUISA:\n${findings.join('\n') || '(sem achados externos)'}\n\nResponda JSON:\n{
  "applied": "a ideia central AMPLIADA já aplicada (parágrafo pronto, com os recursos pedidos integrados, corrigindo os problemas acima)",
  "addedFeatures": ["recurso ampliado dentro da intenção"],
  "guardrails": ["o que NÃO foi inventado (fora da intenção)"],
  "optimized": "o PROMPT FINAL reescrito, completo e autocontido (papel, contexto, tarefa, restrições, formato de saída, critérios de sucesso)",
  "changelog": [{"change":"o que mudou","rationale":"por quê","source":"url|arquivo se houver"}]
}`;
  const raw = await structuredJson<any>(model, vk, system, user, 4096);
  return {
    applied: typeof raw.applied === 'string' ? raw.applied : '',
    added: Array.isArray(raw.addedFeatures) ? raw.addedFeatures : [],
    guardrails: Array.isArray(raw.guardrails) ? raw.guardrails : [],
    optimized: typeof raw.optimized === 'string' ? raw.optimized : prompt,
    changelog: Array.isArray(raw.changelog)
      ? raw.changelog.map((c: any) => ({ change: String(c?.change ?? ''), rationale: String(c?.rationale ?? ''), source: c?.source ? String(c.source) : undefined })).filter((c: ChangelogEntry) => c.change)
      : [],
  };
}

// ─── Orquestração ───────────────────────────────────────────────────────────
export async function runOptimizer(input: {
  prompt: string; pdfUrls?: string[]; docUrls?: string[]; project?: string;
}): Promise<PipelineResult> {
  const started = Date.now();
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('prompt obrigatório');
  eventBus.publish('research:started', { query: `[otimizador] ${prompt.slice(0, 80)}` });

  const model = await resolveModel('orchestrator');
  const vk = await getVirtualKey('optimizer');

  // PESQUISA (contexto offline: PDFs/URLs/Context7) — coleta primeiro p/ informs etapas
  const ctx = await gatherContext(input.pdfUrls ?? [], input.docUrls ?? [], prompt);
  const { intent, analysis } = await intentAndAnalysis(model, vk, prompt);
  const findings = await research(model, vk, prompt, intent, ctx.texts);
  const eo = await expansionAndOptimize(model, vk, prompt, intent, analysis, findings);

  const diff = lineDiff(prompt, eo.optimized);
  const sources: Source[] = [...ctx.sources];
  const result: PipelineResult = {
    intent,
    analysis,
    research: { findings, sources },
    expansion: { applied: eo.applied, addedFeatures: eo.added, guardrails: eo.guardrails },
    optimize: { optimizedPrompt: eo.optimized, diff: { before: prompt, after: eo.optimized, changedLines: diff.changedLines }, changelog: eo.changelog },
    sources,
    contextUsed: { pdfs: (input.pdfUrls ?? []).length, urls: (input.docUrls ?? []).length, context7: ctx.context7Count },
    model,
    latencyMs: Date.now() - started,
  };

  auditLogger.log({ actor: 'SUBAGENT', event: 'optimizer:run', payload: { model, criteria: CRITERIA.length, issues: analysis.issues.length, sources: sources.length, project: input.project } });
  eventBus.publish('research:completed', { query: `[otimizador] ${prompt.slice(0, 80)}`, model });
  return result;
}

// ─── Discussão interativa (confrontar / perguntas da LLM) ───────────────────
export async function discuss(input: {
  prompt: string; optimized: string; issues: string[]; messages: { role: 'user' | 'assistant'; content: string }[];
}): Promise<{ reply: string; wantsInfo: boolean }> {
  const model = await resolveModel('orchestrator');
  const vk = await getVirtualKey('optimizer');
  const hist = input.messages.slice(-10).map((m) => `${m.role === 'user' ? 'USUÁRIO' : 'OTIMIZADOR'}: ${m.content}`).join('\n');
  const out = await getGateway().complete({
    model, virtualKey: vk, maxTokens: 1200, temperature: 0.3,
    messages: [
      { role: 'system', content: `Você é o Otimizador de Prompts em modo CONFRONTO. Dialogue com o usuário sobre o prompt otimizado. Você PODE e DEVE perguntar aspectos do projeto dos quais tiver dúvida (público, stack, formato de saída, restrições) — em uma frase no final, se precisar de mais informação, comece com "PERGUNTA:". Seja direto, sem elogios. Responda em pt-BR.` },
      { role: 'user', content: `PROMPT ORIGINAL: """${input.prompt}"""\nPROMPT OTIMIZADO: """${input.optimized}"""\nPROBLEMAS MARCADOS: ${input.issues.join(' | ') || 'nenhum'}\n\nHISTÓRICO DA DISCUSSÃO:\n${hist || '(início)'}\n\nResponda à última mensagem do usuário.` },
    ],
  });
  const reply = out.content.trim();
  return { reply, wantsInfo: /^PERGUNTA:/m.test(reply) };
}
