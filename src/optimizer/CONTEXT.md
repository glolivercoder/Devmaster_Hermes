# CONTEXT.md — src/optimizer/

## Propósito
Otimizador de Prompts do Hermes: botão "✨ Otimizar" na aba Orquestrador que recebe um
prompt (+ PDFs/URLs de contexto opcionais) e devolve análise fria, pesquisa com fontes,
expansão aplicada e prompt otimizado com diff/changelog — mais um modo de **confronto
interativo** onde a LLM pode perguntar aspectos do projeto.

## Arquivos-chave
- `contracts.ts` — tipos (`Intent`, `ColdAnalysis`, `Source`, `Expansion`, `OptimizeResult`,
  `PipelineResult`), validação de runtime pura (sem Zod) e `lineDiff`. **Contratos**: alterar
  aqui afeta routes + pipeline + UI.
- `pipeline.ts` — serviços isolados: `gatherContext` (PDFs/URLs/Context7), `intentAndAnalysis`,
  `research`, `expansionAndOptimize`, `runOptimizer` (orquestra), `discuss` (confronto).
  Helper `structuredJson` = LLM com retry de JSON.
- `optimizer-routes.ts` — `POST /api/optimizer/{optimize,discuss}`. Handler retorna `true` se
  tratou a rota (padrão dos routes do Hermes).

## Padrões do projeto (seguir)
- Reusar `gateway-singleton` (`getGateway`/`getVirtualKey`), `llm/routing-store` (`resolveModel`),
  `research/researcher` (`searchWeb`/`scrapeUrl`), `research/context7`.
- `resolveModel('orchestrator')` para tarefas que exigem JSON estruturado confiável.
- Nenhum `any` em contratos públicos; erros tipados; retry p/ chamadas externas.
- UI vanilla em `src/ui/index.html` (Tailwind CDN), funções globais `opt*`.

## Links p/ CONTEXT.md filhos
- UI do botão/modais: ver `src/ui/index.html` (funções `openOptimizer`, `optRun`,
  `renderOptimizer`, `optDiscuss`).
- Serviços reusados: `src/research/CONTEXT` (pesquisa), `src/memory/CONTEXT` (pgvector).

## Regra de orçamento (para sessões futuras de LLM)
- Leia só este CONTEXT.md + `contracts.ts` + `optimizer-routes.ts` antes de mexer.
- Uma etapa por sessão; ≤ 8 arquivos; ≤ 250 linhas por arquivo; ≤ 40 linhas por função.
