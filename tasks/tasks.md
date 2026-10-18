
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

## 🕵️ Agente de Versionamento de Projetos — Out/2026
- [x] project-version-agent.ts: save point local + push simultâneo Gitea (main + hermes-full com .env) e GitHub (só main limpo)
- [x] .gitignore gerenciado (bloco HERMES-SEGREDOS) + scan de segredos que bloqueia push ao GitHub (sem expor valores)
- [x] Monitor automático (intervalo configurável, skip sem mudanças, projeto novo conta como mudança)
- [x] 5 rotas /api/version/* (status/config/run/github-repo/log) + audit + redact
- [x] UI card na aba Versionamento & Backup (toggle, badges, save point por projeto, log)
- [x] E2E: gate sk- bloqueado, .env no full do Gitea, monitor 15s, repos criados no GitHub (privado) e Gitea
