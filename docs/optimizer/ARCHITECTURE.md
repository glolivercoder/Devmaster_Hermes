# Arquitetura — Otimizador de Prompts

## Fluxo do pipeline

```
prompt + PDFs/URLs (opcional)
        │
        ▼
┌─ PESQUISA (contexto offline) ────────────────────────────┐
│ gatherContext():                                          │
│  • PDFs  → download temp → MarkItDown (pdf2md) → MD      │
│  • URLs  → researcher.scrapeUrl (curl_cffi) → texto      │
│  • Context7 → searchLibraries + fetchContext → docs      │
└───────────────────────┬──────────────────────────────────┘
                        ▼
   1. INTENT + ANÁLISE FRIA  (LLM, 1 call, retry JSON)
      → intent{objective,audience,deliverable,implicitConstraints}
      → analysis{scores 8 critérios 0-10, issues[critério,trecho,problema,impacto,sev 1-5]}
                        ▼
   2. PESQUISA (LLM, grounded no contexto + web Tavily)
      → findings[] + sources[{ref,kind,excerpt}]
                        ▼
   3. EXPANSÃO + OTIMIZAÇÃO (LLM, 1 call)
      → expansion{applied, addedFeatures, guardrails}
      → optimize{optimizedPrompt, diff(antes×depois), changelog[]}
                        ▼
   JSON validado (contracts.ts) → PipelineResult
```

## Discussão interativa (Confronto)
`POST /api/optimizer/discuss` — mantém `OPT_MSGS` no client. A LLM tem instrução de
**PERGUNTA:** no fim quando precisa de mais info do projeto (público, stack, formato,
restrições). Pode confrontar as próprias sugestões (anti-sicofância). O histórico é
reenviado (últimas 10 mensagens) com o prompt original + otimizado + issues marcados
no checklist (só os `checked`).

## Contratos
Ver `src/optimizer/contracts.ts`. Validação de runtime pura (sem Zod):
`sanitizeIntent`, `sanitizeAnalysis`, `sanitizeSources`, `lineDiff`.

## ADRs (decisões arquiteturais curtas)
- **ADR-001 · Reusar serviços Hermes vs stack Next.js**: o template pedia Next.js/AI SDK/
  Drizzle. Como o objetivo é "alinhado com os outros agentes", reusamos `researcher`,
  `context7`, `gateway`, MarkItDown. Menos código, sem novo runtime.
- **ADR-002 · Sem Zod/diff**: validação e diff em TS puro → zero dependência nova,
  `package.json` intacto (só @composio/core + pg).
- **ADR-003 · 3 calls LLM**: combinar INTENT+ANÁLISE e EXPANSÃO+OTIMIZAÇÃO corta ~40% de
  latência/custo vs 5 calls, sem perder separação lógica dos serviços.
- **ADR-004 · Retry de JSON estruturado**: modelos grátis não-determinísticos geram JSON
  malformado → `structuredJson` retrya 3× instruindo correção. Padrão compartilhado com
  market-analysis.
- **ADR-005 · Context7 sempre**: documentação de libs é pré-requisito anti-alucinação —
  roda em todo `gatherContext`, não é opcional.
