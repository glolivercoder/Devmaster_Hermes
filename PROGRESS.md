# PROGRESS.md — Otimizador de Prompts (Hermes)

> **Adaptação honesta:** o template original assumia um app **Next.js greenfield**
> com Taskmaster/Drizzle+SQLite/promptfoo/Playwright. Este módulo foi **integrado ao
> Hermes** (Node/TS + UI vanilla na 4020), reaproveitando os serviços existentes:
> `researcher` (Tavily), `context7`, `memory` (pgvector), `gateway` (LLMs) e MarkItDown
> (PDFs). O Taskmaster não está instalado → tracking via `tasks/optimizer-tasks.md`
> (formato ai-dev-tasks) + este PROGRESS.md.

## Progresso

| Módulo | Peso | % | Status | Próxima tarefa |
|--------|------|---|--------|----------------|
| M0 Fundação (contracts, validação) | 5 | 100% | ✅ concluído | — |
| M1 Entrada (prompt + PDFs/URLs, validação) | 10 | 100% | ✅ concluído | rate-limit por IP |
| M2 Intent + Análise fria (rubrica 8 critérios) | 20 | 100% | ✅ concluído | testes de regressão |
| M3 Pesquisa (web + PDF + Context7 + citações) | 20 | 100% | ✅ concluído | cache de fontes (pg) |
| M4 Expansão + Otimização (diff + changelog) | 20 | 100% | ✅ concluído | diff word-level |
| M5 Botão + UI/UX (modal, abas, checklist, confronto) | 15 | 100% | ✅ concluído | streaming das etapas |
| M6 Qualidade + Deploy (e2e, obs.) | 10 | 40% | 🟡 parcial | testes Vitest/Playwright |

**Global: 89%**

## Decisões registradas
- **Sem Zod/diff**: projeto não tem essas libs → validação e diff em TS puro
  (`contracts.ts`), zero dependência nova. Mesmas garantias.
- **3 chamadas LLM** (não 5): INTENT+ANÁLISE combinadas, PESQUISA, EXPANSÃO+OTIMIZAÇÃO —
  reduz custo/latência mantendo serviços isolados lógicos.
- **Retry de JSON**: modelos grátis geram JSON malformado → helper `structuredJson`
  retrya até 3× com instrução de correção (padrão já usado no market-analysis).
- **Context7 é pré-requisito**: roda sempre no gather (regra anti-alucinação do Hermes).
- **Modelo**: `resolveModel('orchestrator')` (cheaper-opus) p/ JSON estruturado confiável.

## Arquivos
- `src/optimizer/contracts.ts` — tipos + validação de runtime + lineDiff
- `src/optimizer/pipeline.ts` — serviços isolados do pipeline + discussão interativa
- `src/optimizer/optimizer-routes.ts` — API `/api/optimizer/{optimize,discuss}`
- `src/ui/index.html` — botão ✨ Otimizar, modal, abas, checklist, confronto
- `docs/optimizer/ARCHITECTURE.md` — fluxo, contratos, ADRs
- `src/optimizer/CONTEXT.md` — contexto do módulo p/ sessões futuras de LLM

---

# 🚀 DEPLOY Agent System (DeployBot) — Outubro 2026

**Status: FUNCIONAL (E2E completo)** · Global: 100% do escopo pedido

## Escopo entregue
- **Aba sidebar 🚀 DEPLOY Agent** (`view-deploy`): scan → classificação →
  ranking 🥇🥈🥉 com score → guia passo-a-passo com checkboxes → painel
  Computer Use (screenshot ao vivo) → pós-deploy (verify + DEPLOY_INFO.md) →
  tabela de free tiers + chat DeployBot.
- **Classificação determinística** (8 categorias, sem LLM) com evidências.
- **Ranking**: SCORE = COMPAT×40 + CUSTO×30 + FACIL×20 + PERF×10 (0-100).
- **Free tiers**: 13 plataformas (Tier A/B/C) + 4 EXTINTOS nunca recomendados
  (Heroku, Fly.io, HF Spaces, PlanetScale) + refresh via Agente Pesquisador.
- **Command-runner seguro** (allowlist + confirmação): AUTO/CONFIRM/DENY.
- **Computer Use real exposto por rota** (antes só interno do Orchestrator).

## Bugs corrigidos pelo caminho
1. **Screenshot cego**: `ComputerUseAgent` capturava a tela mas o
   `GatewayClient.complete()` só aceitava `content: string` → anexava "Screenshot
   provided." sem imagem. Corrigido com suporte multimodal
   (`ContentPart[]` + `image_url`) — compute vision de verdade agora.
2. **Fallback de visão** (requisito do usuário): cadeia `openrouter-vision-free`
   → `cheaper-vision` (Gemini 3.8 Flash pago barato) → `cheaper-fast`. E2E:
   free falhou → cheaper-vision executou `mouse_move [960,540]` ✓.
3. **Classificação de servidor invisível**: projetos com `node:http` puro (sem
   express) eram classificados como SPA → heurística `createServer(|.listen(` no
   entrypoint + `.html` em dirs de UI. Hermes agora → FULLSTACK_MONO/PaaS ✓.

## E2E validado (porta 4020)
- analyze (Hermes → FULLSTACK_MONO, Postgres, Docker, PaaS) ✓
- recommend (6 opções; Supabase 87, Railway 86, Neon 86) ✓
- guide (gemini-flash; 5 passos, máx 2 computerUse, 4 comandos reais) ✓
- run-command: `git status` AUTO-exec, `rm -rf`/`sudo` DENY, `npm run build` CONFIRM ✓
- verify (HTTP 200, 121ms, SSL) ✓
- write-file: sem confirm → needsConfirmation; com confirm → grava; `.env` → 403 ✓
- chat (PT-BR, Render sleep explanation) ✓
- computer-use: fallback free→pago comprovado ✓
- refresh-tiers: Tavily + análise com degradação markdown se JSON falhar ✓

## Arquivos
- `src/deploy/deploy-agent.ts` - classificação + free tiers + score + prompt
- `src/deploy/command-runner.ts` - executor AUTO/CONFIRM/DENY
- `src/deploy/deploy-routes.ts` - API `/api/deploy/*` (12 rotas)
- `src/deploy/CONTEXT.md` - contexto do módulo
- `src/ui/index.html` - aba + 6 painéis + ~300 linhas de JS (dp*)
- `src/computer-use/computer-agent.ts` - multimodal + cadeia de fallback
- `src/gateway/gateway-client.ts` - ContentPart (texto + imagem)
- `src/llm/models.ts` - target `deploy` no smart-router
- `src/core/event-bus.ts` - eventos deploy:command:*

---

## ✨ SEO Optimizer (dentro do popup do Otimizador de Prompts) — Out/2026
**Status: FUNCIONAL (E2E + screenshot)**

- **Rota `GET /api/optimizer/seo-repo`**: busca GitHub ao vivo
  (`search/repositories?q=claude+seo+skill`, sort=stars) com **fallback curado**
  se API fora do ar/rate-limit. E2E: `AgriciDaniel/claude-seo` **19.133★ MIT
  (github-live)** + 4 alternativas (marketingskills, geo-seo-claude,
  open-seo-mcp-skills, marketing-skills).
- **Painel 🔍 SEO Optimizer** no modal (toggle mostrar/ocultar): card da melhor
  skill/repositório com destaques (`/seo plan <type>`, 26 sub-skills, 19 agentes),
  select de **7 categorias** (SAAS_WEBAPP, ECOMMERCE, NEGOCIO_LOCAL,
  PUBLISHER_BLOG, AGENCIA_SERVICOS, MARKETPLACE_PORTAL, INSTITUCIONAL),
  campos URL + **Diferenciais/propostas**, **módulo da categoria** (bullets) e
  **checklist de 8 itens** (técnico, intenção, on-page, E-E-A-T, schema, GEO/AEO,
  diferenciais, módulo).
- **`🔍 Gerar prompt SEO`**: monta o prompt mestre por categoria (PAPEL +
  metodologia do repo + CONTEXTO com URL/diferenciais + PROCESSO só com itens
  marcados + MÓDULO + FORMATO SAÍDA com tabela comparativa
  site-vs-concorrentes + plano 90 dias), preenche o textarea → ⚙️ Executar pipeline.
- E2E UI: categoria E-commerce → 8 checkboxes, prompt 3.241 chars com categoria,
  módulo, diferenciais, repo e saída "tabela comparativa" ✓ (screenshots).

---

## ⚡ Automação N8N (aba na sidebar) — Out/2026
**Status: FUNCIONAL (E2E backend + UI DOM-validado)**

- **Módulo `src/n8n/`**: `n8n-agent.ts` (prompt mestre N8N Automation Architect
  & SRE v1.0 adaptado + 8 categorias + 4 fases do wizard + **score de saúde
  determinístico 0–100** em 4 áreas de 25), `n8n-client.ts` (API REST oficial via
  `X-N8N-API-KEY` — token **só em memória**, `redact()` em toda saída),
  `n8n-templates.ts` (fonte real da página oficial n8n.io/workflows descoberta no
  runtimeConfig Nuxt: **api.n8n.io/api/templates/**; cache 10min + fallback),
  `n8n-routes.ts` (**15 rotas** `/api/n8n/*`, dispatch no servidor 4020),
  `CONTEXT.md`.
- **Rotas E2E**: status ✓ · templates **api-oficial 13.489** + busca ✓ ·
  categorias (31) ✓ · score 82/100 (bom) e 5/100 (ruim, hardcode 🔴 com evidência)
  ✓ · **design LLM gemini-flash com workflow.json completo (8 nodes, conexões,
  3 credenciais SÓ-NOMES, 6 docs, 4 riscos)** ✓ · guide LLM (2.686 chars, não
  fallback) ✓ · fix LLM (diagnóstico 429 + autoFix node + 4 instruções) ✓ ·
  chat LLM (1.859 chars) ✓ · guardas: create sem conexão → 409 · connect falho →
  `fetch failed` **sem vazar a chave** ✓ · PCJ `Connection: close`/curl OK.
- **Robustez**: corpo lido 1× no topo (anti-poisoning de keep-alive) · query
  string stripada do pathname · design com **8192 tokens** (4096 truncava o JSON)
  + rodada de contingência + **fallback determinístico** (nunca 500) ·
  guide/fix com fallback local (heurísticas 429/credencial/rede/gatilho/recurso).
- **UI `view-n8n`**: conexão (campo some após conectar; pill status) · **wizard 4
  fases** com stepper/checklists/validação obrigatória/✨ passo com IA · card de
  design (diagrama+passos+json+creds+docs+riscos+criar na instância em 2 etapas) ·
  templates (clique usa como base) · score (barras+achados) · computer use
  (free→pago) · chat. E2E DOM: fase1→4 ✓, design pela UI ✓, score 74/100 na UI ✓,
  template click ✓, guards ✓.
- Target `n8n` no ROUTE_TARGETS (default gemini-flash) · eventos audit
  `n8n:connected/created/auto_fixed/scored`.
