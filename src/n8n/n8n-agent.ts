/**
 * n8n-agent — cérebro do Automação N8N (aba ⚡ Automação N8N).
 *
 * Prompt mestre "N8N Automation Architect & SRE" v1.0 adaptado ao Hermes +
 * conhecimento estruturado (categorias, fases do wizard, score de saúde).
 *
 * Segurança: NUNCA expõe credenciais — só o NOME das variáveis
 * (N8N_API_KEY, N8N_ENCRYPTION_KEY, …). Nenhum parâmetro de node é assumido:
 * em dúvida o prompt marca [VERIFICAR_DOCS] e cita docs.n8n.io.
 */

// ─── Contexto do projeto de automação ────────────────────────────────────────

export interface N8nContext {
  ambiente?: string;          // self-hosted | n8n.cloud | ambos
  versao?: string;
  urlInstancia?: string;
  objetivo?: string;
  categoria?: string;         // ver N8N_CATEGORIES
  gatilho?: string;           // webhook | schedule | manual | event | form
  integracoes?: string[];
  dadosSensiveis?: boolean;
}

export interface WizardQuestion {
  id: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'textarea' | 'select';
  options?: string[];
  required?: boolean;
  why?: string;
}

export interface WizardPhase {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  questions: WizardQuestion[];
  checklist: string[];
}

// ─── Módulos por categoria (prioridades de automação + nodes-chave) ──────────

export interface N8nCategory {
  label: string;
  priorities: string[];
  nodes: string[];
}

export const N8N_CATEGORIES: Record<string, N8nCategory> = {
  SAAS: {
    label: 'SaaS / Webapp',
    priorities: [
      'Onboarding de usuário novo (trial → boas-vindas)',
      'Trial vencendo → upgrade (email + Slack)',
      'Monitoramento de uso / limite atingido',
      'Alerta de churn (inatividade > N dias)',
      'Stripe Webhook → CRM + Email + Slack',
    ],
    nodes: ['Webhook', 'HTTP Request', 'Code', 'Switch', 'Merge', 'Slack', 'Email Send'],
  },
  ECOMMERCE: {
    label: 'E-commerce',
    priorities: [
      'Abandono de carrinho (lembrete em 1h/24h)',
      'Pós-compra: agradecimento + pauta de avaliação',
      'Estoque baixo → alerta de reposição',
      'Avaliação negativa → notificação de suporte',
      'Sincronização de catálogo/preços entre sistemas',
    ],
    nodes: ['Webhook (Shopify/WooCommerce)', 'HTTP Request', 'Switch', 'PostgreSQL/MySQL', 'Email Send'],
  },
  NEGOCIO_LOCAL: {
    label: 'Negócio local',
    priorities: [
      'Resposta a avaliações do Google',
      'Agendamento automático + lembrete',
      'Follow-up pós-atendimento (WhatsApp/email)',
      'Relatório semanal de leads',
    ],
    nodes: ['Google Calendar', 'Gmail', 'Webhook', 'Airtable/Notion', 'WhatsApp Business'],
  },
  PUBLISHER: {
    label: 'Publisher / Blog',
    priorities: [
      'Publicação cross-platform (RSS → redes)',
      'Análise de performance de conteúdo',
      'Sugestão de atualização de posts antigos',
      'Monitoramento de links quebrados',
    ],
    nodes: ['RSS Feed Read', 'HTTP Request', 'WordPress', 'Google Analytics', 'OpenAI'],
  },
  AGENCIA: {
    label: 'Agência / Serviços',
    priorities: [
      'Qualificação de leads (form → score → CRM)',
      'Geração de proposta automática',
      'Relatório mensal por cliente',
      'Onboarding de novo cliente',
    ],
    nodes: ['Typeform/Webhook', 'HubSpot', 'Google Docs', 'Slack', 'Email Send'],
  },
  MARKETPLACE: {
    label: 'Marketplace / Portal',
    priorities: [
      'Anúncio novo → moderação automática',
      'Anúncio expirado → notificação de renovação',
      'Disputa/reclamação → fila de atendimento',
    ],
    nodes: ['Webhook', 'Switch', 'HTTP Request', 'PostgreSQL', 'Email Send'],
  },
  INSTITUCIONAL: {
    label: 'Institucional',
    priorities: [
      'Formulário de contato → CRM + notificação',
      'Newsletter automática de novidades',
      'Monitoramento de menções da marca',
    ],
    nodes: ['Webhook', 'Email Send', 'Slack', 'HTTP Request'],
  },
  INTERNO: {
    label: 'Interno / Ops',
    priorities: [
      'Monitoramento de servidores + alertas',
      'Backup automático verificado',
      'Relatórios de BI agendados',
      'Sincronização entre sistemas internos',
      'Heartbeat pingando endpoint a cada 5 min',
    ],
    nodes: ['HTTP Request', 'PostgreSQL', 'Slack', 'Code', 'Schedule Trigger'],
  },
};

// ─── Fases do wizard guiado (Processo de Criação do prompt mestre) ───────────

export const WIZARD_PHASES: WizardPhase[] = [
  {
    id: 'levantamento',
    icon: '📝',
    title: 'Fase 1 — Levantamento',
    subtitle: 'Antes de criar qualquer node: gatilho, integrações, dados sensíveis, frequência e falhas.',
    questions: [
      { id: 'objetivo', label: 'Objetivo da automação (o que ela precisa fazer?)', type: 'textarea',
        placeholder: 'ex.: Enviar relatório diário de vendas via Slack às 8h', required: true,
        why: 'Um objetivo claro evita escopo elástico e nodes desnecessários.' },
      { id: 'categoria', label: 'Categoria do projeto', type: 'select',
        options: Object.keys(N8N_CATEGORIES), required: true,
        why: 'Define o módulo de prioridades e nodes-chave aplicáveis.' },
      { id: 'gatilho', label: 'Gatilho principal', type: 'select', required: true,
        options: ['webhook', 'schedule', 'manual', 'event', 'form'],
        why: 'O gatilho determina o primeiro node e os riscos de segurança (webhook = endpoint público).' },
      { id: 'integracoes', label: 'Integrações necessárias (separadas por vírgula)',
        placeholder: 'ex.: Slack, PostgreSQL, Gmail, OpenAI', required: true,
        why: 'Confirme a disponibilidade na referência de nodes: docs.n8n.io/integrations/' },
      { id: 'ambiente', label: 'Ambiente', type: 'select', required: true,
        options: ['self-hosted', 'n8n.cloud', 'ambos'] },
      { id: 'dadosSensiveis', label: 'Dados sensíveis? (PII, financeiro, LGPD)', type: 'select',
        options: ['não', 'sim'], why: 'Se sim, exige filtro/mascaramento de PII antes de qualquer API externa.' },
    ],
    checklist: [
      'Gatilho definido (webhook/schedule/manual/event/form)',
      'Integrações confirmadas na referência oficial de nodes',
      'Ponto de filtro de PII identificado (se houver dados sensíveis)',
      'Frequência de execução verificada contra rate limits das APIs',
      'Risco de ação duplicada avaliado (idempotência necessária?)',
      'Comportamento esperado em caso de falha definido',
    ],
  },
  {
    id: 'design',
    icon: '🗺️',
    title: 'Fase 2 — Design (antes de criar na UI)',
    subtitle: 'Diagrama textual + JSON do workflow + lista de credenciais (só NOMES).',
    questions: [],
    checklist: [
      'Diagrama textual revisado (fluxo faz sentido ponta a ponta)',
      'Validação de payload no início do fluxo',
      'Filtro de PII posicionado ANTES de APIs externas/IA',
      'Human-in-the-loop em ações de alto risco (Send and Wait)',
      'JSON exportado como workflow.json (versionado em Git)',
    ],
  },
  {
    id: 'geracao',
    icon: '⚙️',
    title: 'Fase 3 — Geração e credenciais',
    subtitle: 'Criar na instância via API (token), preencher credenciais e testar SEM ativar.',
    questions: [
      { id: 'credenciais', label: 'Credenciais que você vai preencher no n8n (só liste os NOMES)',
        placeholder: 'ex.: N8N_API_KEY, SLACK_API_TOKEN, OPENAI_API_KEY', type: 'textarea',
        why: 'NUNCA cole valores aqui — valores ficam só no sistema de credentials do n8n (Settings > Credentials).' },
    ],
    checklist: [
      'Workflow criado na instância (API ou import do JSON)',
      'Credenciais criadas no sistema do n8n (nada hardcoded)',
      'Teste manual executado com dados de exemplo',
      'Erros de node resolvidos (Retry on Fail onde fizer sentido)',
      'Ativação APENAS após validação',
    ],
  },
  {
    id: 'monitoramento',
    icon: '📡',
    title: 'Fase 4 — Monitoramento (obrigatório)',
    subtitle: 'Error Workflow, heartbeat, logs externos e retenção de execuções.',
    questions: [
      { id: 'alerta', label: 'Para onde vão os alertas de falha?', type: 'select',
        options: ['Slack', 'Email', 'Telegram', 'PagerDuty/Better Stack'] },
    ],
    checklist: [
      'Error Workflow global configurado nas configurações do workflow',
      'Workflow de erro central: Error Trigger → parse → classificar severidade → alerta',
      'Heartbeat: ping externo a cada N min (silêncio = alerta de down)',
      'Log externo persistente (PostgreSQL/planilha — logs nativos são purgados)',
      'Nomenclatura padronizada: [DOMÍNIO] Ação — Gatilho',
      'Retenção de execuções configurada (Settings > Executions)',
    ],
  },
];

// ─── Prompt mestre (system) ──────────────────────────────────────────────────

export function n8nSystemPrompt(ctx?: N8nContext): string {
  const cat = ctx?.categoria && N8N_CATEGORIES[ctx.categoria]
    ? N8N_CATEGORIES[ctx.categoria]
    : null;
  return `Você é um N8N Automation Architect & SRE sênior no Hermes (PT-BR).
Projeta, constrói, monitora e auto-recupera automações n8n (self-hosted e n8n.cloud),
SEMPRE fundamentado na documentação oficial (https://docs.n8n.io).

REGRAS INEGOCIÁVEIS:
1. Single responsibility por (sub-)workflow — uma função de domínio por agente/workflow.
2. Orquestrador central em sistemas com >1 agente; workflows como código (JSON versionado).
3. SEM credenciais hardcoded — exclusivamente o sistema de credentials do n8n.
   NUNCA escreva valores de token/senha: cite apenas o NOME da variável
   (ex.: N8N_API_KEY, N8N_ENCRYPTION_KEY, SLACK_API_TOKEN).
4. Idempotência em todo workflow que cria/modifica dados (evitar duplicação em reexecução).
5. PII filtrada/mascarada ANTES de chamar APIs externas ou LLMs.
6. Human-in-the-loop (Send and Wait) para transações financeiras, envios em massa, deleções.
7. Error Workflow global + heartbeat + log externo em todo workflow de produção.
8. Nomenclatura: [DOMÍNIO] Ação — Gatilho. Ex.: [CRM] Criar lead — Webhook Typeform.
9. IA: modelo leve p/ classificação, avançado só p/ raciocínio complexo; SEMPRE output
   schema fixado no AI Agent node (JSON Schema) para não quebrar nodes downstream.
10. Nunca invente comportamento de node/parâmetro: em dúvida marque [VERIFICAR_DOCS]
    e cite a seção exata (docs.n8n.io/integrations/, /api/, /hosting/).

ORQUESTRAÇÃO (escolha e justifique): roteamento por branch (Switch+classificador) ·
orquestrador/gatekeeper (AI Agent + ferramentas) · pipeline sequencial determinístico ·
time de agentes paralelo (Split/Merge) · híbrido (recomendado: regras fixas + IA p/ ambiguidade).

FORMATO DE SAÍDA (sempre):
1. Score de Saúde 0–100 (Resiliência/Segurança/Observabilidade/Eficiência — 0–25 cada)
2. Tabela de achados: Achado | Evidência | Impacto | Correção | Severidade (🔴/🟡/🟢) | Confiança
3. Top 5 ações priorizadas (impacto ÷ esforço)
4. Código pronto: JSON do workflow, env vars (NOMES), config de Error Workflow
5. Plano de implantação: Semana 1 (crítico) · Semana 2–3 (observabilidade/segurança) · Semana 4+ (otimizações)

REFERÊNCIAS (consulte nesta ordem): docs.n8n.io · docs.n8n.io/integrations/ ·
docs.n8n.io/hosting/ · docs.n8n.io/api/ · blog.n8n.io · community.n8n.io · github.com/n8n-io/n8n
Regra de ouro: nenhum parâmetro de node, comportamento de API ou variável de ambiente
assumido sem verificação na documentação oficial.

CONTEXTO DO PROJETO:
${ctx ? JSON.stringify({
  ambiente: ctx.ambiente ?? '—', versao: ctx.versao ?? '—', urlInstancia: ctx.urlInstancia ?? '—',
  objetivo: ctx.objetivo ?? '—', categoria: ctx.categoria ?? '—', gatilho: ctx.gatilho ?? '—',
  integracoes: ctx.integracoes ?? [], dadosSensiveis: ctx.dadosSensiveis ?? false,
}, null, 1) : '(preencher com as respostas do wizard)'}
${cat ? `\nMÓDULO ${ctx?.categoria}: prioridades → ${cat.priorities.join(' | ')}\nnodes-chave → ${cat.nodes.join(', ')}` : ''}`;
}

// ─── Score de saúde DETERMINÍSTICO (sem LLM) ─────────────────────────────────

export interface HealthFinding {
  area: string;
  criterion: string;
  evidence: string;
  impact: 'Alto' | 'Médio' | 'Baixo';
  fix: string;
  severity: '🔴 Crítico' | '🟡 Alerta' | '🟢 OK';
}

export interface HealthScore {
  total: number;
  areas: { resiliencia: number; seguranca: number; observabilidade: number; eficiencia: number };
  max: { resiliencia: number; seguranca: number; observabilidade: number; eficiencia: number };
  findings: HealthFinding[];
}

const SECRET_KEY_RE = /(api[_-]?key|apikey|token|secret|pass(word|wd)?|credential|bearer|auth)/i;
const SECRET_VAL_RE = /^[A-Za-z0-9_\-\/+=.!$]{16,}$/;

function wfString(wf: any): string {
  try { return JSON.stringify(wf); } catch { return ''; }
}

/** Score 0–100 determinístico sobre o JSON do workflow + tabela de achados. */
export function scoreWorkflow(wf: any): HealthScore {
  const nodes: any[] = Array.isArray(wf?.nodes) ? wf.nodes : [];
  const all = wfString(wf);
  const settings = wf?.settings ?? {};
  const name = String(wf?.name ?? '');
  const findings: HealthFinding[] = [];
  const add = (f: HealthFinding) => { findings.push(f); };

  // ── Resiliência (0–25)
  let res = 0;
  if (settings.errorWorkflow) { res += 8;
    add({ area: 'Resiliência', criterion: 'Error Workflow global', evidence: `settings.errorWorkflow = ${settings.errorWorkflow}`, impact: 'Alto', fix: '—', severity: '🟢 OK' });
  } else {
    add({ area: 'Resiliência', criterion: 'Error Workflow global', evidence: 'settings.errorWorkflow ausente', impact: 'Alto', fix: 'Settings do workflow → Error Workflow → aponte para o workflow central de erros', severity: '🔴 Crítico' });
  }
  const retried = nodes.filter((n) => n?.retryOnFail === true || n?.maxTries > 1);
  if (retried.length) { res += 7;
    add({ area: 'Resiliência', criterion: 'Retry on Fail', evidence: `${retried.length} node(s) com retry (${retried.slice(0, 3).map((n) => n.name).join(', ')})`, impact: 'Médio', fix: '—', severity: '🟢 OK' });
  } else {
    add({ area: 'Resiliência', criterion: 'Retry on Fail', evidence: 'nenhum node com retryOnFail', impact: 'Médio', fix: 'Nodes de chamada de rede: Settings → Retry on Fail (3x, 1–2s)', severity: '🟡 Alerta' });
  }
  const hasValidation = nodes.slice(0, 3).some((n) => /(^|\.)IF$|Switch|Code|Set|Filter/.test(String(n?.type ?? '')));
  if (hasValidation) { res += 5;
    add({ area: 'Resiliência', criterion: 'Validação de payload no início', evidence: 'node de filtro/Código nos 3 primeiros', impact: 'Médio', fix: '—', severity: '🟢 OK' });
  } else {
    add({ area: 'Resiliência', criterion: 'Validação de payload no início', evidence: 'nenhum filtro/Código nos 3 primeiros nodes', impact: 'Médio', fix: 'Valide campos obrigatórios logo após o gatilho (IF/Code) e use Stop and Error em checkpoints', severity: '🟡 Alerta' });
  }
  const hasOnError = nodes.some((n) => n?.onError === 'continueErrorOutput' || n?.onError === 'stopErrorOutput');
  if (hasOnError) { res += 5;
    add({ area: 'Resiliência', criterion: 'Tratamento de erro por node', evidence: 'onError configurado em node(s)', impact: 'Médio', fix: '—', severity: '🟢 OK' });
  } else {
    add({ area: 'Resiliência', criterion: 'Tratamento de erro por node', evidence: 'nenhum node com onError/Stop and Error', impact: 'Médio', fix: 'Checkpoint crítico: node → Settings → On Error → Stop and Error', severity: '🟡 Alerta' });
  }

  // ── Segurança (0–25)
  let seg = 0;
  const hardcodes: string[] = [];
  for (const n of nodes) {
    const params = n?.parameters ? JSON.stringify(n.parameters) : '';
    for (const [k, v] of Object.entries(n?.parameters ?? {})) {
      if (SECRET_KEY_RE.test(k) && typeof v === 'string' && SECRET_VAL_RE.test(v) && !v.startsWith('{{')) {
        hardcodes.push(`${n.name}.${k}`);
      }
    }
    if (/sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-/.test(params)) hardcodes.push(`${n.name} (valor com aparência de token)`);
  }
  if (!hardcodes.length) { seg += 10;
    add({ area: 'Segurança', criterion: 'Sem credenciais hardcoded', evidence: 'nenhum token/senha literal nos parâmetros', impact: 'Alto', fix: '—', severity: '🟢 OK' });
  } else {
    add({ area: 'Segurança', criterion: 'Sem credenciais hardcoded', evidence: hardcodes.slice(0, 4).join(', '), impact: 'Alto', fix: 'Mova para Settings > Credentials do n8n e referencie pelo sistema de credenciais', severity: '🔴 Crítico' });
  }
  const usesCreds = nodes.some((n) => n?.credentials && Object.keys(n.credentials).length);
  if (usesCreds) { seg += 8;
    add({ area: 'Segurança', criterion: 'Sistema de credentials do n8n', evidence: `${nodes.filter((n) => n?.credentials).length} node(s) usando credentials`, impact: 'Alto', fix: '—', severity: '🟢 OK' });
  } else {
    const needsCred = nodes.some((n) => /(slack|gmail|gmail|hubspot|openai|http|postgres|mysql|stripe|shopify)/i.test(String(n?.type ?? '')));
    add({ area: 'Segurança', criterion: 'Sistema de credentials do n8n', evidence: needsCred ? 'nodes de integração sem campo credentials' : 'sem nodes que exigem credencial', impact: needsCred ? 'Alto' : 'Baixo', fix: needsCred ? 'Crie a credencial em Settings > Credentials e associe ao node' : '—', severity: needsCred ? '🔴 Crítico' : '🟢 OK' });
    if (!needsCred) seg += 8;
  }
  const piiFiltered = /mask|redact|anonym|replace\(.*\d{3}|\*{3}|remover.*(cpf|phone|tel)|filtrar pii/i.test(all);
  const hasAi = nodes.some((n) => /openai|langchain|agent/i.test(String(n?.type ?? '')));
  if (piiFiltered || !hasAi) { seg += 7;
    add({ area: 'Segurança', criterion: 'PII filtrada antes de APIs externas/IA', evidence: piiFiltered ? 'mascaramento/anonimização encontrado' : 'sem node de IA — sem risco de vazamento p/ modelo', impact: 'Alto', fix: '—', severity: '🟢 OK' });
  } else {
    add({ area: 'Segurança', criterion: 'PII filtrada antes de APIs externas/IA', evidence: 'IA presente sem mascaramento detectável', impact: 'Alto', fix: 'Insira um Code node antes da IA: mascare telefone/email/CPF', severity: '🔴 Crítico' });
  }

  // ── Observabilidade (0–25)
  let obs = 0;
  const nameOk = /^\[[^\]]+\]\s.+\s[—–-]\s.+/.test(name);
  if (nameOk) { obs += 9;
    add({ area: 'Observabilidade', criterion: 'Nomenclatura [DOMÍNIO] Ação — Gatilho', evidence: name, impact: 'Baixo', fix: '—', severity: '🟢 OK' });
  } else {
    add({ area: 'Observabilidade', criterion: 'Nomenclatura [DOMÍNIO] Ação — Gatilho', evidence: name ? `nome atual: "${name}"` : 'sem nome', impact: 'Baixo', fix: 'Renomeie: ex. [CRM] Criar lead — Webhook Typeform', severity: '🟡 Alerta' });
  }
  const logsExternal = /insert into|log_|appendRow|googleSheets|airtable|create.*row/i.test(all);
  if (logsExternal) { obs += 8;
    add({ area: 'Observabilidade', criterion: 'Log externo persistente', evidence: 'escrita em banco/planilha detectada', impact: 'Médio', fix: '—', severity: '🟢 OK' });
  } else {
    add({ area: 'Observabilidade', criterion: 'Log externo persistente', evidence: 'nenhuma escrita de log externa (logs nativos são purgados)', impact: 'Médio', fix: 'Adicione gravação em PostgreSQL/planilha com timestamp + score/status', severity: '🟡 Alerta' });
  }
  const heartbeat = /heartbeat|uptime|better ?stack|uptimerobot/i.test(all) || /heartbeat/i.test(name);
  if (heartbeat || !!settings.errorWorkflow) { obs += 8;
    add({ area: 'Observabilidade', criterion: 'Heartbeat / auto-detecção de falha', evidence: heartbeat ? 'heartbeat/uptime presente' : 'coberto pelo Error Workflow', impact: 'Alto', fix: '—', severity: '🟢 OK' });
  } else {
    add({ area: 'Observabilidade', criterion: 'Heartbeat / auto-detecção de falha', evidence: 'sem heartbeat nem Error Workflow', impact: 'Alto', fix: 'Workflow de heartbeat pingando endpoint externo a cada 5 min (silêncio = alerta)', severity: '🔴 Crítico' });
  }

  // ── Eficiência (0–25)
  let efi = 0;
  const hasAiNode = nodes.some((n) => /openai|langchain|agent/i.test(String(n?.type ?? '')));
  const hasDeterministic = nodes.some((n) => /(^|\.)IF$|Switch|Merge/.test(String(n?.type ?? '')));
  const hasOutputSchema = /json.?schema|output.?schema|respondWith.*json|schema/i.test(all);
  if (hasAiNode && hasOutputSchema) { efi += 8;
    add({ area: 'Eficiência', criterion: 'IA com output schema fixado', evidence: 'schema de saída detectado no fluxo de IA', impact: 'Médio', fix: '—', severity: '🟢 OK' });
  } else if (hasAiNode) { add({ area: 'Eficiência', criterion: 'IA com output schema fixado', evidence: 'AI Agent/OpenAI sem JSON Schema de saída', impact: 'Médio', fix: 'Fixe o output schema no AI Agent node para não quebrar nodes downstream', severity: '🟡 Alerta' });
  } else if (hasDeterministic) { efi += 8;
    add({ area: 'Eficiência', criterion: 'Roteamento determinístico (IF/Switch)', evidence: 'regras de negócio em nodes determinísticos', impact: 'Médio', fix: '—', severity: '🟢 OK' });
  } else {
    add({ area: 'Eficiência', criterion: 'Roteamento determinístico (IF/Switch)', evidence: 'fluxo linear sem regras nem IA', impact: 'Baixo', fix: 'Adicione IF/Switch quando houver caminhos condicionais', severity: '🟡 Alerta' });
  }
  const idem = /idempot|dedup|j[aá] existe|already|duplicad|verificar se .*criad/i.test(all);
  if (idem) { efi += 7;
    add({ area: 'Eficiência', criterion: 'Idempotência', evidence: 'checagem de duplicidade detectada', impact: 'Alto', fix: '—', severity: '🟢 OK' });
  } else {
    add({ area: 'Eficiência', criterion: 'Idempotência', evidence: 'sem checagem de duplicidade', impact: 'Alto', fix: 'Antes de criar registros: IF/Code verificando se a ação já ocorreu', severity: '🟡 Alerta' });
  }
  const dupNames = nodes.length - new Set(nodes.map((n) => n?.name)).size;
  const namesOk = nodes.every((n) => n?.name);
  if (dupNames === 0 && namesOk) { efi += 5;
    add({ area: 'Eficiência', criterion: 'Sem redundância / nós nomeados', evidence: `${nodes.length} nodes, nomes únicos`, impact: 'Baixo', fix: '—', severity: '🟢 OK' });
  } else {
    add({ area: 'Eficiência', criterion: 'Sem redundância / nós nomeados', evidence: dupNames > 0 ? `${dupNames} nome(s) duplicado(s)` : 'node sem nome', impact: 'Baixo', fix: 'Renomeie nodes com nome descritivo da ação', severity: dupNames > 0 ? '🟡 Alerta' : '🟢 OK' });
    if (dupNames === 0) efi += 5;
  }
  const hasTrigger = nodes.some((n) => /trigger|webhook|cron|schedule/i.test(String(n?.type ?? '')) || n?.webhookId);
  if (hasTrigger) { efi += 5;
    add({ area: 'Eficiência', criterion: 'Gatilho explícito', evidence: 'trigger/webhook/schedule presente', impact: 'Alto', fix: '—', severity: '🟢 OK' });
  } else {
    add({ area: 'Eficiência', criterion: 'Gatilho explícito', evidence: 'nenhum trigger detectado', impact: 'Alto', fix: 'Adicione o gatilho correto (Webhook/Schedule/Manual)', severity: '🔴 Crítico' });
  }

  const cap = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const areas = {
    resiliencia: cap(res, 25), seguranca: cap(seg, 25),
    observabilidade: cap(obs, 25), eficiencia: cap(efi, 25),
  };
  // A pontuação vive nos acumuladores por área; os achados documentam o porquê.
  return {
    total: areas.resiliencia + areas.seguranca + areas.observabilidade + areas.eficiencia,
    areas,
    max: { resiliencia: 25, seguranca: 25, observabilidade: 25, eficiencia: 25 },
    findings,
  };
}
