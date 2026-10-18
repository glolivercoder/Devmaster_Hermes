
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

## ??? ProcessAgent - MCPs categorizados + processos/CPU/RAM - Out/2026
- [x] process-agent.ts: snapshot (WMI+netstat, CPU/RAM, suspenso, protegido) + acoes fechar/pausar/retomar/reiniciar
- [x] Monitor de fundo (20s, eventos porta/CPU/RAM) + /api/process-agent/status|config
- [x] Mapa de portas no contexto do Orquestrador (switch) + diretivo [[PROCESSO:...]] executado com validacao de PID
- [x] MCPs categorizados (Hermes x OpenCode x ativos) + /api/mcps/categories
- [x] UI: categorias no header, cards com favicons de acao + display CPU/RAM, auto-refresh 12s
- [x] E2E: pausar/susp/retomar/reiniciar/fechar + protegido recusado + run real do orquestrador fechando PID via diretivo

## 🗺 Mapa de Código (Archify) + credencial opcional no chat - Out/2026
- [x] Skill archify v3.2.0 em .opencode/skills/archify (versionada; doctor 100% ok)
- [x] code-map.ts: coleta do repo -> LLM com contrato da SKILL -> CLI finalize c/ ate 2 reparos -> data/code-maps/<slug>.html + digest
- [x] Robustez: extractJson normalizado + dump raw + 3 tentativas (truncamento do modelo) + candidate antes do finalize + slug sem ponto final
- [x] Rotas /api/code-map/{status,list,generate,<arquivo>.html} c/ anti-traversal
- [x] Switch mapaCodigo (default ON) + injecao do bloco no runOrchestrator + codeMap no resultado
- [x] UI: checkbox 🗺 Capacidades, botao "🗺 Mapa do Código", card de link "abrir ↗" na resposta
- [x] Chat: run SEMPRE dispara (credencial nunca bloqueia) + card ⏭ Pular / ⏭⏭ Pular tudo nesta seção
- [x] Badge "⏭ credenciais puladas · reativar" + localStorage hermes-cred-skip-orquestrador
- [x] Modal: selo opcional, nota ℹ️, ⏭ Pular credencial, ⏭⏭ skip-all, Esc + backdrop
- [x] E2E: generate 43s (12 comp/11 conex), HTML 836KB servido, traversal 404, run c/ digest + card na UI, DOM de todos os skips, console 0 erros, tsc EXIT=0

## 🕘 Show Agents + fix do run sumido (resposta vazia) - Out/2026
- [x] Diagnóstico: provedor devolvia HTTP 200 com content=null -> reply vazia + salvamento quebrava (null.slice/length)
- [x] gateway-client: valida content, 1 retry automatico em resposta vazia + falha no benchmark + erro claro
- [x] orchestrator-routes: defesa extra no salvamento + historico GLOBAL data/orchestrator-history.jsonl (inclusive falhas com motivo) + GET /api/orchestrator/history
- [x] UI aba Historico: card "Runs recentes" (ts, OK/FALHOU, modelo, latencia, projeto/sem projeto, prompt, preview, mapa)
- [x] agent-feed.ts: consome o event bus real (agent:task:*, llm:*, research:*, telegram:*, security:*, deploy:*, mcp:*) com 14 agentes + anel de 120 eventos
- [x] paperclip-routes + singleton: GET /api/paperclip/agents[?since] (feed incremental) e /tickets
- [x] index.ts: initAgentFeed() antes do system:ready + dispatch /api/paperclip/
- [x] Eventos publicados pelo orquestrador (hermes-orchestrator) e pelo gerador de mapa (hermes-codemap)
- [x] UI: botao "Show Agents" no canto superior esquerdo da aba Office -> painel ao vivo (cards, stats, feed, pausar/retomar, poll 2s)
- [x] E2E: run sem projeto gravado no historico, feed com started->LLM->completed, painel 14 cards + feed, aba Historico listando runs, console 0 erros, tsc EXIT=0
