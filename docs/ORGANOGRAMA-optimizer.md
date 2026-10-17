# ORGANOGRAMA — Otimizador de Prompts

> Diagrama de módulos → tarefas → dependências. Atualize quando uma tarefa mudar de status.

```mermaid
graph TD
  subgraph M0[M0 Fundação · 5% · ✅]
    M0a[contracts.ts — tipos + validação runtime + lineDiff]
  end
  subgraph M1[M1 Entrada · 10% · ✅]
    M1a[rota optimize: valida prompt, aceita pdfUrls/docUrls]
  end
  subgraph M2[M2 Intent + Análise Fria · 20% · ✅]
    M2a[intentAndAnalysis — LLM, rubrica 8 critérios, issues sev 1-5]
    M2b[retry JSON estruturado]
  end
  subgraph M3[M3 Pesquisa · 20% · ✅]
    M3a[gatherContext — PDFs→MarkItDown, URLs→scrape, Context7]
    M3b[research — findings + sources com citação]
  end
  subgraph M4[M4 Expansão + Otimização · 20% · ✅]
    M4a[expansionAndOptimize — applied + optimized + changelog]
    M4b[lineDiff — antes × depois]
  end
  subgraph M5[M5 Botão + UI/UX · 15% · ✅]
    M5a[botão ✨ Otimizar + modal]
    M5b[abas: Análise|Fontes|Expansão|Otimizado|Confronto]
    M5c[checklist de issues + campo confronto + chat]
  end
  subgraph M6[M6 Qualidade · 10% · 🟡]
    M6a[E2E manual validado]
    M6b[testes Vitest/Playwright — pendente]
  end

  M0a --> M1a
  M1a --> M2a
  M2a --> M3b
  M3a --> M3b
  M3b --> M4a
  M2a --> M4a
  M4a --> M4b
  M4b --> M5b
  M5a --> M5b
  M5b --> M5c
  M5c --> M6a
  M6a --> M6b
```

## Status das tarefas
- M0a ✅ · M1a ✅ · M2a ✅ · M2b ✅ · M3a ✅ · M3b ✅ · M4a ✅ · M4b ✅ · M5a ✅ · M5b ✅ · M5c ✅ · M6a ✅ · M6b 🟡 pendente
