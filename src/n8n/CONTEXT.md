# Automação N8N — DeployBot-style (aba ⚡ Automação N8N)

Agente **N8N Automation Architect & SRE** embutido na sidebar do Hermes. Guia o
leigo do objetivo vago até o workflow **no ar e monitorado**, com três modos de
operação: **API (token)**, **computer use** e **MCP-like via docs oficiais**.

## Arquitetura

| Arquivo | Papel |
|---|---|
| `n8n-agent.ts` | Prompt mestre v1.0 adaptado (regras inegociáveis, orquestração, formato de saída), `N8N_CATEGORIES` (8 categorias × prioridades/nodes), `WIZARD_PHASES` (4 fases), `scoreWorkflow()` **determinístico** (0–100 em 4 áreas de 25) |
| `n8n-client.ts` | REST da API pública n8n (`X-N8N-API-KEY`): healthz, workflows CRUD, activate/deactivate, executions. **Token só em memória**; toda mensagem de saída passa por `redact()` |
| `n8n-templates.ts` | Templates da **página oficial** `n8n.io/workflows` — a página é Nuxt client-side; descobrimos no `runtimeConfig` dela a fonte real: `api.n8n.io/api/templates/{search,categories}`. Cache 10 min + fallback curado |
| `n8n-routes.ts` | 15 rotas `/api/n8n/*` (dispatch no servidor **4020**) |
| `CONTEXT.md` | Este arquivo |

## Rotas

```
POST /api/n8n/connect {url, apiKey}       → testa (healthz + /workflows) e guarda; resposta cita só NOMES
GET  /api/n8n/status                      → {connected, url, varNames:['N8N_API_URL','N8N_API_KEY'], phases}
POST /api/n8n/disconnect
GET  /api/n8n/workflows                   → lista (precisa conectar)
GET  /api/n8n/executions?workflowId=
GET  /api/n8n/templates?search=&limit=    → api.n8n.io (fonte oficial) | fallback curado
GET  /api/n8n/template-categories
POST /api/n8n/score {workflow|workflowId} → Score de Saúde determinístico + tabela de achados
POST /api/n8n/design {answers, template?} → diagrama + workflow.json + credenciais (NOMES) + docs + riscos
POST /api/n8n/create {workflow, confirm, activate?} → 2 etapas (needsConfirmation → cria), audit log
POST /api/n8n/guide {phase, answers}      → passo a passo personalizado da fase (LLM; fallback determinístico)
POST /api/n8n/fix {error, workflowId?, applyFix?} → diagnóstico + auto-fix (retryOnFail via API) + instruções
POST /api/n8n/computer-use + /screenshot  → ComputerUseAgent (visão free → pago barato)
POST /api/n8n/chat {message, history, answers} → Arquiteto N8N com memória por projeto (n8n:<url>)
```

## Interface (leigo)

1. **Conexão** — URL + `N8N_API_KEY` (campo password; some da tela após conectar;
   pill de status). Erros dizem o que conferir (Settings > API).
2. **Wizard guiado 4 fases** com stepper, checklist por fase e botão
   **✨ Passo a passo com IA** (personaliza a fase com as respostas):
   - Fase 1 Levantamento (obrigatórios: objetivo, categoria, gatilho, integrações)
   - Fase 2 Design → **Gerar design** (LLM) → card com diagrama, passos,
     `workflow.json` (📋 copiar), credenciais **só nomes**, docs, riscos
   - Fase 3 Geração → **Criar na instância** (conferência → confirmação → id/link)
   - Fase 4 Monitoramento → checklist + **📥 execuções** + ✅ Concluir
3. **Templates oficiais** — busca ao vivo; clicar usa como base do design.
4. **Score de saúde** — cola JSON (ou carrega da instância): barras
   Resiliência/Segurança/Observabilidade/Eficiência + tabela de achados.
5. **Computer use** — para credenciais/dashboards na UI do n8n (fallback da API).
6. **Chat Arquiteto N8N** — mesmo padrão do DeployBot (memória por projeto).

## Segurança

- Respostas/logs **nunca** contêm a chave: `redact()` + `connectionInfo()` só
  expõe `varNames`. Valores pertencem ao sistema de credentials do n8n.
- Criação de workflow em **2 etapas** (`needsConfirmation` → `confirm:true`) e
  ativação **não automática** (master prompt: testar antes de ativar).
- Toda ação de criação/auto-fix é auditada (`n8n:workflow_created`, `n8n:auto_fixed`).

## Referências (regra de ouro do prompt mestre)

`docs.n8n.io` · `/integrations/` · `/hosting/` · `/api/` · `blog.n8n.io` ·
`community.n8n.io` · `github.com/n8n-io/n8n` — parâmetro incerto sai como
`[VERIFICAR_DOCS]`, nunca inventado.
