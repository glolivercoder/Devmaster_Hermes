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

## 🔌 OpenCode ↔ Hermes Control Center (fallback + MCPs) - Out/2026
**Status: FUNCIONAL (E2E)**

- **Provider `hermes` no OpenCode global** (`~/.config/opencode/opencode.json`
  + cópia em `%APPDATA%\opencode`, backup `.bak-20261017-231945`): aponta para
  o LiteLLM do Hermes (`localhost:4000/v1`, master key do `.env`) e expõe os
  **25 modelos do Control Center** (grátis + pagos Cheaper) como rede de
  segurança caso o OmniRoute caia. **E2E**: `hermes/gemini-flash-free` →
  `HERMES_FALLBACK_OK` em 2,7s.
- **4 MCPs do `mcp-registry.json` conectados ao OpenCode** via chave `mcp`:
  `context7` (docs anti-alucinação), `sequential-thinking`, `memory` e
  `filesystem` (raiz do projeto). `GET /mcp` no :4196 lista os 4 com tools.
- **Fix do seletor** (`src/opencode/opencode-routes.ts`): prioridade de ordenação
  `opencode-omniroute → hermes → resto` — antes, os 9k+ modelos builtin dos 235
  providers comiam o corte em 500 e só 5/25 modelos `hermes/*` apareciam.
- **Pendência conhecida (ação externa)**: o auto-fallback *interno* do OmniRoute
  está com o pool `auto/*` esgotado (só `kr/auto`/Kiro responde 200) — reativar
  exige conectar provedores free no **dashboard do próprio OmniRoute**.

## 📁 Orquestrador → pasta do projeto + OpenCode - Out/2026
**Status: FUNCIONAL (E2E backend 3 runs + UI DOM/integração)**

- **Campo 📁 Projeto na aba Orquestrador** (antes só "🧠 Memória"): nome do
  projeto cria automaticamente `F:\Projetos2026\DevMaster\<nome>` e alimenta a
  memória de continuidade (mesma chave `normProject`).
- **`src/orchestrator/project-store.ts`**: por run grava `prompt-original.md`
  (append com timestamp), `historico.jsonl` (índice por run) e
  `runs/<ts>/` com `resposta-orquestrador.md` + só os arquivos das capacidades
  com checkbox ON: `pesquisa-avancada.md` (síntese+fontes ou AVISO se falhou),
  `analise-mercado.md` (relatório cru + dashboard), `site-crm.md`,
  `site-profissional.md`. Falha de IO nunca derruba o run (só warn).
- **2 rotas novas**: `GET /api/orchestrator/projects` (lista pastas+arquivos) e
  `GET /api/orchestrator/project-file?project&file` (leitura com guarda de
  path traversal + allowlist de extensão — 400 nos 3 testes de ataque).
- **▶ Enviar para OpenCode** (botão após cada resposta): integração direta —
  cria sessão `Hermes <projeto>` e envia prompt original + análise do
  orquestrador. **Cadeia de fallback**: OmniRoute (`kr/auto`) → **Hermes
  Control Center** (`hermes/gemini-flash-free` via LiteLLM) → **cópia para a
  área de transferência** (`📋 Copiar prompt` manual também existe).
- **Aba Histórico**: novo card "📁 Projetos do Orquestrador" lista as pastas
  com badges por tipo (📝 prompt / 💬 resposta / 🔎 pesquisa / 📊 mercado /
  🏢 site-crm / 🎨 site-pro / 🗒️ índice) + visualizador de arquivo inline;
  carrega junto do `loadHistorico()`.
- **E2E**: RUN A sem switches (prompt+resposta) ✓ · RUN B siteCrm ON
  (`site-crm.md`) ✓ · RUN C pesquisa+mercado ON reais (Tavily 3 fontes +
  dashboard 5 concorrentes, 104s) ✓ · list/read/traversal ✓ · UI: campo+run
  (36s, "Salvo em …\ui-demo-projeto") ✓ · clique → sessão OpenCode `kind-garden`
  (4.091 chars via OmniRoute) → aba OpenCode ✓ (1ª tentativa com Kiro instável
  caiu no fallback de cópia — comportamento previsto) ✓ · Histórico renderizou
  2 projetos/12 arquivos + visualizador ✓. `tsc --noEmit` EXIT=0.

## 🕵️ Agente de Versionamento de Projetos — Out/2026
**Status: FUNCIONAL (E2E completo backend + UI + monitor + gate de segredos)**

- **`src/gitea/project-version-agent.ts`**: monitora as pastas em
  `F:\Projetos2026\DevMaster\<proj>` e a cada save point faz **commit local +
  push SIMULTÂNEO** (`Promise.all`) para dois remotes:
  - **Gitea local (guarda TUDO)**: cria o repo se faltar e empurra `main`
    (limpa) + **`hermes-full`** — branch montada com **índice temporário**
    (`GIT_INDEX_FILE`/`commit-tree`, sem tocar na working tree) que force-adda
    `.env`/keys/tokens ignorados → save point completo sem derrubar o `main`.
  - **GitHub remoto (NUNCA segredos)**: `main:main` explícito; `hermes-full`
    jamais sai. Proteção em 2 camadas: **`.gitignore gerenciado`** (bloco
    `>>> HERMES-SEGREDOS <<<`: .env, *.pem/*.key, tokens, credentials, sqlite…)
    + **scan de segredos** (sk-, ghp_/github_pat_, xox, AKIA, AIza, PEM,
    Bearer, atribuições api_key=…) que **BLOQUEIA o push** se achar segredo em
    arquivo rastreado — relatório só com arquivo+linha+tipo, **valor nunca
    exibido** (`redact()` também limpa tokens de qualquer saída/log/audit).
  - Tokens entram via `git -c http.extraHeader` (nunca gravados na URL do
    remote). `execFileSync` sem shell (sem bugs de quoting no Windows).
  - **Monitor** (`enabled`/`intervalSec` em `data/version-agent-config.json`,
    default desligado/60s): tick com trava anti-sobreposição, skip quando não
    há mudanças, e projeto **novo sem repo conta como mudança** (fix de bug
    detectado no E2E). Config viva — trocar intervalo religa o timer.
- **5 rotas** (`/api/version/*` nos dois servidores): `status` (config+monitor+
  remotes+projetos+log), `config` (POST), `run` ({project?, message?} — save
  point agora), `github/repo` (cria repo privado), `log`. Audit:
  `version:savepoint` / `version:blocked:secrets` / `version:error` /
  `version:config` / `version:github:repo`.
- **UI (aba Versionamento & Backup)**: card "🕵️ Agente de Versionamento de
  Projetos" com toggle do monitor, intervalo, ▶ Rodar agora, badges de
  status (🐙 GitHub login · 🏠 Gitea base/owner · ⏱ monitor · 🔒 repos
  privados), cartão por projeto (status/l último commit) com **💾 Save point**
  e **➕ Repo GitHub**, e log em tempo real (novo no `loadVersionamento`).
- **E2E real**: status ✓ (login `glolivercoder` + Gitea v1.22.6
  `hermes-admin`) · save point 8,4s (init+.gitignore+commit `beb96d9` 9 files +
  gitea main&full + github) ✓ · **gate**: chave sk- falsa → GitHub BLOQUEADO
  (`config-teste.json:2`), gitea seguiu, **valor ausente da resposta** ✓ ·
  `.env` presente → fora do `main`, **dentro de `hermes-full`**, github não
  bloqueado ✓ · monitor 15s → projeto novo auto-commitado em 15,8s ✓ ·
  UI DOM: badges/cards/log/botões + Save point clicado ✓ · repos criados:
  `glolivercoder/{loja-artesanato-teste,ui-demo-projeto}` (privados) +
  `hermes-admin/{...}` no Gitea ✓ · `tsc --noEmit` EXIT=0.

## ??? ProcessAgent - MCPs categorizados + monitor de processos/CPU/RAM - Out/2026

**`src/guardian/process-agent.ts`** (novo):
- **Snapshot rico de processos** (WMI + netstat em PowerShell unico): PID, nome,
  CommandLine, portas em escuta (dedup v4/v6), **CPU%% e RAM MB**
  (Win32_PerfFormattedData), estado **suspenso** (todas as threads
  Wait/Suspended) e flag protegido. Filtro: node/python/tsx/npx/uvicorn...,
  donos de porta "server-like" (docker/gitea/redis/opencode...), ruido
  descartado (svchost/Code/wslrelay + zumbis 0MB sem porta).
- **Acoes**: pausar/retomar (NtSuspend/NtResumeProcess via P/Invoke ntdll - sem
  SIGSTOP no Windows), fechar (taskkill /F /T da arvore), reiniciar (re-spawna a
  CommandLine original detached). **PID do nucleo protegido** (Hermes + cadeia de
  pais) - E2E confirmou recusa no proprio PID do servidor.
- **Monitor em background** (default LIGADO, 20s; `data/process-agent-config.json`):
  eventos porta ABERTA/FECHADA + alertas CPU>80%%/RAM>1GB (cooldown 10min) em
  anel de 40 para a UI.
- **Mapa de portas ao Orquestrador**: switch "Portas & Processos" injeta bloco
  com o mapa vivo ("NUNCA reutilize estas portas") + autoriza o diretivo
  `[[PROCESSO:pid=N acao=fechar|pausar motivo="..."]]` (max 5; parser descarta
  acao invalida). O executor valida o PID no snapshot, recusa protegidos, anota
  " Gestao de processos" na resposta e devolve `processActions` no JSON.
- **MCPs por categoria**: Hermes (mcp-registry.json, 6) x OpenCode
  (opencode.json: context7/sequential-thinking/memory/filesystem, 4) x ativos no
  sistema (porta escutando ou stdio sob demanda).
- **5 rotas novas**: `GET /api/processes/detail`, `POST /api/processes/action`
  (fechar|pausar|retomar|reiniciar), `GET /api/mcps/categories`,
  `GET /api/process-agent/status`, `POST /api/process-agent/config`.
- **UI (aba MCPs & Portas reescrita)**: chips de categoria no header, cards de
  processo com **favicons de acao no canto superior esquerdo** (pausar/retomar/
  reiniciar/fechar) + **display CPU%%/RAM MB** (cores por limiar), badges
  PID/kind/portas/suspenso/protegido, auto-refresh de 12s, status do monitor.
- **E2E real**: snapshot ~50 processos/91 portas (~1,4s) V pausar -> susp=True
  no snapshot -> retomar -> False V reiniciar (novo PID assumiu a 4599) V
  fechar (arvore morta) V protegido recusado V monitor detectou restart do
  Hermes (porta 4020/4010 ABERTA) V config gravada V **run real do Orquestrador
  com switch ON: LLM emitiu o diretivo, executor fechou o PID 50544 da porta
  4599 em 30s, reply anotada** V UI DOM (50 cards, favicons, badges, 3
  categorias, checkbox) V audit `process:*` + `orchestrator:process_action` V
  `tsc --noEmit` EXIT=0.

## 🗺 Archify — Mapa de Código como memória do Orquestrador + Credencial OPCIONAL no chat - Out/2026

**1) Archify (arquitetura → código):**

**`.opencode/skills/archify/`** (novo, versionado): skill oficial
`tt-a1i/archify` v3.2.0 copiada do repo (17 MB) e registrada no projeto;
`node bin/archify.mjs doctor` → 100% ok (10 renderers, schemas, browser-check).

**`src/orchestrator/code-map.ts`** (novo):
- **Pipeline**: coleta a árvore do alvo (320 entradas, ignora
  node_modules/.git/dist/data/...) + até 6 arquivos-chave (package.json,
  README, docker-compose, entrypoints) → **LLM do gateway** gera o *candidate*
  JSON IR do Archify com o **contrato embutido no prompt** (schema 5,9 KB +
  exemplo 3,1 KB + authoring-defaults 12,6 KB lidos da skill) → **CLI Archify**
  `finalize architecture ... --quality showcase --json` (**até 2 rodadas de
  reparo** alimentadas pelos `diagnostics` do gate) → HTML autocontido em
  `data/code-maps/<slug>.html` + `<slug>.meta.json` com o **digest** (título,
  componentes, conexões, fronteiras, cards).
- **Robustez** (bugs reais encontrados no E2E): `extractJson` normaliza
  vírgulas finais/controles e grava o raw em workDir; **até 3 tentativas de
  geração** (o modelo às vezes trunca o JSON no meio); `candidate.json` é
  gravado ANTES de cada `finalize` (senão o CLI falha com ENOENT silencioso);
  workDir usa stamp só-dígitos (ponto final no nome quebrava caminho/cwd no
  Windows e mascarava o erro como `exit=1`); **slug/project só valem se a pasta
  `F:\Projetos2026\DevMaster\<proj>` existir** (evita digest de projeto
  fantasma apontando p/ outro código).

**`src/orchestrator/code-map-routes.ts`** (novo) + dispatch no `src/index.ts`:
`GET /api/code-map/status|list`, `POST /api/code-map/generate {project?,path?,hint?}`
e `GET /api/code-map/<arquivo>.html` (anti-traversal: basename + só .html).

**Orquestrador**: switch `mapaCodigo` (default LIGADO) em `data/orchestrator-config.json`;
no `runOrchestrator()` o digest é injetado logo após a memória de continuidade
(bloco "MAPA DE ARQUITETURA DO PROJETO (Archify ...)") e o resultado devolve
`codeMap {title, url}`.

**UI**: checkbox "🗺 Mapa de Código (Archify)" nas Capacidades; botão
"🗺 Mapa do Código" na linha do projeto (gera e mostra link + comp/conex/reparos/tempo);
card "🗺 Mapa de código ... abrir ↗ · digest injetado como contexto" na resposta do run.

**2) Pop-up de credencial do chat — AGORA OPCIONAL (não trava o contexto):**
- `sendPrompt()` **sempre dispara** `/api/orchestrator/run` — a detecção de
  "integrar/conectar/composio" só APPENDA um card paralelo (antes ela
  substituía o run por completo).
- Card com 3 botões: **🔑 Preencher credencial (opcional)**, **⏭ Pular**
  (fecha só este card) e **⏭⏭ Pular tudo nesta seção** (suprime em
  `localStorage hermes-cred-skip-orquestrador`).
- **Badge** "⏭ credenciais puladas · reativar" ao lado do campo do prompt
  (mostra o estado e reativa num clique).
- **Modal**: selo "opcional" no header, nota "ℹ️ credencial opcional" no corpo,
  botões "⏭ Pular credencial" e "⏭⏭ Pular tudo nesta seção", fecha com
  **Esc** e **clique no backdrop**.

**E2E real**: Archify `generate` 43s → 12 componentes / 11 conexões / 0 reparos
→ HTML 836.088 bytes servido (200, text/html) ✓; `/api/code-map/..%2F..%2F.env`
→ 404 (traversal bloqueado) ✓; run do Orquestrador devolveu `codeMap` e a UI
renderizou o card com link ✓ (resposta do LLM já citou os módulos/portas reais
injetados pelo digest) ✓. Credencial: run SEMPRE dispara (reply 4681 chars) ✓,
card com os 3 botões ✓, ⏭ fecha ✓, ⏭⏭ grava localStorage + badge ✓, card
não aparece mais na seção ✓, reativar limpa ✓, modal nota/Esc/backdrop/skip ✓,
**console 0 erros** ✓, `tsc --noEmit` EXIT=0 ✓.

## 🕘 Show Agents + fix do run "sumido" (resposta vazia) - Out/2026

**Diagnóstico do problema do usuário** ("enviei prompt no orquestrador e não
criou projeto nem foi pro histórico"): **não era OmniRoute nem fallback** — o
provedor devolveu HTTP 200 com `content: null`. O `GatewayClient.complete()`
aceitava isso sem validar, então: resposta vazia na UI (parecia "que não
funcionou") e o salvamento quebrava com `null.slice`/`null.length` (nada ia
pra pasta do projeto nem pra memória). Agravante: runs **sem** o campo 📁
Projeto não deixavam rastro nenhum em lugar algum.

**Correções:**
- **`src/gateway/gateway-client.ts`**: valida `choices[0].message.content` —
  resposta vazia vira **1 retry automático** (e falha no benchmark p/ o
  smart-router aprender) e, se persistir, **erro claro** ("LiteLLM devolveu
  RESPOSTA VAZIA após 2 tentativas (model=...)") em vez de reply em branco.
- **`orchestrator-routes.ts`**: defesa extra (`content` nunca nulo no
  salvamento) + **histórico GLOBAL** `data/orchestrator-history.jsonl` (anel de
  200) gravado em TODO run — inclusive os que falharam, com o motivo.
  Rota `GET /api/orchestrator/history`.
- **UI (aba Histórico)**: card **"🕘 Runs recentes do Orquestrador"** — ts,
  badge OK/FALHOU, modelo, latência, projeto (ou "sem projeto"), prompt,
  pré-visualização da resposta, link do 🗺 mapa e motivos de falha.

**Show Agents (aba 🏢 Paperclip & Office):**
- **`src/paperclip/agent-feed.ts`** (novo): consome o **event bus real** e
  expõe os agentes em ação — `agent:task:started|completed|failed` (CEO Hermes,
  Archify, Composio, agentes dinâmicos), `llm:request|response` (LLM Gateway com
  pendências/tokens/custo), `research:*`, `telegram:*`, `security:*`, `deploy:*`,
  `mcp:*`, `system:ready`. Catálogo de 14 agentes + anel de 120 eventos.
- **`paperclip-routes.ts`** + `paperclip-singleton.ts`: `GET /api/paperclip/agents[?since=]`
  (feed incremental p/ poll de 2s) e `GET /api/paperclip/tickets`.
- **`index.ts`**: `initAgentFeed()` ANTES do `system:ready` (registra o boot) +
  dispatch `/api/paperclip/`.
- **Eventos novos publicados**: `runOrchestrator()` publica
  started/completed/failed do `hermes-orchestrator`; `generateCodeMap()` publica
  os do `hermes-codemap`.
- **UI**: botão **"👁 Show Agents"** no canto SUPERIOR ESQUERDO do header da aba
  → painel ao vivo com cards (status TRABALHANDO/ocioso pulsante, tarefa atual,
  eventos, tokens, custo), chips de stats (X/Y trabalhando · eventos · runs ·
  tokens · $ · uptime), **feed de atividade** cronológico com cores por nível,
  ⏸ Pausar/▶ Retomar e ↻ atualizar; poll 2s enquanto aberto.

**E2E real**: run SEM projeto → reply 1186 chars (sem vazio) + entrada no
histórico global com ts/modelo/latência ✓ · feed registrou
iniciada → LLM (5141 tokens) → concluída em 21,4s ✓ · UI Show Agents: 14 cards,
feed com 5 eventos, stats, pausa/retomar ✓ · aba Histórico: card "Runs recentes"
com OK + "sem projeto" + prompt + preview + link do mapa ✓ · **console 0
erros** ✓ · `tsc --noEmit` EXIT=0 ✓.

## 🎬🎬 Escritório Virtual PIXEL-ART (estilo Agent-Pixels) - Out/2026

Referência oficial: **https://github.com/gcampton/Agent-Pixels** (plugin do
Paperclip que transforma os agentes num escritório pixel-art com câmeras —
herdeiro do "Pixel-Agents" do VSCode). O Show Agents do Hermes foi REESCRITO
nesse estilo: os cards viraram **personagens que andam de verdade**.

**O motor (canvas 2D puro, sem dependências) — `src/ui/index.html`:**
- **Mapa de tiles 16px (44x26)** com salas: **Desks** (2 bancadas de 5 mesas
  com monitor), **Boardroom** (mesa grande + 6 cadeiras), **Cozinha**
  (bancada, pia, café ☕, mesa redonda) e **Lounge/Arcade** (2 sofás,
  fliperama com tela animada, TV, plantas). Piso em xadrez com variação de
  cor por sala; paredes com topo iluminado. BG estático **pré-renderizado
  1x em offscreen** (só 1 drawImage por frame).
- **Personagens pixel-art 12x22** procedurais (cabeça/cabelo/corpo/braços/
  pernas) com **paleta determinística por id** do agente (skin/hair/shirt/
  pants) — cada agente tem aparência consistente entre sessões.
- **Máquina de estados idêntica à do Agent-Pixels**: `walk` (4 frames de
  passo a 3 tiles/s), `type` (2 frames de digitação + **laptop brilhando na
  mesa** piscando), `idle`. Direções DOWN/UP/LEFT/RIGHT com olhos/cabelo
  corretos (vista de costas = cabelo cheio).
- **Pathfinding BFS 4-direções** no grid (paredes/mobília bloqueiam).
- **WORKING → caminha até a SUA cadeira e senta** (16 cadeiras alocadas
  estável: orquestrador primeiro, resto por ordem); ao ficar ocioso, levanta
  e **passeia aleatoriamente** pelo escritório (wander com timers 3-15s);
  se virar WORKING no meio do caminho, **recalcula a rota para a mesa**.
- **Envelopes ✉** das interações reais (de→para do event bus) voam em arco
  até o destino — **acompanhando o alvo em movimento** — e ao chegar viram
  **balão de fala** (speech bubble com cauda) no agente por ~2,8s.
- **Efeito Matrix de spawn** (chuva verde com cabeça brilhante, 0,9s) quando
  um agente novo aparece.
- **3 câmeras** 🏢 Geral (encaixa o mapa todo) / 💼 Escritórios (2x nos desks)
  / 🏮 Lounge (2x na área de baixo), com **câmera suave** (lerp) — botões no
  canto superior direito do canvas.
- **Clique num personagem** → balão com nome + tarefa atual. Etiquetas com
  nome+emoji aparecem sobre quem está WORKING (ou em hover).
- **Performance**: rAF só enquanto o painel está aberto; DPR correto.

**E2E real**: mapa 44x26 com 16 cadeiras montado ✓ · 14 personagens nascem
no ponto de spawn com efeito Matrix e recebem cadeira ✓ · simulação de 4s →
10 personagens **andando** (wander) ✓ · força WORKING no CEO+LLM → ambos
**caminharam até a cadeira certa e sentaram** (naCadeira=true, state=type,
dir=facing da mesa) ✓ · envelope ✉ CEO→LLM viajou e o **balão de fala
apareceu no destino** ✓ · câmeras Geral 0,91x / Escritórios 2x / Lounge 2x ✓ ·
**241k pixels (82% do canvas)** ✓ · console **0 erros** ✓.
Obs.: o rAF do browser fica suspenso com a aba em segundo plano (comportamento
padrão); na UI real (aba visível) a animação roda a 60fps. No E2E os frames
foram simulados manualmente p/ validar a lógica.
