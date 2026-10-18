/**
 * orchestrator-routes — Orquestrador real com switches de capacidade.
 *
 * GET  /api/orchestrator/config  → switches persistidos (data/orchestrator-config.json)
 * POST /api/orchestrator/config  → persiste switches
 * POST /api/orchestrator/run     {prompt} → executa com as capacidades ativas
 *
 * Switches:
 *  - pesquisaAvancada : dispara Agente Pesquisador (scraping + search APIs) e injeta contexto real
 *  - siteCrm          : instruções de geração de site CRM (ref. Odoo + Twenty)
 *  - siteProfissional : fluxo de design profissional (DESIGN.md, shadcn, Motion, GSAP…)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getGateway, getVirtualKey } from '../gateway/gateway-singleton.js';
import { resolveModel } from '../llm/routing-store.js';
import { eventBus } from '../core/event-bus.js';
import { appendFileSync } from 'node:fs';
import { researchTask, type ResearchReport } from '../research/researcher.js';
import { resolveDocs } from '../research/context7.js';
import { runMarketAnalysis, type MarketReport } from '../market/market-analysis.js';
import { continuityBlock, remember, saveState, normProject, recall } from '../memory/project-memory.js';
import { auditLogger } from '../core/audit-logger.js';
import {
  getPortMapText, parseProcessDirectives, buildPortManagementBlock,
} from '../guardian/process-agent.js';
import {
  PROJECTS_ROOT, saveRunArtifacts, listProjects, readProjectFile,
} from './project-store.js';
import { getCodeMapBlock } from './code-map.js';
import { Orchestrator, type PlanTaskResult, type SubagentTask } from './orchestrator.js';
import { SecurityScanner, type SecurityScanReport } from '../security/security-scanner.js';

const CONFIG_PATH = join(process.cwd(), 'data', 'orchestrator-config.json');

// ─── Histórico global de runs (aba Histórico) ────────────────────────────────
// Todo run é registrado AQUI, mesmo sem 📁 projeto — antes, runs sem projeto
// simplesmente sumiam (nada era salvo) e o usuário não via rastro nenhum.
const HISTORY_PATH = join(process.cwd(), 'data', 'orchestrator-history.jsonl');
const HISTORY_MAX = 200; // anel: trim acima disso p/ não crescer p/ sempre

export interface HistoryEntry {
  ts: string;
  project?: string;
  prompt: string;      // truncado (200 chars) p/ o card da UI
  model: string;
  latencyMs: number;
  ok: boolean;
  error?: string;
  reply: string;       // truncado (400 chars) p/ pré-visualização
  codeMapUrl?: string;
  savedFiles?: string[];
}

export function appendHistory(e: Omit<HistoryEntry, 'ts'> & { ts?: string }): void {
  try {
    appendFileSync(HISTORY_PATH, JSON.stringify({ ts: e.ts ?? new Date().toISOString(), ...e }) + '\n', 'utf8');
  } catch (err) {
    console.warn('[orchestrator] falha ao gravar histórico global:', String(err));
  }
}

export function listHistory(limit = 30): HistoryEntry[] {
  try {
    const raw = readFileSync(HISTORY_PATH, 'utf8').split('\n').filter(Boolean);
    return raw
      .slice(-Math.max(1, Math.min(limit, HISTORY_MAX)))
      .map((l) => { try { return JSON.parse(l) as HistoryEntry; } catch { return null; } })
      .filter((x): x is HistoryEntry => !!x)
      .reverse();
  } catch { return []; }
}

export interface OrchestratorSwitches {
  pesquisaAvancada: boolean;
  analiseMercado: boolean;
  siteCrm: boolean;
  siteProfissional: boolean;
  portasProcessos: boolean;
  /** Injeta o digest do mapa de código (Archify) como memória de contexto. */
  mapaCodigo: boolean;
}

const DEFAULT_SWITCHES: OrchestratorSwitches = {
  pesquisaAvancada: false,
  analiseMercado: false,
  siteCrm: false,
  siteProfissional: false,
  portasProcessos: false,
  mapaCodigo: true,
};

export function loadSwitches(): OrchestratorSwitches {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<OrchestratorSwitches>;
      // Descarta chaves obsoletas (ex.: docsContext7 — agora é background fixo).
      const { docsContext7: _legacy, ...rest } = raw as Record<string, unknown>;
      void _legacy;
      return { ...DEFAULT_SWITCHES, ...(rest as Partial<OrchestratorSwitches>) };
    }
  } catch { /* arquivo corrompido → default */ }
  return { ...DEFAULT_SWITCHES };
}

export function saveSwitches(s: Partial<OrchestratorSwitches>): OrchestratorSwitches {
  const next = { ...loadSwitches(), ...s };
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

// ---------------------------------------------------------------------------
// System prompt por capacidade
// ---------------------------------------------------------------------------

const SITE_CRM_BLOCK = `
CAPACIDADE SITE COM CRM (ativa):
Você está gerando um site profissional com CRM e área administrativa com login.
Referências obrigatórias de arquitetura (não copie o código — inspire-se):
 • Odoo (github.com/odoo/odoo): modelo de módulos/ORM, entities bem tipadas,
   herança de modelos, menu/admin por módulo, roles de acesso (acl).
 • Twenty (github.com/twentyhq/twenty): SPA moderna (Next.js/React), CRM UI
   clean, entidades core: Companies, Contacts, Opportunities (pipeline/Kanban),
   Activities/tarefas, Notes.
Entregue:
1. Estrutura de pastas do projeto (frontend + backend + auth + db schema).
2. Schema do CRM: companies, contacts, opportunities (estágios), activities, users/sessions.
3. Área administrativa com login (sessão/JWT), roles admin/manager/user.
4. Telas principais: dashboard, pipeline kanban, listas de contato/empresa, detalhe com timeline.
5. Trechos-chave de código (API CRUD + componente React principal).
Prefira stack: Next.js + TypeScript + Tailwind/shadcn + Postgres(SQL ou Prisma) + API route/Express.
`.trim();

const SITE_PRO_BLOCK = `
CAPACIDADE SITE PROFISSIONAL (ativa):
Use o Claude-Code-Frontend-Design-Toolkit e as skills de shadcn/ui, Tailwind v4,
Motion e GSAP.

Antes de gerar código:
1. Leia/crie o DESIGN.md (marca, público, tom, proibições, tokens).
2. Proponha uma direção estética específica para a categoria do site.
3. Defina tokens: cores, tipografia, escala, raios, sombras e motion.
4. Liste as seções e a hierarquia de conteúdo.
5. Só depois gere os componentes.

Regras:
- Use shadcn/ui como base (Radix primitives + Tailwind v4 @theme + CSS variables).
- Use Motion (Framer Motion) para microinterações.
- Use GSAP + ScrollTrigger apenas para scroll storytelling/cenas complexas.
- Respeite prefers-reduced-motion.
- Não use gradientes roxos, glassmorphism genérico, três cards idênticos ou hero genérico.
- Entregue estados: hover, focus, loading, erro, vazio e mobile.
- Se existir arquivo Figma/DS, aponte o Figma MCP e o design-token-bridge-mcp para ele.
- Revisão final: acessibilidade (contraste, foco, semântica), responsividade e motion.
`.trim();

const RESEARCH_BLOCK = `
CAPACIDADE PESQUISA AVANÇADA (ativa):
Você tem o Agente Pesquisador do Hermes acionado nesta rodada. Ele usa:
 • curl_cffi (TLS/JA3 fingerprint de navegador real, sem browser — padrão),
 • SeleniumBase UC Mode / Botasaurus (opcionais, para login/cliques reais),
 • APIs de busca já cadastradas: Tavily, SerpAPI, Brave, Linkup.
Use o CONTEXTO DE PESQUISA abaixo como base factual. Cite as fontes (título + URL)
quando usar informação delas. Se a pesquisa não bastar, indique explicitamente qual
URL/scraping adicional você precisaria (o orquestrador pode ser reexecutado).
`.trim();

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

interface RunResult {
  reply: string;
  model: string;
  switches: OrchestratorSwitches;
  research?: Pick<ResearchReport, 'query' | 'searchProvider' | 'sources' | 'model'>;
  project?: string;
  memory?: { continuityInjected: boolean; checkpointSaved: boolean };
  docs?: { context7Fetched: number };
  market?: { dashboardPath?: string; competitors?: number; verdict?: string; error?: string };
  /** Pasta F:\Projetos2026\DevMaster\<proj> gravada nesta rodada (prompt + respostas). */
  saved?: { folder: string; files: string[] };
  /** Ações de processo sugeridas pelo modelo; execução exige confirmação explícita. */
  processActionProposals?: Array<{ pid: number; action: string; reason: string; confirmationRequired: true }>;
  /** Digest do mapa de código (Archify) injetado como memória de contexto. */
  codeMap?: { title: string; url: string };
  latencyMs: number;
}

export async function runOrchestrator(prompt: string, project?: string): Promise<RunResult> {
  const started = Date.now();
  const switches = loadSwitches();
  const blocks: string[] = [];
  let research: RunResult['research'];
  let researchSynthesis: string | undefined;
  let researchFailed: string | undefined;
  let continuityInjected = false;
  let checkpointSaved = false;
  const proj = project ? normProject(project) : undefined;

  // 0) Memória de continuidade (pgvector) — "onde o código parou". Injetada
  //    primeiro para o modelo NÃO alucinar nem repetir trabalho já feito,
  //    independente de qual LLM estiver no cargo.
  if (proj) {
    try {
      blocks.push(await continuityBlock(proj, prompt));
      continuityInjected = true;
    } catch (e) {
      blocks.push(`(memória de continuidade indisponível: ${String(e instanceof Error ? e.message : e)})`);
    }
  }

  // 0.2) Mapa de código (Archify, switch) — memória de contexto arquitetura→código:
  //      injeta o digest do último mapa gerado p/ o orquestrador lembrar a estrutura
  //      do projeto sem reler o repositório inteiro a cada run.
  let codeMap: RunResult['codeMap'];
  if (switches.mapaCodigo) {
    try {
      const cm = getCodeMapBlock(proj);
      if (cm) {
        blocks.push(cm.block);
        codeMap = { title: cm.title, url: cm.url };
      }
    } catch { /* mapa indisponível — segue sem */ }
  }

  // 0.5) Context7 — REQUISITO PERMANENTE (roda em background, sem switch):
  //      docs de libs/APIs atualizados antes de gerar qualquer código. Evita
  //      alucinação de assinatura (o modelo "lembra" API desatualizada do
  //      treinamento). O doc buscado é PERSISTIDO no RAG (kind='doc') → próxima
  //      sessão já tem em cache, sem refetch.
  let docsFetched = 0;
  try {
    const docs = await resolveDocs(prompt, { maxLibs: 2 });
    for (const d of docs) {
      blocks.push(
        `DOCUMENTAÇÃO OFICIAL (${d.title}, via Context7 — use EXATAMENTE estas assinaturas):\n` +
        d.markdown.slice(0, 6000),
      );
      docsFetched++;
      if (proj) {
        // Persiste: cache de conhecimento por projeto.
        void remember({
          project: proj, kind: 'doc',
          title: `Context7: ${d.title}`,
          content: d.markdown.slice(0, 8000),
          tags: ['context7', 'docs'], metadata: { libraryId: d.libraryId },
        }).catch(() => {});
      }
    }
  } catch (e) {
    blocks.push(`(Context7 indisponível: ${String(e instanceof Error ? e.message : e)}. Declare a limitação se for crítico.)`);
  }

  // 1) Pesquisa avançada → coleta contexto real antes de responder
  if (switches.pesquisaAvancada) {
    try {
      const report = await researchTask(prompt, { maxResults: 3 });
      researchSynthesis = report.synthesis;
      research = {
        query: report.query,
        searchProvider: report.searchProvider,
        sources: report.sources,
        model: report.model,
      };
      blocks.push(
        `${RESEARCH_BLOCK}\n\nCONTEXTO DE PESQUISA:\n${report.synthesis}\n\nFONTES:\n` +
        report.sources.map((s, i) => `${i + 1}. ${s.title} — ${s.url}${s.scraped ? '' : ' (só snippet)'}`).join('\n'),
      );
    } catch (e) {
      researchFailed = String(e);
      blocks.push(`${RESEARCH_BLOCK}\n\n(aviso: a pesquisa falhou — ${researchFailed}. Prossiga com seu conhecimento e declare a limitação.)`);
    }
  }

  if (switches.siteCrm) blocks.push(SITE_CRM_BLOCK);
  if (switches.siteProfissional) blocks.push(SITE_PRO_BLOCK);

  // 2) Catálogo de APIs do RAG — recall semântico por projeto "api-catalog".
  //    Disponibiliza public-apis, BrasilAPI, mcp-brasil, Finnhub etc. para o
  //    orquestrador/agentes escolherem a fonte certa em vez de inventar URLs.
  try {
    const apis = await recall('api-catalog', prompt, 4);
    if (apis.length) {
      blocks.push(
        'CATÁLOGO DE APIs DISPONÍVEIS (RAG — use estas fontes ao criar apps/agentes; NÃO invente URLs):\n' +
        apis.map((a) => `• ${a.title}\n  ${a.content.slice(0, 400)}`).join('\n'),
      );
    }
  } catch { /* catálogo ainda não semeado — segue sem */ }

  // 3) Análise de mercado (switch) — pipeline pesado: web + notícias + Reddit +
  //    LLM anti-sicofância → dashboard HTML salvo p/ aba Previews. O resumo cru
  //    vai ao contexto do orquestrador; o relatório completo vai no resultado.
  let market: MarketReport | undefined;
  let marketError: string | undefined;
  if (switches.analiseMercado) {
    try {
      market = await runMarketAnalysis(prompt, { project: proj });
      blocks.push(
        'ANÁLISE DE MERCADO (crua, anti-sicofância) — dados coletados de web/notícias/Reddit:\n' +
        `Resumo: ${market.executiveSummary}\n` +
        `Veredito: ${market.verdict}\n` +
        `Fortes: ${market.strengths.join(' | ') || '—'}\n` +
        `Fracos: ${market.weaknesses.join(' | ') || '—'}\n` +
        `Concorrentes: ${market.competitors.map((c) => `${c.name} (${c.sharePercent}%)`).join(', ') || '—'}\n` +
        `Dores (Reddit): ${market.redditInsights.painPoints.join(' | ') || '—'}\n` +
        `Pedidos (Reddit): ${market.redditInsights.requestedFeatures.join(' | ') || '—'}\n` +
        `Dashboard salvo em: ${market.dashboardPath}`,
      );
    } catch (e) {
      marketError = e instanceof Error ? e.message : String(e);
      blocks.push(`(análise de mercado falhou: ${marketError}. Prossiga com o que tem.)`);
    }
  }

  // 3.5) Portas & Processos (switch) — injeta o mapa ao vivo das portas: o
  //      orquestrador NÃO pode reutilizar portas em uso e PODE emitir o
  //      diretivo [[PROCESSO:…]] para fechar/pausar serviços desnecessários.
  if (switches.portasProcessos) {
    try {
      blocks.push(buildPortManagementBlock(await getPortMapText()));
    } catch (e) {
      blocks.push(`(mapa de portas indisponível: ${String(e instanceof Error ? e.message : e)})`);
    }
  }

  const systemBase = [
    'Você é o HERMES ORCHESTRATOR — orquestrador técnico sênior, anti-cicofantia.',
    'Devil\'s Advocate: aponte riscos e trade-offs antes de recomendar. Seja direto, prático e acionável.',
    'Responda em pt-BR, em Markdown bem estruturado (planos, passos, blocos de código quando útil).',
    blocks.length ? `\n${blocks.join('\n\n')}` : '',
  ].join('\n');

  const model = await resolveModel('orchestrator');
  const virtualKey = await getVirtualKey('orchestrator');

  // Eventos REAIS p/ o painel "Show Agents" (aba Paperclip & Office): o CEO
  // Hermes fica WORKING do pedido até a resposta final.
  const runTaskId = `orch-${Date.now()}`;
  eventBus.publish('agent:task:started', {
    agentId: 'hermes-orchestrator',
    taskId: runTaskId,
    description: 'Processing orchestrator request',
  });

  let out: { content: string; model: string };
  try {
    out = await getGateway().complete({
      model,
      virtualKey,
      maxTokens: 3072,
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemBase },
        { role: 'user', content: prompt },
      ],
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    eventBus.publish('agent:task:failed', { agentId: 'hermes-orchestrator', taskId: runTaskId, error: errMsg });
    // Registra no histórico GLOBAL p/ o usuário ver o run (e o motivo) na aba Histórico.
    appendHistory({
      project: proj, prompt: prompt.slice(0, 200), model, latencyMs: Date.now() - started,
      ok: false, error: errMsg, reply: '',
    });
    throw e;
  }
  // Defesa extra: um content nulo/vazio NUNCA deve quebrar o salvamento.
  out.content = typeof out.content === 'string' ? out.content : '';
  if (!out.content.trim()) {
    out.content = `⚠️ O modelo **${out.model || model}** respondeu vazio (o provedor aceitou a chamada mas não retornou conteúdo). Reenvie o prompt ou troque o modelo em LLM Center.`;
  }

  auditLogger.log({
    actor: 'SUBAGENT',
    event: 'orchestrator:run',
    payload: { model, switches, promptChars: prompt.length, project: proj },
  });

  // 3.6) Gestão de processos — parseia diretivos [[PROCESSO:…]] emitidos pelo
  //      modelo e EXECUTA (fechar/pausar) com validação de PID no snapshot +
  //      proteção do núcleo. O resultado é anotado na própria resposta.
  let processActionProposals: RunResult['processActionProposals'];
  if (switches.portasProcessos) {
    const directives = parseProcessDirectives(out.content);
    if (directives.length) {
      processActionProposals = directives.map((directive) => ({
        ...directive,
        confirmationRequired: true,
      }));
      out.content = out.content.replace(/\[\[PROCESSO:[^\]]+\]\]/g, '').trimEnd();
      out.content += '\n\n---\n\n### ⚠️ Ações de processo sugeridas\nNenhum processo foi alterado. Revise e confirme cada ação abaixo.\n';
      for (const proposal of processActionProposals) {
        auditLogger.log({
          actor: 'ORCHESTRATOR',
          event: 'orchestrator:process_action:proposed',
          payload: { pid: proposal.pid, action: proposal.action, reason: proposal.reason },
        });
        out.content += `- PID ${proposal.pid} · ${proposal.action} — ${proposal.reason}\n`;
      }
    }
  }

  // 2) Persiste a memória do projeto: checkpoint do prompt + resposta curta.
  //    Garante que a PRÓXIMA sessão (com qualquer LLM) saiba o que aconteceu.
  if (proj) {
    try {
      await remember({
        project: proj,
        kind: 'checkpoint',
        title: prompt.slice(0, 120),
        content: `PROMPT: ${prompt.slice(0, 1500)}\n\nRESPOSTA (resumo): ${out.content.slice(0, 1500)}`,
        tags: ['orchestrator', model],
        metadata: { model, latencyMs: Date.now() - started },
      });
      await saveState(proj, { lastTask: prompt.slice(0, 300) });
      checkpointSaved = true;
    } catch (e) {
      console.warn('[orchestrator] falha ao salvar memória:', String(e));
    }
  }

  // 4) 📁 Grava na pasta do projeto (F:\Projetos2026\DevMaster\<proj>):
  //    prompt original + resposta + saída de cada capacidade com switch ON.
  //    Falha de IO nunca derruba o run — vira warn no log.
  let saved: RunResult['saved'];
  if (proj) {
    try {
      saved = saveRunArtifacts({
        project: proj,
        prompt,
        reply: out.content,
        model: out.model || model,
        latencyMs: Date.now() - started,
        switches,
        research: (research || researchFailed)
          ? {
              query: research?.query,
              searchProvider: research?.searchProvider ?? undefined,
              synthesis: researchSynthesis,
              sources: research?.sources,
              failed: researchFailed,
            }
          : undefined,
        market: market
          ? {
              dashboardPath: market.dashboardPath,
              executiveSummary: market.executiveSummary,
              verdict: market.verdict,
              strengths: market.strengths,
              weaknesses: market.weaknesses,
              opportunities: market.opportunities,
              threats: market.threats,
              competitors: market.competitors.map((c) => ({ name: c.name, sharePercent: c.sharePercent })),
              reddit: {
                painPoints: market.redditInsights?.painPoints,
                requestedFeatures: market.redditInsights?.requestedFeatures,
              },
              sources: market.sources,
            }
          : (marketError ? { failed: marketError } : undefined),
      });
      auditLogger.log({
        actor: 'SYSTEM',
        event: 'orchestrator:project_saved',
        payload: { project: proj, folder: saved.folder, files: saved.files.length },
      });
    } catch (e) {
      console.warn('[orchestrator] falha ao salvar pasta do projeto:', String(e));
    }
  }

  // Eventos p/ o painel "Show Agents" + registro no histórico GLOBAL (aba Histórico).
  eventBus.publish('agent:task:completed', {
    agentId: 'hermes-orchestrator',
    taskId: runTaskId,
    durationMs: Date.now() - started,
  });
  appendHistory({
    project: proj,
    prompt: prompt.slice(0, 200),
    model: out.model || model,
    latencyMs: Date.now() - started,
    ok: true,
    reply: out.content.slice(0, 400),
    codeMapUrl: codeMap?.url,
    savedFiles: saved?.files,
  });

  return {
    reply: out.content,
    model: out.model || model,
    switches,
    research,
    project: proj,
    memory: { continuityInjected, checkpointSaved },
    docs: { context7Fetched: docsFetched },
    market: market
      ? { dashboardPath: market.dashboardPath, competitors: market.competitors.length, verdict: market.verdict }
      : (marketError ? { error: marketError } : undefined),
    saved,
    processActionProposals,
    codeMap,
    latencyMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const MAX_BODY = 512 * 1024;

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('JSON inválido'); }
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export async function handleOrchestratorRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (!pathname.startsWith('/api/orchestrator/')) return false;
  const method = req.method ?? 'GET';

  try {
    // req.url chega COM query string (ex.: project-file?project=x&file=y).
    const url = new URL(pathname, 'http://localhost');
    const path = url.pathname;

    if (path === '/api/orchestrator/config' && method === 'GET') {
      send(res, 200, loadSwitches());
      return true;
    }

    if (path === '/api/orchestrator/config' && method === 'POST') {
      const b = await readBody(req);
      send(res, 200, saveSwitches(b as Partial<OrchestratorSwitches>));
      return true;
    }

    if (path === '/api/orchestrator/run' && method === 'POST') {
      const b = await readBody(req);
      const prompt = String(b.prompt ?? '').trim();
      if (!prompt) { send(res, 400, { error: 'prompt obrigatório' }); return true; }
      const result = await runOrchestrator(prompt, b.project ? String(b.project) : undefined);
      send(res, 200, result);
      return true;
    }

    if (path === '/api/orchestrator/coordinate' && method === 'POST') {
      const b = await readBody(req);
      const prompt = String(b.prompt ?? '').trim();
      if (!prompt) { send(res, 400, { error: 'prompt obrigatório' }); return true; }

      const orchestratorModel = await resolveModel('orchestrator');
      const orchestratorKey = await getVirtualKey('orchestrator');
      const planner = new Orchestrator(getGateway(), orchestratorKey, orchestratorModel);
      const plan = await planner.analyzeIdea(prompt);
      const needsSecurityScan = plan.modules.some((module) => /security|seguran|pentest/i.test(module.name));
      const securityReport: SecurityScanReport | undefined = needsSecurityScan
        ? new SecurityScanner().scanSecrets(process.cwd())
        : undefined;
      const results: PlanTaskResult[] = await planner.executePlan(plan, prompt, async (module, taskId) => {
        const moduleName = module.name.toLowerCase();
        const role: SubagentTask['agentRole'] =
          /pentest/.test(moduleName) ? 'PENTEST' :
          /security|seguran/.test(moduleName) ? 'SECURITY' :
          /qa|test|qualidade/.test(moduleName) ? 'QA' :
          /integrat/.test(moduleName) ? 'INTEGRATOR' : 'CODER';
        const target = role.toLowerCase();
        return {
          taskId,
          agentRole: role,
          assignedModel: await resolveModel(target),
          virtualKey: await getVirtualKey(target),
          instructions: role === 'SECURITY' || role === 'PENTEST'
            ? `Read-only secret scan report (not a penetration test) for ${process.cwd()}:\n${JSON.stringify(securityReport)}`
            : '',
        };
      });

      const synthesisResults = results.map(({ name, status, result, error }) => ({
        name,
        status,
        model: result?.model,
        content: result?.content.slice(0, 2500),
        error,
      }));
      const synthesis = await planner.dispatchSubagent({
        taskId: `plan-synthesis-${Date.now()}`,
        agentRole: 'ORCHESTRATOR',
        assignedModel: orchestratorModel,
        virtualKey: orchestratorKey,
        instructions: [
          `Original request:\n${prompt}`,
          `Plan:\n${JSON.stringify(plan)}`,
          `Delegated task results (bounded excerpts):\n${JSON.stringify(synthesisResults)}`,
          'Synthesize completed outputs, report failed or blocked tasks, identify conflicts and state clearly that no files or external systems were changed.',
        ].join('\n\n'),
      });

      send(res, 200, {
        plan,
        tasks: results,
        summary: synthesis.content,
        securityScan: securityReport
          ? { filesScanned: securityReport.filesScanned, passed: securityReport.passed, findings: securityReport.secretsFound.length }
          : undefined,
        executionMode: 'model_only',
        note: 'Subagents produced text deliverables only; no source files or external systems were modified.',
      });
      return true;
    }

    // 📁 Projetos em F:\Projetos2026\DevMaster\<proj> (aba Histórico).
    if (path === '/api/orchestrator/projects' && method === 'GET') {
      send(res, 200, { root: PROJECTS_ROOT, projects: listProjects() });
      return true;
    }

    // 🕘 Histórico GLOBAL de runs (aba Histórico) — inclui runs sem projeto.
    if (path === '/api/orchestrator/history' && method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? 30) || 30;
      send(res, 200, { runs: listHistory(limit) });
      return true;
    }

    if (path === '/api/orchestrator/project-file' && method === 'GET') {
      const proj = url.searchParams.get('project');
      const file = url.searchParams.get('file');
      if (!proj || !file) { send(res, 400, { error: 'project e file obrigatórios' }); return true; }
      try {
        send(res, 200, { project: proj, file, content: readProjectFile(proj, file) });
      } catch (e) {
        send(res, 400, { error: String(e instanceof Error ? e.message : e) });
      }
      return true;
    }

    send(res, 404, { error: 'rota orquestrador desconhecida', path });
    return true;
  } catch (e) {
    send(res, 500, { error: String(e instanceof Error ? e.message : e) });
    return true;
  }
}
