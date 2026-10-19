# Agency Agents no Hermes

Hermes consulta perfis selecionados do repositório [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) como referências no RAG. Catálogo coberto: engenharia (65), design (10), testes/QA (9) e segurança (12), total atual de 96 perfis. Perfis de marketing, vendas, finanças e outras áreas ficam fora deste escopo de software.

## O que é indexado

Cada perfil vira uma ficha curta com nome, função, áreas de atuação, abordagem, divisão, link de origem e SHA upstream. Hermes não replica o prompt completo do perfil. O conteúdo recuperado é consultivo e não substitui regras, evidências, controles de segurança nem aprovações do usuário. Atribuição upstream: licença MIT, Copyright (c) 2025 AgentLand Contributors.

## Ativar e consultar

Com o serviço Hermes, PostgreSQL/pgvector e uma chave de embeddings configurados:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:4020/api/memory/seed-agency-agents
Invoke-RestMethod -Method Get -Uri http://localhost:4020/api/memory/agency-agents
```

O seed baixa a árvore atual do GitHub, confere os perfis das quatro divisões permitidas e grava/atualiza fichas no projeto `agency-agents`. É idempotente por perfil e atualiza um registro quando o SHA upstream muda. Resposta inclui quantidade encontrada, inserida, atualizada, ignorada e com/sem embedding. Falhas ao baixar ou interpretar arquivos são retornadas; falhas de embedding aparecem como `embeddingFailures`.

O endpoint `GET /api/memory/agency-agents` lista as fichas que já estão indexadas. Sem seed, não há correspondências a consultar. O `/api/orchestrator/run` inclui até quatro referências semanticamente mais próximas; `/api/orchestrator/coordinate` inclui até três por tarefa planejada nos subagentes Hermes que já existem. Não são criados novos subagentes nem chamadas externas de Agency Agents. Para proteger qualidade, se embeddings semânticos não estiverem disponíveis o orquestrador não escolhe perfis arbitrários por recência.

## Sugestões para evoluir o prompt mestre

1. Trocar percentuais de viabilidade sem fonte por faixa de confiança, premissas e evidências verificáveis.
2. Separar explicitamente análise, planejamento, execução e aprovação; dizer o que cada rota realmente faz. Hoje `/run` responde com um modelo e `/coordinate` planeja/delega tarefas textuais sem alterar arquivos.
3. Definir critérios para escolher um perfil, não apenas nomes: problema, artefato esperado, ferramentas realmente disponíveis, custo/latência e condição de parada.
4. Limitar contexto por tarefa: recuperar poucos perfis relevantes, pedir justificativa de seleção e descartar resultados sem aderência.
5. Tratar texto do RAG e arquivos externos como dados não confiáveis; nunca permitir que substituam as regras do sistema ou ampliem permissões.
6. Remover “acesso direto e irrestrito” a processos/MCPs. Usar menor privilégio, confirmação explícita e auditoria, coerente com a política da seção 14.3.
7. Exigir evidências para alegações de execução: comandos/testes realmente rodados, arquivos alterados e lacunas de validação; nunca apresentar plano textual como trabalho executado.
8. Registrar fonte, versão/SHA, licença e data de indexação para poder revisar atualidade e atribuição.
