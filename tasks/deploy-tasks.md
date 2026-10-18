# DEPLOY Agent — Tasks

## M0 Fundação ✅
- [x] Investigar sidebar, ComputerUseAgent, padrão de rotas/wiring
- [x] Decisões com usuário: allowlist+confirmação · só sidebar Hermes · guiar+automatizar seguro

## M1 Backend ✅
- [x] `deploy-agent.ts` — classifyProject (8 categorias), classifyHosting, FREE_TIERS (13), RETIRED (4), scorePlatforms, deploySystemPrompt
- [x] `command-runner.ts` — AUTO/CONFIRM/DENY, deny-by-default, auditLogger
- [x] `deploy-routes.ts` — analyze/recommend/guide/computer-use/run-command/verify/write-file/refresh-tiers/chat/tiers/classify-command
- [x] Target `deploy` no ROUTE_TARGETS (gemini-flash)
- [x] Eventos `deploy:command:*` no HermesEventMap

## M2 Computer Use viável ✅
- [x] Bug: screenshot nunca anexado → GatewayClient multimodal (ContentPart)
- [x] Cadeia de fallback free → pago barato (openrouter-vision-free → cheaper-vision → cheaper-fast)
- [x] Rota `/api/deploy/computer-use` + `/screenshot` (1ª exposição HTTP)
- [x] E2E: fallback comprovado (cheaper-vision assumiu, mouse_move ok)

## M3 UI (leigo-first) ✅
- [x] Botão 🚀 na sidebar + array tabs + hook dpInit
- [x] 6 painéis: classificação, ranking, guia+checklist, computer use, pós-deploy, tiers+chat
- [x] Badges AUTO/CONFIRM/DENY por comando (via /classify-command)
- [x] Progresso [n/total] + DEPLOY_INFO.md + verify

## M4 E2E ✅
- [x] analyze/recommend/guide/verify/chat/write-file/refresh-tiers
- [x] run-command: AUTO exec · DENY bloqueio · CONFIRM gate
- [x] Classificação Hermes → FULLSTACK_MONO (heurística node:http)

## M5 Docs ✅
- [x] `src/deploy/CONTEXT.md`
- [x] PROGRESS.md + este tasks

## Backlog (não pedido)
- [ ] Streaming das etapas do guia
- [ ] Auto-atualização de FREE_TIERS a partir do refresh-tiers (hoje é sugestão)
- [ ] Integração com Gitea (backup pós-deploy)
- [ ] Suporte a vários projetos (scan de subpastas como raiz alternativa)
