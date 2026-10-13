# ARCHITECTURE — HERMES CONTROL CENTER
Plataforma modular de orquestração de agentes de desenvolvimento, cibersegurança e automação.

```mermaid
flowchart TD
    subgraph UI ["Frontend (Next.js / Vite + React + shadcn/ui + Framer Motion)"]
        Chat["Chat Principal (Hermes Orchestrator)"]
        Sidebar["Sidebar Modular"]
        TabMCP["Aba MCPs & Processos"]
        TabTelegram["Aba Telegram"]
        TabAPI["Aba Configurações de APIs & Custos"]
        TabSecurity["Aba Auditoria & Pentest"]
    end

    subgraph Core ["Hermes Core Gateway & Event Bus (Node.js/TypeScript / Fastify)"]
        EventBus["Central Event Bus (EventEmitter / Redis PubSub)"]
        Orchestrator["Agente Orquestrador Central"]
        PortGuardian["Port & Process Guardian"]
        AuditLogger["Audit Logger & State Tracker"]
    end

    subgraph Gateway ["LiteLLM AI Gateway (Self-hosted Docker)"]
        LiteLLM["LiteLLM Proxy (Port 4000)"]
        Postgres["PostgreSQL (Virtual Keys, Limits, Budgets)"]
        Redis["Redis (Cache, Rate Limits, Queues)"]
    end

    subgraph Providers ["LLM External Providers"]
        OpenRouter["OpenRouter"]
        Anthropic["Anthropic"]
        Gemini["Google Gemini"]
        OpenAI["OpenAI"]
        DeepSeek["DeepSeek / Groq"]
    end

    subgraph Integrations ["Process & Platform Integrations"]
        MCPRegistry["MCP Registry (mcp-registry.json)"]
        EditorBridge["Editor Bridge (Cursor, Antigravity, VS Code, Windsurf)"]
        TelegramBot["Telegram Bot (grammY / BotFather)"]
        SecurityScanner["Security Scanner (Semgrep / TruffleHog)"]
    end

    Chat <--> EventBus
    Sidebar <--> EventBus
    TabMCP <--> PortGuardian
    TabTelegram <--> TelegramBot
    TabAPI <--> LiteLLM

    Orchestrator <--> EventBus
    Orchestrator <--> PortGuardian
    PortGuardian <--> MCPRegistry

    Orchestrator --> LiteLLM
    LiteLLM --> Postgres
    LiteLLM --> Redis
    LiteLLM --> Providers
    SecurityScanner --> AuditLogger
    TelegramBot <--> EventBus
```

## Módulos Principais e Dependências

1. **Módulo 00: Core Foundation & Event Bus** (Eventos, Logs de auditoria, Registry central, Tipagens).
2. **Módulo 01: LiteLLM Gateway & Virtual Keys** (Roteamento de provedores, controle de custos em tempo real, virtual keys seguras).
3. **Módulo 02: Port & Process Guardian + MCP Manager** (Inventário psutil/netstat, monitoramento de portas, ciclo de vida de MCPs).
4. **Módulo 03: Hermes Orchestrator Agent & Anti-Sycophancy Engine** (Raciocínio sequencial, personas "Advogado do Diabo", delegação para subagentes).
5. **Módulo 04: Telegram Bridge 1-to-1** (grammY bot, fila FIFO local, notificações de incidentes e gates).
6. **Módulo 05: Security, Pentest & Quality Gates** (Semgrep, TruffleHog, verificação de segredos e conformidade).
7. **Módulo 06: Frontend Dashboard & Modular Sidebar** (shadcn/ui, Framer Motion, visualização de custos, MCPs e chats).

