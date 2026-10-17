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
import { researchTask, type ResearchReport } from '../research/researcher.js';
import { continuityBlock, remember, saveState, normProject } from '../memory/project-memory.js';
import { auditLogger } from '../core/audit-logger.js';

const CONFIG_PATH = join(process.cwd(), 'data', 'orchestrator-config.json');

export interface OrchestratorSwitches {
  pesquisaAvancada: boolean;
  siteCrm: boolean;
  siteProfissional: boolean;
}

const DEFAULT_SWITCHES: OrchestratorSwitches = {
  pesquisaAvancada: false,
  siteCrm: false,
  siteProfissional: false,
};

export function loadSwitches(): OrchestratorSwitches {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<OrchestratorSwitches>;
      return { ...DEFAULT_SWITCHES, ...raw };
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
  latencyMs: number;
}

export async function runOrchestrator(prompt: string, project?: string): Promise<RunResult> {
  const started = Date.now();
  const switches = loadSwitches();
  const blocks: string[] = [];
  let research: RunResult['research'];
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

  // 1) Pesquisa avançada → coleta contexto real antes de responder
  if (switches.pesquisaAvancada) {
    try {
      const report = await researchTask(prompt, { maxResults: 3 });
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
      blocks.push(`${RESEARCH_BLOCK}\n\n(aviso: a pesquisa falhou — ${String(e)}. Prossiga com seu conhecimento e declare a limitação.)`);
    }
  }

  if (switches.siteCrm) blocks.push(SITE_CRM_BLOCK);
  if (switches.siteProfissional) blocks.push(SITE_PRO_BLOCK);

  const systemBase = [
    'Você é o HERMES ORCHESTRATOR — orquestrador técnico sênior, anti-cicofantia.',
    'Devil\'s Advocate: aponte riscos e trade-offs antes de recomendar. Seja direto, prático e acionável.',
    'Responda em pt-BR, em Markdown bem estruturado (planos, passos, blocos de código quando útil).',
    blocks.length ? `\n${blocks.join('\n\n')}` : '',
  ].join('\n');

  const model = await resolveModel('orchestrator');
  const virtualKey = await getVirtualKey('orchestrator');

  const out = await getGateway().complete({
    model,
    virtualKey,
    maxTokens: 3072,
    temperature: 0.4,
    messages: [
      { role: 'system', content: systemBase },
      { role: 'user', content: prompt },
    ],
  });

  auditLogger.log({
    actor: 'SUBAGENT',
    event: 'orchestrator:run',
    payload: { model, switches, promptChars: prompt.length, project: proj },
  });

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

  return {
    reply: out.content,
    model: out.model || model,
    switches,
    research,
    project: proj,
    memory: { continuityInjected, checkpointSaved },
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
    if (pathname === '/api/orchestrator/config' && method === 'GET') {
      send(res, 200, loadSwitches());
      return true;
    }

    if (pathname === '/api/orchestrator/config' && method === 'POST') {
      const b = await readBody(req);
      send(res, 200, saveSwitches(b as Partial<OrchestratorSwitches>));
      return true;
    }

    if (pathname === '/api/orchestrator/run' && method === 'POST') {
      const b = await readBody(req);
      const prompt = String(b.prompt ?? '').trim();
      if (!prompt) { send(res, 400, { error: 'prompt obrigatório' }); return true; }
      const result = await runOrchestrator(prompt, b.project ? String(b.project) : undefined);
      send(res, 200, result);
      return true;
    }

    send(res, 404, { error: 'rota orquestrador desconhecida', path: pathname });
    return true;
  } catch (e) {
    send(res, 500, { error: String(e instanceof Error ? e.message : e) });
    return true;
  }
}
