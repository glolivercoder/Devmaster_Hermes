# PROMPT MESTRE — HERMES CONTROL CENTER
## Plataforma de Orquestração de Agentes de Desenvolvimento, Cibersegurança e Automação

---

## 1. VISÃO GERAL DO PROJETO

Criar uma plataforma (HERMES Control Center) com interface de chat e sidebar modular, que funcione como um "Agent Hermes" com capacidade de **computer use** e integração via **MCP (Model Context Protocol)** com múltiplas plataformas de desenvolvimento (Cursor, Antigravity, Claude Code, Windsurf, VS Code).

A plataforma deve orquestrar múltiplos agentes especializados:
- **Agentes de programação** (desenvolvimento de módulos)
- **Agentes de cibersegurança** (auditoria, prevenção de invasões)
- **Agentes de pentest e invasão** (testes ofensivos controlados)
- **Agentes de testes** (QA automatizado)
- **Agentes de integração de módulos** (conectando módulos de SaaS/webapp via MCP ou API REST)

Todos os agentes devem ser coordenados por um **Agente Orquestrador** central.

---

## 2. FLUXO DE DESENVOLVIMENTO EM MÓDULOS

- A aplicação (SaaS ou webapp) deve ser **sempre desenvolvida em módulos separados**, cada um integrado aos demais via **MCP ou API REST** — nunca como monólito acoplado.
- A ordem de criação dos módulos deve seguir uma **árvore de dependências de desenvolvimento**, priorizando o módulo mais necessário para o próximo passo, garantindo fluidez e evitando que o agente se perca de contexto.
- Cada módulo deve ser **testado e validado antes** de o desenvolvimento avançar para o módulo seguinte (gate de qualidade entre módulos).
- Ao receber uma ideia/prompt inicial, o sistema deve gerar automaticamente:
  - **Análise de viabilidade** (em %)
  - **Análise de mercado e público-alvo** (sem viés de agradar o usuário — ver seção 6)
  - **Estimativa de tempo de desenvolvimento**
  - **Sugestão da divisão em módulos**, com a ordem recomendada de construção

---

## 3. GESTÃO DE CONTEXTO (ANTI-AMNÉSIA)

Para evitar que o agente "esqueça" o projeto e recomece do zero:
- Adotar arquivos de contexto persistente: `CLAUDE.md`, `ARCHITECTURE.md` (com diagramas Mermaid.js), `STATE.md` (estado atual do projeto/módulos).
- Usar ferramentas de sumarização de codebase como **Repomix** para compactar contexto antes de cada nova sessão de trabalho do agente.
- Gerar automaticamente um **infográfico com os pontos cruciais da aplicação** (arquitetura, módulos, dependências, status) sempre que solicitado ou a cada marco de desenvolvimento.

---

## 4. CIBERSEGURANÇA E PENTEST

- Incorporar um agente de segurança baseado em processo estruturado (referência: *cloudflare/security-audit-skill*, 6 fases de auditoria).
- Automatizar varredura de vulnerabilidades e vazamento de segredos com **Semgrep** e **TruffleHog**.
- O agente de pentest deve:
  - Realizar testes ofensivos controlados na aplicação em desenvolvimento.
  - Gerar relatórios de vulnerabilidades encontradas.
  - Instruir o agente principal de desenvolvimento sobre como corrigir cada brecha, interagindo diretamente com ele.
- Criar um **ambiente seguro e centralizado de controle de APIs** (ver Módulo 10 — Configurações de APIs), permitindo que chaves e endpoints sejam reutilizados com segurança em futuros SaaS/webapps desenvolvidos na mesma plataforma.

---

## 5. SKILLS E REPOSITÓRIOS DE REFERÊNCIA (REAIS)

Base de referência para skills, agentes e automações:
- **affaan-m/ECC** — agent harness com 71 agentes, 311 skills, 97 comandos (MIT license) — referência principal para workflow sistematizado.
- **VoltAgent/awesome-agent-skills** — índice comunitário com 1000+ skills.
- **aliborhothamud/claude-melhores-skills** — catálogo curado em português.
- **cloudflare/security-audit-skill** — auditoria de segurança estruturada.
- Instalação padrão de skills: `npx skills add <author/repo@skill>`
- Plugins Claude: `/plugin marketplace add <plugin-slug>`

---

## 6. ANTI-SYCOPHANCY (SEM "PUXAR SACO")

- O agente/plataforma **não deve mentir ou inflar expectativas** para agradar o usuário "vibe coder".
- Implementar persona "Advogado do Diabo" e system prompts anti-flattery que forcem o agente a:
  - Expor as reais projeções de mercado e tamanho de público do webapp/SaaS.
  - Confrontar a ideia com a complexidade técnica real e riscos de execução.
  - Dar opiniões diretas ("na lata"), mesmo que desagradáveis.

---

## 7. UI/UX E ANIMAÇÕES

- Fugir do padrão genérico/pobre comum em apps "vibe coded".
- Bibliotecas e skills de referência: **shadcn/ui**, **Framer Motion**, **ui-ux-pro-max**, **jakubkrehel/skills**.
- Toda interface gerada deve seguir referências profissionais de UX/UI de produtos reais, com animações modernas e clean.

---

## 8. ABA "MCPs" (SIDEBAR)

Painel central de monitoramento e controle:
1. Listagem em tempo real de todos os MCPs rodando na máquina (nome, PID, porta, status, uptime, CPU/RAM).
2. Ações por item: Iniciar, Parar, Reiniciar (manual, com confirmação).
3. Seção separada para os MCPs nativos do próprio HERMES Control Center, com os mesmos controles.
4. **MCP de integração com editores baseados em VS Code** (VS Code, Cursor, Antigravity, Windsurf):
   - Detectar instâncias abertas.
   - Abrir/fechar workspaces e disparar comandos via API/extensão de cada editor.
   - Camada de abstração única no HERMES para não reimplementar por editor.
5. Painel de **Processos & Serviços de Terminal**: listar processos rodando via terminal (servidores Node.js, scripts Python, serviços locais), porta ocupada, comando original, status — com ações de abrir, fechar e reiniciar.
6. **Modo orquestrado**: o Agente Orquestrador deve ter acesso direto aos MCPs e terminais para gerenciar (iniciar/parar/reiniciar) conforme a árvore de dependências do projeto (ex.: subir backend antes do frontend, encerrar serviço obsoleto após deploy de novo módulo).
   - Caso a carga de gerenciamento seja alta, o Orquestrador deve ser capaz de **criar subagentes especializados** (ex.: "Subagente de Infraestrutura/Processos") com a função exclusiva de gerenciar MCPs e terminais, reportando de volta ao Orquestrador.
7. Log de auditoria de todas as ações (manuais e automáticas), com timestamp e responsável (usuário ou agente).

Stack sugerida: Node.js (child_process/execa) ou Python (psutil) para inventário de processos; WebSocket para atualização em tempo real; camada de plugins por editor (VS Code Extension API / CLIs do Cursor, Windsurf, Antigravity).

---

## 9. ABA "TELEGRAM" (SIDEBAR)

Canal de comunicação privado 1-para-1 entre o usuário e o agente (sem terceiros):
1. Configuração via BotFather (Bot Token) + captura do `chat_id` autorizado via `/start` (qualquer outro chat_id é bloqueado e logado).
2. Notificações automáticas para o celular quando:
   - Um agente finaliza uma tarefa.
   - Um agente encontra erro crítico ou vulnerabilidade (relatório de pentest).
   - Um módulo é concluído e testado.
   - Um MCP ou processo monitorado cai/reinicia (integração com a aba MCPs).
3. Envio de prompts pelo Telegram diretamente para o chat ativo do HERMES (via webhook ou long polling), com resposta do agente retornada automaticamente ao Telegram.
4. Sincronização bidirecional entre a aba Telegram e o chat principal da plataforma.
5. **Fila de pedidos (Request Queue)**: se o agente estiver ocupado, o prompt recebido entra em fila FIFO persistente local; ao ficar livre, processa o próximo automaticamente e notifica via Telegram. Status da fila visível na aba (posição, pendentes, tempo estimado).
6. Histórico de mensagens pesquisável dentro da aba.

Stack sugerida: `grammY` ou `node-telegram-bot-api` (Node.js) / `python-telegram-bot` (Python); fila com SQLite ou BullMQ/Redis; webhook HTTPS (ou polling sem domínio público).

---

## 10. ABA "CONFIGURAÇÕES DE APIs" (SIDEBAR) — GATEWAY DE PROVEDORES LLM

Módulo dedicado à gestão centralizada e segura de todas as credenciais e roteamento de modelos de IA usados pela plataforma e pelos agentes, baseado no **BerriAI/litellm (LiteLLM Proxy / AI Gateway)**, self-hosted.

### 10.1 Objetivo
Funcionar como gateway único entre o HERMES (e qualquer webapp/SaaS futuro criado na plataforma) e os provedores de LLM, evitando exposição de chaves reais, centralizando custo, limites e observabilidade.

### 10.2 Requisitos funcionais
1. **Seleção de provedor e modelo**:
   - O usuário pode escolher manualmente, por agente ou por módulo, qual provedor/modelo usar (OpenAI, Anthropic, Google Gemini, OpenRouter, DeepSeek, Z.AI/Zhipu, Groq ou qualquer endpoint OpenAI-compatible).
   - Alternativamente, pode deixar a seleção **a cargo do Agente Orquestrador**, que escolhe o modelo mais adequado por tarefa (custo, latência, capacidade), respeitando orçamento e allowlist configurados.
2. **Virtual Keys por módulo/agente**:
   - Cada módulo, agente ou sub-agente recebe uma **virtual key** emitida pelo LiteLLM, nunca a chave real do provedor.
   - Cada virtual key tem: orçamento (budget) próprio, rate limit (RPM/TPM), allowlist de modelos permitidos, dono/tag.
3. **Configuração de modelos (model_list)**:
   - Interface para cadastrar e editar os modelos disponíveis (nome lógico, provedor, variável de ambiente da chave), equivalente ao `model_list` do LiteLLM (ex.: `claude-code`, `gemini-pro`, `openrouter-auto`, etc.).
4. **Orçamento e limites**:
   - Definir limite de gasto mensal por virtual key, por agente, por módulo ou por projeto.
   - Definir rate limits (RPM/TPM) por chave, usuário, time ou organização.
   - Bloqueio automático ao atingir o limite configurado.
5. **Dashboard de custo e consumo em tempo real**:
   - Exibir, enquanto o usuário programa, o consumo e custo acumulado por provedor (OpenRouter, Google Gemini, Anthropic, OpenAI, DeepSeek), por agente, por módulo e por chave virtual.
   - Consulta via endpoint equivalente a `/key/info` do LiteLLM.
6. **Observabilidade e auditoria**:
   - Integração com Langfuse, Phoenix, LangSmith ou OpenTelemetry para traces, custos e auditoria por chamada.
   - Toda requisição de modelo registrada no log central de auditoria da plataforma.
7. **Segurança de rede (opcional/Enterprise)**:
   - ACL por endereço IP/CIDR para restringir quem pode chamar o gateway.
   - Gateway posicionado atrás de proxy reverso com TLS (ex.: Nginx/Cloudflare).
8. **APIs gratuitas / catálogo de descoberta**:
   - Integrar **public-apis/public-apis** apenas como catálogo de descoberta de APIs públicas gratuitas (não armazena nem gerencia credenciais).
   - Incluir também o repositório de APIs gratuitas já identificado pelo usuário no GitHub como fonte adicional.
9. **Separação de tipos de credencial**:
   - **Chaves de LLM** → ficam exclusivamente no LiteLLM Gateway, no backend.
   - **Chaves de APIs de produto/pagamento** (Stripe, Mercado Pago, Google Maps, GitHub, SendGrid, Asaas etc.) → gerenciadas em um secret manager separado: **Infisical** (open source, recomendado para times/múltiplos ambientes), com alternativas **HashiCorp Vault** (rotação/policies avançadas) ou **Doppler** (simplicidade).
   - **Chaves expostas ao frontend** → nunca; todo acesso passa por um backend/BFF.
   - **Chave usada por cada webapp/módulo** → sempre a virtual key do LiteLLM, com escopo mínimo necessário.

### 10.3 Arquitetura recomendada
```
Webapp A ─┐
Webapp B ─┼─> LiteLLM Gateway ─> OpenRouter / Gemini / Claude / OpenAI
SaaS C  ──┘        │              DeepSeek / Z.AI / Groq
                   │
                   ├─> PostgreSQL: chaves virtuais, uso, custo, limites
                   ├─> Redis: cache/rate limiting
                   └─> Langfuse/OpenTelemetry: traces e auditoria
```

Cada módulo/webapp consome o gateway como se fosse a API original (compatível com SDKs OpenAI, Anthropic, LangChain, LlamaIndex etc.):
```bash
OPENAI_API_BASE=https://gateway.seudominio.com/v1
OPENAI_API_KEY=sk-virtual-key-do-modulo-x
```

### 10.4 Exemplo de configuração de modelos
```yaml
model_list:
  - model_name: claude-code
    litellm_params:
      model: anthropic/claude-sonnet-4-5
      api_key: os.environ/ANTHROPIC_API_KEY

  - model_name: gemini-pro
    litellm_params:
      model: gemini/gemini-2.5-pro
      api_key: os.environ/GEMINI_API_KEY

  - model_name: openrouter-auto
    litellm_params:
      model: openrouter/openai/gpt-5.1
      api_key: os.environ/OPENROUTER_API_KEY

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  database_url: postgresql://...
```

### 10.5 Implantação recomendada
- Deploy do **BerriAI/litellm** via Docker + PostgreSQL + Redis.
- Atrás de Nginx/Cloudflare com TLS.
- Restrição de IPs no gateway/Cloudflare quando aplicável.
- Uma virtual key distinta por webapp, módulo, ambiente e cliente.
- **Infisical** para segredos fora do universo LLM.

---

## 11. CUSTOS E CONSUMO DE API (VISÃO GERAL)

- O dashboard de custos da plataforma (consolidado na aba de Configurações de APIs, seção 10) deve exibir **preview de custo e consumo em tempo real** enquanto o usuário programa, para todas as APIs de LLM usadas (OpenRouter, Google Gemini, Anthropic, OpenAI, DeepSeek).
- Repositórios de APIs gratuitas (public-apis/public-apis e o repositório já identificado pelo usuário) devem ser incorporados como fontes de descoberta dentro do mesmo módulo.

---

## 12. INTEGRAÇÃO GERAL DO ECOSSISTEMA

- Todas as abas (MCPs, Telegram, Configurações de APIs, Agentes, Prompts, Chats) devem consumir o **mesmo barramento de eventos (event bus)** do Agente Orquestrador.
- Toda ação disparada em qualquer aba deve gerar entrada no **log central de auditoria** e, quando aplicável, no módulo de **Configurações de APIs/Custos**.
- Seguir um único padrão de autenticação e permissões em toda a plataforma.
- O Agente Orquestrador deve ter **acesso direto e irrestrito aos MCPs e terminais** da máquina para gerenciar o ciclo de vida de processos conforme a necessidade do desenvolvimento, podendo delegar essa função a **subagentes especializados** quando necessário, sem perder a visão geral do estado do projeto. Ações destrutivas sobre processos seguem a política de permissão da seção 14.3.
- O Agente Orquestrador também deve ter acesso ao módulo de Configurações de APIs para selecionar automaticamente o provedor/modelo mais adequado por tarefa, respeitando orçamentos e allowlists definidos pelo usuário.

---

## 13. ENTREGÁVEIS ESPERADOS DO AGENTE DE DESENVOLVIMENTO

1. Arquitetura modular documentada (`ARCHITECTURE.md` + diagrama Mermaid).
2. Infográfico dos pontos cruciais da aplicação.
3. Relatório de viabilidade, mercado e tempo (em %) antes do início de cada módulo.
4. Módulos testados e validados sequencialmente, integrados via MCP/API REST.
5. Relatórios de segurança/pentest por módulo, com plano de correção.
6. Gateway LiteLLM implantado e configurado (Docker + PostgreSQL + Redis), com virtual keys por módulo/agente.
7. Dashboard de custos de API em tempo real, consolidado por provedor, agente e módulo.
8. Secret manager (Infisical ou equivalente) configurado para credenciais não-LLM.
9. Abas MCPs, Telegram e Configurações de APIs funcionais e integradas ao event bus central.
10. Registro central de MCPs (`mcp-registry.json`) e subagente "Port & Process Guardian" funcionando com política de permissão (seção 14).

---

## 14. MCPs NATIVOS E GESTÃO DE CONFLITOS DE PORTAS

### 14.1 MCPs nativos (instalados por padrão)

| Categoria | MCP | Função no HERMES | Prioridade |
|---|---|---|---|
| Documentação | Context7 (`upstash/context7`) | Docs atualizadas de libs/frameworks, evita código com API obsoleta | Essencial |
| Raciocínio | Sequential Thinking (`modelcontextprotocol/servers`) | Decomposição de tarefas complexas pelo orquestrador | Essencial |
| Memória/contexto | Memory (`modelcontextprotocol/servers`) | Grafo de conhecimento persistente (anti-amnésia) | Essencial |
| Contexto de código | Repomix (modo `--mcp`) | Compacta a codebase para os agentes | Essencial |
| Arquivos | Filesystem (`modelcontextprotocol/servers`) | Leitura/escrita restrita a diretórios permitidos | Essencial |
| Versionamento | GitHub MCP (`github/github-mcp-server`) + Git | Repos, PRs, issues, commits | Essencial |
| Terminal/processos | Desktop Commander | Terminal, processos e arquivos; base do Subagente de Infraestrutura | Essencial |
| Testes E2E | Playwright MCP (`microsoft/playwright-mcp`) | Agente de testes controla o navegador | Essencial |
| Debug front-end | Chrome DevTools MCP | Console, rede e performance | Alta |
| Segurança | Semgrep MCP | SAST dentro do fluxo do agente de segurança | Alta |
| Segredos | TruffleHog (via wrapper MCP/CLI) | Varredura de segredos vazados | Alta |
| Containers | Docker MCP | Subir/derrubar serviços, gerir o gateway LiteLLM | Alta |
| Banco de dados | Postgres/SQLite MCP | Inspeção de schema e queries | Alta |
| Busca web | Brave Search ou Tavily | Pesquisa de mercado e viabilidade | Alta |
| Fetch | Fetch MCP | Leitura de páginas/docs | Média |
| Observabilidade | Sentry MCP | Erros em produção para o agente corrigir | Média |
| Design | Figma MCP | Referências de UI/UX | Média |
| Backend as a service | Supabase MCP | Se o projeto usar Supabase | Opcional |
| Interno HERMES | hermes-editors (VS Code/Cursor/Windsurf/Antigravity), hermes-process-manager, hermes-telegram, hermes-gateway (LiteLLM) | MCPs próprios do ecossistema | Essencial |

- Cada MCP deve ter um manifesto (nome, comando de start, porta/transporte, dependências, nível de risco) em um registro central (`mcp-registry.json`).
- Instalação/atualização de MCPs de terceiros sempre com pinagem de versão e confirmação do usuário.
- Antes de fixar cada MCP no projeto, o agente deve confirmar no GitHub o nome oficial do repositório e a versão atual (a lista acima é uma referência inicial, não verificada).

### 14.2 Detecção de conflitos (Subagente "Port & Process Guardian")
O Orquestrador deve criar/manter um subagente dedicado que, ANTES de iniciar qualquer servidor, MCP ou serviço (Node, Python, Docker etc.):
1. Faça inventário de portas e processos ativos (psutil/netstat/lsof/ss) e compare com as portas exigidas pelo registro de MCPs e pela árvore de módulos do projeto.
2. Detecte: (a) porta já ocupada, (b) dois MCPs/serviços reivindicando a mesma porta, (c) instância duplicada do mesmo MCP, (d) processos órfãos/zumbis de execuções anteriores, (e) conflito de transporte (stdio vs HTTP/SSE).
3. Classifique cada conflito: BAIXO (processo órfão do próprio HERMES), MÉDIO (outro serviço do projeto), ALTO (processo de sistema ou fora do HERMES).
4. Proponha resoluções, em ordem de preferência: realocar a porta do novo serviço > reutilizar a instância existente > encerrar o processo conflitante.

### 14.3 Política de permissão (obrigatória)
- O agente NUNCA encerra, reinicia ou desativa um processo/MCP sem aprovação explícita do usuário, exceto processos órfãos criados pelo próprio HERMES na sessão atual (e ainda assim com registro em log).
- O pedido de permissão deve mostrar: nome, PID, porta, comando original, quem o iniciou, impacto previsto e alternativa (ex.: mudar a porta).
- Opções ao usuário: Aprovar uma vez / Aprovar sempre para este processo / Negar / Usar porta alternativa.
- Processos de nível ALTO exigem confirmação dupla e nunca podem ser marcados como "aprovar sempre".
- Notificação do pedido também via Telegram (seção 9) com botões inline de aprovar/negar; se o usuário não responder, o serviço NÃO sobe e o pedido fica na fila.
- Todas as decisões (aprovadas, negadas, automáticas) vão para o log central de auditoria.

### 14.4 Prevenção
- Alocador central de portas no hermes-process-manager: cada módulo/MCP reserva sua porta no registro; reservas persistem entre sessões.
- Health-check periódico e reconciliação entre registro e estado real da máquina.
- Antes de cada gate de qualidade entre módulos, rodar verificação de conflitos como etapa obrigatória.
