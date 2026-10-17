# Tasks — Otimizador de Prompts (formato ai-dev-tasks)

> Substitui o Taskmaster (não instalado no Hermes). Checkbox = concluído.

## M0 Fundação (peso 5)
- [x] 0.1 `src/optimizer/contracts.ts` — tipos Intent/ColdAnalysis/Source/Expansion/OptimizeResult/PipelineResult
- [x] 0.2 Validação de runtime pura (sanitizeIntent/Analysis/Sources) — sem Zod
- [x] 0.3 `lineDiff` (antes × depois) sem lib externa

## M1 Entrada (peso 10)
- [x] 1.1 Rota `POST /api/optimizer/optimize` valida prompt obrigatório
- [x] 1.2 Aceita `pdfUrls[]` e `docUrls[]` opcionais

## M2 Intent + Análise fria (peso 20)
- [x] 2.1 `intentAndAnalysis` — LLM 1 call, rubrica 8 critérios (nota 0-10)
- [x] 2.2 Issues no formato {criterion, excerpt, problem, impact, severity 1-5}, sem elogios
- [x] 2.3 Retry JSON estruturado (structuredJson, 3 tentativas)

## M3 Pesquisa (peso 20)
- [x] 3.1 `gatherContext` — PDFs→MarkItDown, URLs→scrapeUrl (curl_cffi), Context7
- [x] 3.2 `research` — findings + sources com {ref, kind, excerpt}

## M4 Expansão + Otimização (peso 20)
- [x] 4.1 `expansionAndOptimize` — applied (resultado aplicado) + optimized + changelog
- [x] 4.2 Diff antes × depois + linhas alteradas
- [x] 4.3 Guardrails (não inventar fora da intenção)

## M5 Botão + UI/UX (peso 15)
- [x] 5.1 Botão "✨ Otimizar" ao lado de Enviar (aba Orquestrador)
- [x] 5.2 Modal com prompt pré-preenchido + PDFs/URLs
- [x] 5.3 Progresso por etapa (aria-live)
- [x] 5.4 Abas: Análise | Fontes | Expansão | Otimizado | Confronto
- [x] 5.5 Checklist de issues (checkbox) + nota por critério
- [x] 5.6 Confronto: chat interativo, LLM pode perguntar (badge ❓), botões copiar/usar

## M6 Qualidade (peso 10)
- [x] 6.1 E2E manual validado (optimize + discuss + modal)
- [ ] 6.2 Testes Vitest (unit contracts + pipeline)
- [ ] 6.3 Testes Playwright (e2e UI)
- [ ] 6.4 Rate-limit por IP + cache de fontes (pg)
