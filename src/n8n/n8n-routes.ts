/**
 * n8n-routes — API do Automação N8N (aba ⚡ Automação N8N).
 *
 * POST /api/n8n/connect            {url, apiKey}     → testa e guarda conexão (token só em memória)
 * GET  /api/n8n/status                                → {connected, url, varNames[]} (nunca a chave)
 * POST /api/n8n/disconnect                            → limpa conexão
 * GET  /api/n8n/workflows                             → lista via API oficial (precisa conectar)
 * GET  /api/n8n/executions?workflowId=                → execuções recentes
 * GET  /api/n8n/templates?search=&category=&limit=    → templates da página oficial (api.n8n.io)
 * GET  /api/n8n/template-categories                   → categorias oficiais de templates
 * POST /api/n8n/score             {workflow|workflowId} → Score de Saúde 0–100 (determinístico)
 * POST /api/n8n/design            {answers}           → diagrama + JSON do workflow + credenciais (NOMES)
 * POST /api/n8n/create            {workflow, activate?} → cria na instância via API + audit log
 * POST /api/n8n/guide             {phase, answers}    → passo a passo personalizado da fase (LLM)
 * POST /api/n8n/fix               {error, workflow?}  → diagnóstico + correção (LLM, auto-fix via API)
 * POST /api/n8n/computer-use      {goal, step?}       → ação visual (fallback p/ credenciais na UI)
 * GET  /api/n8n/computer-use/screenshot               → screenshot ao vivo
 * POST /api/n8n/chat              {message, history?} → conversa com o arquiteto N8N (com memória)
 *
 * Segurança: respostas citam apenas NOMES de variáveis (N8N_API_KEY, …);
 * todo texto passa por redact() do n8n-client antes de sair.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { getGateway, getVirtualKey } from '../gateway/gateway-singleton.js';
import { resolveModel } from '../llm/routing-store.js';
import { structuredJson } from '../optimizer/pipeline.js';
import { ComputerUseAgent } from '../computer-use/computer-agent.js';
import { continuityBlock, remember, normProject } from '../memory/project-memory.js';
import { auditLogger } from '../core/audit-logger.js';
import {
  n8nSystemPrompt, scoreWorkflow, N8N_CATEGORIES, WIZARD_PHASES,
  type N8nContext, type HealthScore,
} from './n8n-agent.js';
import {
  setConnection, clearConnection, connectionInfo, redact,
  testConnection, listWorkflows, getWorkflow, createWorkflow, setActive, listExecutions,
} from './n8n-client.js';
import { fetchTemplates, fetchCategories } from './n8n-templates.js';

// ─── HTTP helpers ────────────────────────────────────────────────────────────

const MAX_BODY = 1024 * 1024;

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

/** Limpa strings de saída: nunca deixa token/senha vazar. */
function safe(s: string, max = 4000): string {
  return redact(String(s ?? '')).slice(0, max);
}

function ctxFrom(answers: any = {}): N8nContext {
  return {
    ambiente: answers.ambiente ? String(answers.ambiente) : undefined,
    urlInstancia: connectionInfo().url ?? undefined,
    objetivo: answers.objetivo ? String(answers.objetivo) : undefined,
    categoria: answers.categoria && N8N_CATEGORIES[answers.categoria] ? String(answers.categoria) : undefined,
    gatilho: answers.gatilho ? String(answers.gatilho) : undefined,
    integracoes: String(answers.integracoes ?? '').split(',').map((s: string) => s.trim()).filter(Boolean),
    dadosSensiveis: answers.dadosSensiveis === 'sim' || answers.dadosSensiveis === true,
  };
}

// ─── Fase 2: Design via LLM ─────────────────────────────────────────────────

interface DesignStep { title: string; why: string; commands?: string[]; }
interface DesignResult {
  diagram: string;
  workflowName: string;
  steps: DesignStep[];
  workflow: any | null;
  credentials: string[];
  docs: string[];
  risks: string[];
  note?: string;
  model: string;
}

async function buildDesign(answers: any): Promise<DesignResult> {
  const ctx = ctxFrom(answers);
  const model = await resolveModel('n8n');
  const vk = await getVirtualKey('n8n');
  const tpl = answers.template ? `\nTEMPLATE DE BASE (oficial): ${String(answers.template).slice(0, 200)}` : '';
  const system = n8nSystemPrompt(ctx) + `
TAREFA EXTERNA AO FORMATO DE SAÍDA GLOBAL: IGNORE a seção "FORMATO DE SAÍDA"
(score/tabela/top5/plano) para ESTA chamada — aqui o formato é OUTRO:

FORMATO DO DESIGN (JSON estrito, devolva APENAS o JSON):
{"diagram":"fluxo textual com setas, ex.: [Webhook] → [Validar] → [IF score] → …",
 "workflowName":"[DOMÍNIO] Ação — Gatilho",
 "steps":[{"title":"Passo curto","why":"1 frase simples p/ leigo","commands":["comando opcional"]}],
 "workflow":{"name":"…","nodes":[{"name":"","type":"n8n-nodes-base.xxx","typeVersion":1,"parameters":{},"position":[0,0]}],
             "connections":{"Origem":{"main":[[{"type":"main","index":0,"node":"Destino"}]]}},"settings":{}},
 "credentials":["NOME_DA_CREDENCIAL"],   // APENAS NOMES, ex.: "SLACK_API_TOKEN" — NUNCA valores
 "docs":["https://docs.n8n.io/…"],
 "risks":["cuidado/limitação deste fluxo"]}
Regras:
- "workflow" deve ser importável no n8n (nodes com name/type/typeVersion/position e connections por nome).
  Se não tiver 100% de segurança nos parâmetros exatos de algum node, deixe "workflow":null e
  marque o node no diagrama com [VERIFICAR_DOCS] — NUNCA invente parâmetro.
- "credentials" lista SÓ os nomes; valores pertencem ao sistema de credentials do n8n.
- 4–8 steps; garanta validação no início, filtro de PII se houver dados sensíveis e
  tratamento de falha (Retry/Stop and Error) nos nodes de rede.`;

  const user = `Objetivo: ${ctx.objetivo ?? '(não informado)'}
Categoria: ${ctx.categoria ?? '—'} · Gatilho: ${ctx.gatilho ?? '—'} · Ambiente: ${ctx.ambiente ?? '—'}
Integrações: ${ctx.integracoes?.join(', ') || '—'} · Dados sensíveis: ${ctx.dadosSensiveis ? 'SIM (exige mascaramento de PII antes de APIs/IA)' : 'não'}${tpl}
Gere o design completo (diagrama + JSON + credenciais + riscos).`;

  let raw: any;
  try {
    // 8192 tokens: o workflow.json completo estourava 4096 e truncava o JSON.
    raw = await structuredJson<any>(model, vk, system, user, 8192);
  } catch (e1) {
    try {
      // Contingência: rodada sem o JSON completo (resposta mais curta).
      raw = await structuredJson<any>(model, vk,
        system + '\nIMPORTANTE NESTA RODADA: devolva "workflow": null — NÃO gere o JSON dos nodes; foque em diagrama, steps, credentials, docs e risks.',
        user + '\n(Rodada de contingência: sem o JSON completo de workflow.)', 4096);
    } catch (e2) {
      // Rede de segurança: plano determinístico (nunca 500 p/ o leigo).
      const err = String(e2 instanceof Error ? e2.message : e2).slice(0, 200);
      console.warn('[n8n] design com LLM indisponível → fallback determinístico:', err);
      return fallbackDesign(ctx, err);
    }
  }

  const workflow = raw?.workflow && Array.isArray(raw.workflow.nodes) && raw.workflow.nodes.length
    ? {
        name: safe(String(raw.workflow.name || ctx.objetivo || 'Workflow Hermes'), 120),
        nodes: raw.workflow.nodes.slice(0, 80).map((n: any, i: number) => ({
          name: safe(String(n?.name ?? `Node ${i + 1}`), 80),
          type: String(n?.type ?? 'n8n-nodes-base.noOp'),
          typeVersion: Number(n?.typeVersion ?? 1),
          parameters: n?.parameters && typeof n.parameters === 'object' ? n.parameters : {},
          position: Array.isArray(n?.position) && n.position.length === 2
            ? [Number(n.position[0]) || i * 180, Number(n.position[1]) || 200]
            : [i * 180, 200],
        })),
        connections: raw.workflow.connections && typeof raw.workflow.connections === 'object' ? raw.workflow.connections : {},
        settings: raw.workflow.settings && typeof raw.workflow.settings === 'object' ? raw.workflow.settings : {},
      }
    : null;

  const credentials = (Array.isArray(raw?.credentials) ? raw.credentials : [])
    .map((c: any) => safe(String(c), 60).trim())
    .filter((c: string) => c.length > 0 && c.length <= 60)
    .slice(0, 12);

  return {
    diagram: safe(String(raw?.diagram ?? ''), 3000) || '(o modelo não devolveu diagrama — tente de novo)',
    workflowName: safe(String(raw?.workflowName ?? '[N8N] Automação — Manual'), 120),
    steps: (Array.isArray(raw?.steps) ? raw.steps : []).slice(0, 8).map((s: any) => ({
      title: safe(String(s?.title ?? 'Passo'), 140),
      why: safe(String(s?.why ?? ''), 300),
      commands: Array.isArray(s?.commands) ? s.commands.slice(0, 4).map((c: any) => safe(String(c), 200)) : undefined,
    })),
    workflow,
    credentials,
    docs: (Array.isArray(raw?.docs) ? raw.docs : []).slice(0, 6)
      .map((d: any) => String(d)).filter((d: string) => /^https:\/\/docs\.n8n\.io\//.test(d)),
    risks: (Array.isArray(raw?.risks) ? raw.risks : []).slice(0, 6).map((r: any) => safe(String(r), 300)),
    note: workflow ? undefined : 'JSON do workflow não veio íntegro — o diagrama/plano estão completos; monte os nodes com apoio de [VERIFICAR_DOCS] ou refaça o design.',
    model,
  };
}

// ─── Fallback determinístico do design (LLM indisponível) ────────────────────

function fallbackDesign(ctx: N8nContext, err: string): DesignResult {
  const cat = ctx.categoria ? N8N_CATEGORIES[ctx.categoria] : null;
  const triggerLabel: Record<string, string> = {
    webhook: 'Webhook (endpoint público — autentique)', schedule: 'Schedule Trigger (confira o fuso)',
    manual: 'Manual Trigger', event: 'Webhook de evento', form: 'Webhook de formulário',
  };
  const trigger = triggerLabel[ctx.gatilho ?? ''] ?? 'Manual Trigger';
  const saida = ctx.integracoes?.[0] ?? 'Notificação';
  const diagram = [
    `[GATILHO: ${trigger}]`,
    `  → [Validar payload: campos obrigatórios]`,
    `  → [Processar dados${ctx.dadosSensiveis ? ' (mascarar PII antes de APIs/IA)' : ''}]`,
    `  → [${saida}: ação principal]`,
    `  → [Log externo: registrar execução (timestamp + status)]`,
  ].join('\n');

  return {
    diagram,
    workflowName: `[${(ctx.categoria ?? 'N8N').slice(0, 10).toUpperCase()}] ${String(ctx.objetivo ?? 'Automação').slice(0, 60)} — ${ctx.gatilho ?? 'manual'}`,
    steps: [
      { title: 'Montar o workflow na UI', why: 'Crie os nodes na ordem do diagrama acima', commands: [] },
      { title: 'Criar as credenciais no n8n', why: 'Settings > Credentials — só aqui entram os valores', commands: [] },
      { title: 'Testar manualmente', why: 'Executar workflow com dados de exemplo antes de ativar', commands: [] },
      { title: 'Ativar e monitorar', why: 'Ative, configure Error Workflow e acompanhe as execuções', commands: [] },
    ],
    workflow: null,
    credentials: (ctx.integracoes ?? []).map((i) => i.trim()).filter(Boolean),
    docs: ['https://docs.n8n.io/integrations/', 'https://docs.n8n.io/credentials/'],
    risks: [
      ctx.dadosSensiveis ? 'Dados sensíveis: mascare PII antes de qualquer API externa/IA.' : null,
      ctx.gatilho === 'webhook' ? 'Webhook público: exija autenticação/token no endpoint.' : null,
      ctx.ambiente === 'self-hosted' ? 'Self-hosted: garanta N8N_ENCRYPTION_KEY estável e backup do banco.' : null,
      `LLM indisponível nesta rodada (${err}) — plano gerado deterministicamente; clique em Gerar design novamente em instantes para o design completo com workflow.json.`,
    ].filter(Boolean) as string[],
    note: 'Sem workflow.json nesta rodada — monte os nodes pelo diagrama ou gere de novo.',
    model: 'determinístico (LLM indisponível)',
  };
}

// ─── Fase 3/1: guia personalizado da fase + correção de falhas ──────────────

const PHASE_FALLBACK: Record<string, string> = {
  levantamento: 'Responda os campos acima com gatilho, integrações e dados sensíveis; confirme cada integração em docs.n8n.io/integrations/ antes de seguir.',
  design: 'Revise o diagrama ponta a ponta: validação no início, PII mascarada antes de IA/APIs externas, human-in-the-loop em ações de alto risco.',
  geracao: 'Crie as credenciais no sistema do n8n (Settings > Credentials) usando só os NOMES listados, importe o JSON, teste manualmente e só então ative.',
  monitoramento: 'Configure Error Workflow + heartbeat + log externo e retenção de execuções (Settings > Executions) antes de considerar pronto.',
};

async function phaseGuide(phaseId: string, answers: any): Promise<{ title: string; guidance: string; docRefs: string[] }> {
  const phase = WIZARD_PHASES.find((p) => p.id === phaseId) ?? WIZARD_PHASES[0];
  try {
    const model = await resolveModel('n8n');
    const vk = await getVirtualKey('n8n');
    const out = await structuredJson<any>(model, vk,
      n8nSystemPrompt(ctxFrom(answers)) + `
TAREFA EXTERNA AO FORMATO DE SAÍDA GLOBAL: para ESTA chamada, IGNORE a seção
"FORMATO DE SAÍDA" (score/tabela/top5/código/plano) acima. Devolva EXCLUSIVAMENTE:
{"guidance":"3-6 passos numerados e CONCRETOS para ESTA fase com ESTAS respostas, em PT-BR, citando [VERIFICAR_DOCS] onde houver dúvida","docRefs":["https://docs.n8n.io/…"]}
Nada além dessas duas chaves.`,
      `Fase atual: ${phase.title} — ${phase.subtitle}
Respostas do wizard: ${JSON.stringify(answers).slice(0, 1500)}
Dê o passo a passo desta fase.`, 4096);
    if (!out?.guidance || String(out.guidance).length < 40) throw new Error('guidance vazio');
    return {
      title: phase.title,
      guidance: safe(String(out.guidance), 3000),
      docRefs: (Array.isArray(out.docRefs) ? out.docRefs : []).slice(0, 5)
        .map((d: any) => String(d)).filter((d: string) => d.startsWith('https://docs.n8n.io/')),
    };
  } catch (e) {
    console.warn('[n8n] guide: LLM indisponível → fallback da fase:', String(e instanceof Error ? e.message : e).slice(0, 160));
    return { title: phase.title, guidance: PHASE_FALLBACK[phase.id] ?? phase.subtitle, docRefs: ['https://docs.n8n.io/'] };
  }
}

// Fallback do "Corrigir falha": heurística local SEM LLM (nunca 500).
function fixFallback(error: string): any {
  const heur: { re: RegExp; diagnosis: string; severity: string; instructions: string[] }[] = [
    { re: /429|rate.?limit|too many requests/i,
      diagnosis: 'Rate limit da API externa (HTTP 429).',
      severity: 'MÉDIO',
      instructions: ['Node que falhou → Settings → Retry on Fail (Max Tries 3, Wait 2000ms)', 'Insira um node Wait de 1–5s antes da chamada limitada', 'Confira o limite de taxa na documentação da API usada'] },
    { re: /credential|401|403|unauthorized|invalid.?api.?key|forbidden/i,
      diagnosis: 'Credencial ausente, inválida ou expirada.',
      severity: 'ALTO',
      instructions: ['Settings > Credentials → localize a credencial citada no erro', 'Re-insira o token/senha e use "Test credential"', 'Self-hosted: verifique se N8N_ENCRYPTION_KEY não mudou (mudança invalida todas as credenciais)'] },
    { re: /ECONNREFUSED|ENOTFOUND|getaddrinfo|ETIMEDOUT|timeout|timed out|network/i,
      diagnosis: 'Falha de rede/timeout ao alcançar o serviço de destino.',
      severity: 'ALTO',
      instructions: ['Confirme a URL/porta do destino (DNS resolve dentro do container?)', 'Node → Settings → Retry on Fail + Wait entre tentativas', 'Self-hosted: teste a conectividade a partir do container'] },
    { re: /not trigger|não dispara|not triggering|schedule/i,
      diagnosis: 'Workflow não está disparando (inativo, fuso ou URL de teste x produção).',
      severity: 'ALTO',
      instructions: ['Confirme o toggle ATIVO na lista de workflows', 'Webhook: use a URL de PRODUÇÃO (a de teste é diferente)', 'Schedule: confira o fuso em Settings > General'] },
    { re: /memory|ENOMEM|heap|queue|worker/i,
      diagnosis: 'Recurso da instância no limite (fila/memória).',
      severity: 'CRÍTICO',
      instructions: ['Self-hosted: df -h e free -m (disco/RAM)', 'Queue-mode: verifique workers (docker ps | grep n8n-worker)', 'Reduza volume ou escale workers'] },
  ];
  const hit = heur.find((h) => h.re.test(error));
  if (hit) {
    return { diagnosis: hit.diagnosis, severity: hit.severity, autoFix: null, applied: false,
      instructions: hit.instructions, docs: ['https://docs.n8n.io/integrations/', 'https://docs.n8n.io/hosting/'],
      model: 'heurística local (LLM indisponível)' };
  }
  return { diagnosis: 'Não foi possível confirmar a causa automaticamente.', severity: 'MÉDIO', autoFix: null, applied: false,
    instructions: ['Abra Executions → clique na execução falhada → identifique o node exato', 'Copie a mensagem de erro completa e tente "Corrigir falha" de novo', 'Consulte community.n8n.io com essa mensagem'],
    docs: ['https://docs.n8n.io/'], model: 'heurística local (LLM indisponível)' };
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function handleN8nRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();
  try {
    // Lê/drena o corpo UMA vez (POST): rotas que respondem cedo não deixam bytes
    // pendurados na conexão keep-alive (evita dessincronização de requisições).
    const postBody = method === 'POST' ? await readBody(req) : {};
    // Rota sem query (?limit=…) — a query continua acessível via req.url.
    pathname = pathname.split('?')[0] || pathname;
    // 1) Conexão (token fica em memória; resposta só cita o NOME da variável)
    if (pathname === '/api/n8n/connect' && method === 'POST') {
      const b = postBody;
      const url = String(b.url ?? '').trim();
      const apiKey = String(b.apiKey ?? '').trim();
      if (!url || !apiKey) {
        send(res, 400, { error: 'url e apiKey obrigatórios (no Hermes chamamos a chave de N8N_API_KEY — ela nunca é exibida nas respostas)' });
        return true;
      }
      setConnection(url, apiKey);
      const test = await testConnection();
      if (test.ok) {
        auditLogger.log({ actor: 'USER', event: 'n8n:connected', payload: { url: test.url, version: test.version ?? '—' } });
        send(res, 200, { ok: true, url: test.url, version: test.version, workflows: test.workflows });
      } else {
        clearConnection();
        send(res, 200, { ok: false, url: test.url, error: safe(test.error ?? 'falha na conexão', 400) });
      }
      return true;
    }

    if (pathname === '/api/n8n/status' && method === 'GET') {
      send(res, 200, { ...connectionInfo(), phases: WIZARD_PHASES.map((p) => ({ id: p.id, icon: p.icon, title: p.title })) });
      return true;
    }

    if (pathname === '/api/n8n/disconnect' && method === 'POST') {
      clearConnection();
      send(res, 200, { ok: true });
      return true;
    }

    // 2) Dados da instância
    if (pathname === '/api/n8n/workflows' && method === 'GET') {
      if (!connectionInfo().connected) { send(res, 200, { connected: false, workflows: [] }); return true; }
      const workflows = await listWorkflows(50);
      send(res, 200, {
        connected: true,
        workflows: workflows.slice(0, 50).map((w: any) => ({
          id: w?.id, name: w?.name, active: w?.active, updatedAt: w?.updatedAt,
          nodes: Array.isArray(w?.nodes) ? w.nodes.length : undefined,
        })),
      });
      return true;
    }

    if (pathname === '/api/n8n/executions' && method === 'GET') {
      if (!connectionInfo().connected) { send(res, 200, { connected: false, executions: [] }); return true; }
      const q = new URL(req.url || '', 'http://local').searchParams;
      const executions = await listExecutions(q.get('workflowId') ?? undefined, 20);
      send(res, 200, {
        connected: true,
        executions: executions.map((e: any) => ({
          id: e?.id, status: e?.status, startedAt: e?.startedAt, finishedAt: e?.finishedAt,
          workflowId: e?.workflowId,
        })),
      });
      return true;
    }

    // 3) Templates oficiais (fonte da página https://n8n.io/workflows/)
    if (pathname === '/api/n8n/templates' && method === 'GET') {
      const q = new URL(req.url || '', 'http://local').searchParams;
      const r = await fetchTemplates({
        search: q.get('search') ?? undefined,
        category: q.get('category') ?? undefined,
        limit: q.get('limit') ? Number(q.get('limit')) : 12,
      });
      send(res, 200, r);
      return true;
    }

    if (pathname === '/api/n8n/template-categories' && method === 'GET') {
      send(res, 200, await fetchCategories());
      return true;
    }

    // 4) Score de saúde (determinístico — sem LLM, resposta imediata)
    if (pathname === '/api/n8n/score' && method === 'POST') {
      const b = postBody;
      let wf = b.workflow;
      if (!wf && b.workflowId && connectionInfo().connected) wf = await getWorkflow(String(b.workflowId));
      if (!wf || typeof wf !== 'object') { send(res, 400, { error: 'workflow (JSON) ou workflowId (conectado) obrigatório' }); return true; }
      const score: HealthScore = scoreWorkflow(wf);
      auditLogger.log({ actor: 'SUBAGENT', event: 'n8n:scored', payload: { total: score.total, findings: score.findings.length } });
      send(res, 200, { ...score, name: wf?.name ? safe(String(wf.name), 120) : undefined });
      return true;
    }

    // 5) Design (Fase 2) — diagrama + JSON + credenciais
    if (pathname === '/api/n8n/design' && method === 'POST') {
      const b = postBody;
      const answers = b.answers && typeof b.answers === 'object' ? b.answers : {};
      if (!answers.objetivo || !String(answers.objetivo).trim()) {
        send(res, 400, { error: 'objetivo obrigatório (preencha a Fase 1 — Levantamento)' });
        return true;
      }
      const design = await buildDesign(answers);
      send(res, 200, design);
      return true;
    }

    // 6) Criação na instância (auditado; ativação explícita)
    if (pathname === '/api/n8n/create' && method === 'POST') {
      const b = postBody;
      if (!connectionInfo().connected) {
        send(res, 409, { error: 'instância não conectada — informe URL + N8N_API_KEY na aba Conexão' });
        return true;
      }
      const wf = b.workflow;
      if (!wf || !Array.isArray(wf.nodes) || !wf.nodes.length) {
        send(res, 400, { error: 'workflow com nodes obrigatório (rode a Fase 2 — Design antes)' });
        return true;
      }
      if (b.confirm !== true) {
        send(res, 200, { needsConfirmation: true, name: safe(String(wf.name ?? 'workflow'), 120), nodes: wf.nodes.length });
        return true;
      }
      const created = await createWorkflow(wf);
      let activated = false;
      if (b.activate === true) {
        try { await setActive(String(created.id), true); activated = true; } catch { /* ativação é opcional */ }
      }
      auditLogger.log({ actor: 'USER', event: 'n8n:workflow_created', payload: { id: created?.id, name: String(wf.name ?? '').slice(0, 120), activated } });
      send(res, 200, {
        ok: true, id: created?.id, name: safe(String(created?.name ?? wf.name), 120), activated,
        url: connectionInfo().url ? `${connectionInfo().url}/workflow/${created?.id}` : null,
      });
      return true;
    }

    // 7) Guia personalizado da fase (Fase 1/3/4)
    if (pathname === '/api/n8n/guide' && method === 'POST') {
      const b = postBody;
      const phase = String(b.phase ?? 'levantamento');
      const answers = b.answers && typeof b.answers === 'object' ? b.answers : {};
      send(res, 200, await phaseGuide(phase, answers));
      return true;
    }

    // 8) Correção de falhas (diagnóstico + instruções)
    if (pathname === '/api/n8n/fix' && method === 'POST') {
      const b = postBody;
      const error = String(b.error ?? '').trim();
      if (!error) { send(res, 400, { error: 'error obrigatório (cole a mensagem de falha do n8n)' }); return true; }
      const model = await resolveModel('n8n');
      const vk = await getVirtualKey('n8n');
      const wfJson = b.workflow ? `\nWORKFLOW (resumo): ${safe(JSON.stringify(b.workflow), 4000)}` : '';
      let out: any;
      try {
        out = await structuredJson<any>(model, vk,
          n8nSystemPrompt() + `
TAREFA EXTERNA AO FORMATO DE SAÍDA GLOBAL: IGNORE a seção "FORMATO DE SAÍDA"
(score/tabela/top5/plano) para ESTA chamada e devolva EXCLUSIVAMENTE:
{"diagnosis":"causa provável em 1-2 frases","severity":"CRÍTICO|ALTO|MÉDIO|BAIXO",
"autoFix":null|{"retryOnFail":true,"maxTries":3,"waitBetweenTries":1000,"node":"nome do node"},
"instructions":["passo 1…","passo 2…"],"docs":["https://docs.n8n.io/…"]}`,
          `FALHA REPORTADA:\n${safe(error, 1500)}${wfJson}\nDiagnostique e dê a correção (auto-fix via API quando aplicável; senão instrução passo a passo na UI do n8n).`, 2048);
      } catch (e) {
        console.warn('[n8n] fix: LLM indisponível → heurística local:', String(e instanceof Error ? e.message : e).slice(0, 160));
        out = fixFallback(error);
      }

      // Auto-fix: aplicar retryOnFail no node apontado (via API) quando pedido e conectado.
      let applied = false;
      if (out?.autoFix?.node && connectionInfo().connected && b.applyFix === true && b.workflowId) {
        try {
          const current = await getWorkflow(String(b.workflowId));
          const target = (current.nodes ?? []).find((n: any) => n.name === out.autoFix.node);
          if (target) {
            target.retryOnFail = true;
            target.maxTries = Number(out.autoFix.maxTries ?? 3);
            target.waitBetweenTries = Number(out.autoFix.waitBetweenTries ?? 1000);
            const { updateWorkflow } = await import('./n8n-client.js');
            await updateWorkflow(String(b.workflowId), current);
            applied = true;
            auditLogger.log({ actor: 'SUBAGENT', event: 'n8n:auto_fixed', payload: { workflowId: b.workflowId, node: target.name } });
          }
        } catch { /* segue com instrução manual */ }
      }

      send(res, 200, {
        diagnosis: safe(String(out?.diagnosis ?? ''), 600),
        severity: String(out?.severity ?? 'MÉDIO'),
        autoFix: out?.autoFix ?? null,
        applied,
        instructions: (Array.isArray(out?.instructions) ? out.instructions : []).slice(0, 8)
          .map((i: any) => safe(String(i), 400)),
        docs: (Array.isArray(out?.docs) ? out.docs : []).slice(0, 5)
          .map((d: any) => String(d)).filter((d: string) => d.startsWith('https://docs.n8n.io/')),
        model,
      });
      return true;
    }

    // 9) Computer use (fallback p/ credenciais/dashboard quando a API não dá conta)
    if (pathname === '/api/n8n/computer-use' && method === 'POST') {
      const b = postBody;
      const goal = String(b.goal ?? '').trim();
      if (!goal) { send(res, 400, { error: 'goal obrigatório' }); return true; }
      if (b.confirm !== true) {
        send(res, 409, { error: 'confirmação explícita obrigatória para ação visual', confirmationRequired: true });
        return true;
      }
      const agent = new ComputerUseAgent(getGateway(), await getVirtualKey('n8n-cu'));
      const result = await agent.executeStep(goal, Number(b.step ?? 1), true);
      let screenshotPost: string | null = null;
      try { screenshotPost = agent.getScreenshot(); } catch { /* sem tela */ }
      send(res, 200, { result, screenshotPost });
      return true;
    }

    if (pathname === '/api/n8n/computer-use/screenshot' && method === 'GET') {
      const agent = new ComputerUseAgent(getGateway(), await getVirtualKey('n8n-cu'));
      const base64 = agent.getScreenshot();
      const size = agent.getScreenSize();
      send(res, 200, { base64, width: size.width, height: size.height });
      return true;
    }

    // 10) Chat com o arquiteto N8N (com memória por projeto)
    if (pathname === '/api/n8n/chat' && method === 'POST') {
      const b = postBody;
      const message = String(b.message ?? '').trim();
      if (!message) { send(res, 400, { error: 'message obrigatório' }); return true; }

      const proj = `n8n:${normProject(String(b.project ?? connectionInfo().url ?? 'geral'))}`;
      let context = '';
      try { context = (await continuityBlock(proj, message)) + '\n'; } catch { /* memória off */ }
      if (Array.isArray(b.history) && b.history.length) {
        context += 'HISTÓRICO RECENTE:\n' + b.history.slice(-8)
          .map((h: any) => `${h?.role === 'user' ? 'Usuário' : 'Arquiteto N8N'}: ${safe(String(h?.content ?? ''), 400)}`).join('\n') + '\n';
      }
      if (b.answers && typeof b.answers === 'object') {
        context += `CONTEXTO DO WIZARD: ${safe(JSON.stringify(b.answers), 1200)}\n`;
      }

      const model = await resolveModel('n8n');
      const vk = await getVirtualKey('n8n');
      const out = await getGateway().complete({
        model, virtualKey: vk, maxTokens: 2048, temperature: 0.3,
        messages: [
          { role: 'system', content: n8nSystemPrompt(ctxFrom(b.answers ?? {})) },
          { role: 'user', content: context + `\nMENSAGEM DO USUÁRIO:\n${safe(message, 2000)}` },
        ],
      });

      if (b.saveToMemory !== false) {
        void remember({
          project: proj, kind: 'context',
          title: `n8n chat (${new Date().toISOString().slice(0, 16)})`,
          content: `Usuário: ${message.slice(0, 500)}\nArquiteto: ${out.content.slice(0, 800)}`,
          tags: ['n8n', 'chat'], metadata: {},
        }).catch(() => {});
      }
      send(res, 200, { reply: safe(out.content, 8000), model: out.model || model });
      return true;
    }

    send(res, 404, { error: 'rota n8n desconhecida', path: pathname });
    return true;
  } catch (e) {
    send(res, 500, { error: safe(String(e instanceof Error ? e.message : e), 600) });
    return true;
  }
}
