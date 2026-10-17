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
