# CONTEXT — Deploy Agent (DeployBot)

> Módulo: `src/deploy/` · Rota base: `/api/deploy/*` (porta **4020**, same-origin)
> UI: aba **🚀 DEPLOY Agent** na sidebar (`view-deploy` em `src/ui/index.html`)

## Objetivo

Plataforma **fácil, intuitiva e interativa para usuários leigos** fazerem deploy:
escaneia o projeto → classifica → recomenda plataforma gratuita (ranking com
score) → guia passo a passo com checkboxes → assistência visual (Computer Use)
nos passos gráficos → verificação pós-deploy → gera `DEPLOY_INFO.md`.

## Arquitetura (3 arquivos + UI)

| Arquivo | Papel |
|---|---|
| `deploy-agent.ts` | Lógica **determinística** (sem LLM): `classifyProject` (8 categorias), `classifyHosting`, `FREE_TIERS` (13 plataformas, Tier A/B/C), `RETIRED_PLATFORMS` (4 — nunca recomendados), `scorePlatforms` (COMPAT×40 + CUSTO×30 + FACIL×20 + PERF×10), `deploySystemPrompt` (persona DeployBot) |
| `command-runner.ts` | Executor bash seguro: **AUTO** (leitura, roda sozinho) / **CONFIRM** (clique humano) / **DENY** (nunca roda). Deny-by-default. Log no `auditLogger` |
| `deploy-routes.ts` | HTTP: analyze, recommend, guide (LLM), computer-use, run-command, verify, write-file, refresh-tiers, chat, tiers, classify-command |

## Rotas

```
GET  /api/deploy/tiers                 → catálogo + extintos + pós-passos
POST /api/deploy/analyze        {}     → scan + perfil do projeto
POST /api/deploy/recommend      {profile} → ranking score 0-100
POST /api/deploy/guide          {profile, platform, intent?} → plano LLM (JSON)
POST /api/deploy/classify-command {command} → {tier, reason}
POST /api/deploy/run-command    {command, confirm?} → execução allowlist
POST /api/deploy/computer-use   {goal, step?} → ação visual + screenshot
GET  /api/deploy/computer-use/screenshot    → screenshot ao vivo
POST /api/deploy/verify         {url}  → HTTP status + tempo
POST /api/deploy/write-file     {path, content, confirm:true} → escrita segura
POST /api/deploy/refresh-tiers  {}     → researcher confere free tiers na web
POST /api/deploy/chat           {message, profile?, project?, history?} → DeployBot
```

## Integrações (alinhamento com os agentes existentes)

- **ComputerUseAgent** (`src/computer-use/`) — exposto por rota pela 1ª vez.
  **Bug corrigido**: o screenshot era capturado mas NUNCA anexado ao prompt (o
  `GatewayClient.complete` só aceitava texto). `content` agora aceita
  multimodal (`string | ContentPart[]`) com `image_url` data-URI.
- **Fallback de visão** (pedido do usuário): cadeia
  `openrouter-vision-free` (grátis) → `cheaper-vision` (Gemini 3.8 Flash pago
  barato) → `cheaper-fast` (Haiku). Validado E2E: free falhou → cheaper-vision
  assumiu.
- **smart-router**: target `deploy` adicionado em `ROUTE_TARGETS` (default
  `omniroute-code`); `computer_user` continua no target original.
- **researcher.searchWeb** → rota refresh-tiers (regra "atualizar free tiers").
- **memory (pgvector)** → chat persiste em projeto `deploy:<escolhida>`;
  `continuityBlock` injeta histórico na conversa.
- **structuredJson** (exportado do otimizador) → retry ×3 de JSON; fallback
  markdown se o LLM insistir em JSON malformado (`degraded: true`).

## Segurança (decisões do usuário: allowlist + confirmação)

- Scan e escrita confinados sob `DEPLOY_ROOT|PREVIEW_ROOT|cwd` (anti-traversal).
- `write-file` exige `confirm:true`; bloqueia `.env*`, `.git`, `node_modules`.
- Command-runner: deny `rm -rf|sudo|curl|sh|dd|mkfs|format|fork bomb|…`;
  auto só para leitura (ls/cat/git status/versões/curl de verificação).
- NUNCA expõe credenciais — o prompt instrui a citar apenas NOMES de variáveis.

## Classificação (Módulo 1) — precisão

8 categorias: STATIC, JAMSTACK, SPA, SSR_FULLSTACK, BACKEND_API, FULLSTACK_MONO,
DOCKER_APP, MOBILE_DESKTOP. Heurísticas:
- deps clássicas (express/next/react/…) via `package.json`;
- **sinal de servidor invisível**: `createServer(|.listen(` no entrypoint
  (ex.: o próprio Hermes usa `node:http` puro);
- **UI sem framework**: `.html` em `src/ui|public|static|www` → FULLSTACK_MONO;
- Dockerfile → DOCKER_APP (só quando não há manifest);
- `next.config` com `output: 'export'` → JAMSTACK.
Testado: Hermes → FULLSTACK_MONO/PaaS/Postgres/Docker ✓.

## Limitações conhecidas

- `curl -s -o /dev/null` no Windows retorna exit 23 (não existe /dev/null),
  mas o HTTP code sai no stdout — aceito como pós-verificação.
- Computer Use é **assistência** (lento, 1 ação/ciclo), não caminho principal.
- `refresh-tiers` é consultivo: sugere mudanças, não altera `FREE_TIERS`
  automaticamente (decisão humana).
