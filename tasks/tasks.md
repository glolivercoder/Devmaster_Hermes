
## ⚡ Automação N8N — Out/2026 ✅ (ver src/n8n/CONTEXT.md)
- [x] Agente N8N (prompt mestre adaptado) + wizard 4 fases + score determinístico
- [x] API client oficial (token em memória, redact) + templates da fonte da página oficial
- [x] 15 rotas /api/n8n/* + target n8n (gemini-flash) + audit
- [x] UI view-n8n (sidebar) com guia passo-a-passo, design, score, computer use, chat
- [x] Fallbacks: design 8192+contingência+determinístico; fix com heurísticas locais
- [x] E2E backend + UI (DOM) — ver PROGRESS.md

## 📁 Orquestrador: pasta do projeto + OpenCode — Out/2026
- [x] Campo 📁 Projeto na aba Orquestrador (cria F:\Projetos2026\DevMaster\<nome>)
- [x] project-store.ts: prompt-original.md + historico.jsonl + runs/<ts>/{resposta, pesquisa-avancada, analise-mercado, site-crm, site-profissional}.md
- [x] Rotas GET /api/orchestrator/projects e /project-file (guarda traversal)
- [x] Botão ▶ Enviar para OpenCode com cadeia: OmniRoute → Hermes LiteLLM → cópia
- [x] Card "Projetos do Orquestrador" na aba Histórico + visualizador de arquivos
- [x] E2E: 3 runs reais (siteCrm/pesquisa/mercado) + UI DOM + integração OpenCode
