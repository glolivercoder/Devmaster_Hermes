# Devmaster_Hermes

## Orquestrador

- `POST /api/orchestrator/run` executa o pipeline principal com pesquisa, contexto, memória, mercado e mapa de processos conforme configuração.
- `POST /api/orchestrator/coordinate` cria plano validado, delega módulos em ordem topológica, executa tarefas independentes em paralelo e sintetiza resultados.
- Módulos `SECURITY`/`PENTEST` acionam somente o scanner local de segredos; isso não equivale a SAST ou pentest ativo.
- A delegação gera entregáveis textuais; não altera arquivos nem aciona APIs externas. Use os módulos próprios para essas ações.
- Mensagens comuns do Telegram usam o mesmo `runOrchestrator` do dashboard. Comandos explícitos (`/conectar`, `/postar`, `/status`) continuam separados.
- Diretivos de processo viram propostas. Encerrar, pausar, retomar ou reiniciar exige confirmação na interface; ações de Computer Use também exigem confirmação.

Para coordenar um plano, use botão **Delegar plano** no chat ou envie `POST /api/orchestrator/coordinate` com `{ "prompt": "..." }`.
