/** Logical LLM models exposed via LiteLLM (+ free-tier flags). */
export interface LlmModelOption {
  id: string;
  provider: string;
  underlying: string;
  free: boolean;
  freeVia?: string;
  costTier: '$' | '$$' | '$$$' | 'free';
  bestFor: string;
}

export const LLM_MODELS: LlmModelOption[] = [
  { id: 'claude-code', provider: 'ANTHROPIC', underlying: 'anthropic/claude-sonnet-4-5', free: false, costTier: '$$$', bestFor: 'Código complexo, arquitetura' },
  { id: 'claude-fast', provider: 'ANTHROPIC', underlying: 'anthropic/claude-haiku-3-5', free: false, costTier: '$', bestFor: 'Respostas rápidas, Telegram' },
  { id: 'gemini-pro', provider: 'GEMINI', underlying: 'gemini/gemini-2.5-pro', free: false, costTier: '$$', bestFor: 'Raciocínio longo, contexto gigante' },
  { id: 'gemini-flash', provider: 'GEMINI', underlying: 'gemini/gemini-2.0-flash', free: false, costTier: '$', bestFor: 'Rápido e barato' },
  { id: 'gemini-flash-free', provider: 'GEMINI', underlying: 'gemini/gemini-2.0-flash', free: true, freeVia: 'Gemini free tier (AI Studio)', costTier: 'free', bestFor: 'Gratuito dentro da cota' },
  { id: 'openrouter-auto', provider: 'OPENROUTER', underlying: 'openrouter/openai/gpt-5.1', free: false, costTier: '$$', bestFor: 'Auto-seleção custo/qualidade' },
  { id: 'openrouter-vision-free', provider: 'OPENROUTER', underlying: 'openrouter/google/gemini-2.0-flash-exp:free', free: true, freeVia: 'OpenRouter :free', costTier: 'free', bestFor: 'Visão gratuita, computer use' },
  { id: 'openrouter-deepseek-free', provider: 'OPENROUTER', underlying: 'openrouter/deepseek/deepseek-r1:free', free: true, freeVia: 'OpenRouter :free', costTier: 'free', bestFor: 'Raciocínio gratuito (R1)' },
  { id: 'openrouter-llama-free', provider: 'OPENROUTER', underlying: 'openrouter/meta-llama/llama-3.3-70b-instruct:free', free: true, freeVia: 'OpenRouter :free', costTier: 'free', bestFor: 'Gratuito, uso geral' },
  { id: 'openrouter-qwen-free', provider: 'OPENROUTER', underlying: 'openrouter/qwen/qwen3-235b-a22b:free', free: true, freeVia: 'OpenRouter :free', costTier: 'free', bestFor: 'Gratuito, código e chat' },
  { id: 'openrouter-mistral-free', provider: 'OPENROUTER', underlying: 'openrouter/mistralai/mistral-small-3.1-24b-instruct:free', free: true, freeVia: 'OpenRouter :free', costTier: 'free', bestFor: 'Gratuito, leve e rápido' },
  { id: 'deepseek-code', provider: 'DEEPSEEK', underlying: 'deepseek/deepseek-coder', free: false, costTier: '$', bestFor: 'Código, custo mínimo' },
  { id: 'gpt-main', provider: 'OPENAI', underlying: 'openai/gpt-4.1', free: false, costTier: '$$$', bestFor: 'Qualidade máxima OpenAI' },
  { id: 'gpt-mini', provider: 'OPENAI', underlying: 'openai/gpt-4.1-mini', free: false, costTier: '$', bestFor: 'Rápido e barato OpenAI' },
  { id: 'nvidia-llama', provider: 'NVIDIA', underlying: 'nvidia_nim/meta/llama-3.3-70b-instruct', free: false, costTier: '$', bestFor: 'Inferência rápida NVIDIA' },
  { id: 'vertex-gemini', provider: 'VERTEX_AI', underlying: 'vertex_ai/gemini-2.0-flash-001', free: false, costTier: '$$', bestFor: 'Gemini via GCP (auditoria)' },
  // ─── OmniRoute: gateway local que auto-rota entre 150+ provedores gratuitos.
  // Custo zero real: ele faz fallback por dezenas de providers grátis, então é o
  // destino natural para agentes secundários e tarefas de baixa criticidade.
  // NOTA: roteadores `auto/*` estão com pool esgotado no OmniRoute local
  //   (400/503 em auto/chat, auto/cheap, auto/fast, auto/best-coding — testado);
  //   apenas `kr/auto` (Kiro free) responde 200. underlying usa kr/auto até
  //   provedores free serem conectados no dashboard do OmniRoute.
  { id: 'omniroute-fast', provider: 'OMNIROUTE', underlying: 'openai/kr/auto', free: true, freeVia: 'OmniRoute kr/auto (Kiro free)', costTier: 'free', bestFor: 'Respostas rápidas de baixa criticidade' },
  { id: 'omniroute-code', provider: 'OMNIROUTE', underlying: 'openai/kr/auto', free: true, freeVia: 'OmniRoute kr/auto (Kiro free)', costTier: 'free', bestFor: 'Código via melhor modelo grátis disponível' },
  { id: 'omniroute-chat', provider: 'OMNIROUTE', underlying: 'openai/kr/auto', free: true, freeVia: 'OmniRoute kr/auto (Kiro free)', costTier: 'free', bestFor: 'Chat geral, melhor modelo grátis' },
  { id: 'omniroute-cheap', provider: 'OMNIROUTE', underlying: 'openai/kr/auto', free: true, freeVia: 'OmniRoute kr/auto (Kiro free)', costTier: 'free', bestFor: 'Custo zero, delegação de agentes secundários' },
  { id: 'omniroute-reasoning', provider: 'OMNIROUTE', underlying: 'openai/kr/auto', free: true, freeVia: 'OmniRoute kr/auto (Kiro free)', costTier: 'free', bestFor: 'Raciocínio via melhor modelo grátis' },
  // ─── Cheaper Inference (PAGO, api.cheaperinference.com) — tarefas CRÍTICAS ─
  // Catálogo REAL verificado via GET /v1/models (98 modelos, pricing próprio,
  // ~35% off list). Quase todos com capability vision:true.
  { id: 'cheaper-opus', provider: 'CHEAPER_INFERENCE', underlying: 'openai/claude-opus-5.5', free: false, costTier: '$$$', bestFor: 'CRÍTICO — máxima qualidade (Opus 5.5, 1M ctx, vision; $2.64/M in)' },
  { id: 'cheaper-code', provider: 'CHEAPER_INFERENCE', underlying: 'openai/claude-sonnet-5.5', free: false, costTier: '$$', bestFor: 'CRÍTICO — código/arquitetura (Sonnet 5.5, 1M ctx, vision; $1.30/M in)' },
  { id: 'cheaper-fast', provider: 'CHEAPER_INFERENCE', underlying: 'openai/claude-haiku-5.5', free: false, costTier: '$', bestFor: 'CRÍTICO — rápido (Haiku 5.5, vision; $0.065/M in)' },
  { id: 'cheaper-reason', provider: 'CHEAPER_INFERENCE', underlying: 'openai/grok-4.7', free: false, costTier: '$$', bestFor: 'CRÍTICO — raciocínio longo (Grok 4.7, 500K ctx, vision)' },
  { id: 'cheaper-vision', provider: 'CHEAPER_INFERENCE', underlying: 'openai/gemini-3.8-flash', free: false, costTier: '$', bestFor: 'Visão barata (Gemini 3.8 Flash, vision; $0.49/M in)' },
];

export interface RouteTarget {
  id: string;
  label: string;
  kind: 'agent' | 'service';
  defaultModel: string;
}

export const ROUTE_TARGETS: RouteTarget[] = [
  // ─── Agentes PRIMÁRIOS / críticos → Cheaper Inference (pago, qualidade) ───
  // Caem para os gratuitos locais apenas se CHEAPER_INFERENCE_API_KEY não existir.
  { id: 'orchestrator', label: 'Orquestrador principal', kind: 'agent', defaultModel: 'cheaper-opus' },
  { id: 'coder', label: 'Agente CODER', kind: 'agent', defaultModel: 'cheaper-code' },
  { id: 'security', label: 'Agente SECURITY', kind: 'agent', defaultModel: 'cheaper-fast' },
  { id: 'pentest', label: 'Agente PENTEST', kind: 'agent', defaultModel: 'cheaper-code' },
  { id: 'computer_user', label: 'Agente COMPUTER_USE', kind: 'agent', defaultModel: 'openrouter-vision-free' },
  // ─── Agentes SECUNDÁRIOS → OmniRoute (gratuito, auto-roteamento c/ fallback) ─
  { id: 'qa', label: 'Agente QA', kind: 'agent', defaultModel: 'omniroute-fast' },
  { id: 'integrator', label: 'Agente INTEGRATOR', kind: 'agent', defaultModel: 'omniroute-fast' },
  { id: 'telegram', label: 'Telegram 1-to-1', kind: 'agent', defaultModel: 'omniroute-chat' },
  // ─── Pipelines de serviço → OmniRoute (custo zero, baixa criticidade) ─────
  { id: 'svc-serpapi', label: 'Pipeline SerpAPI', kind: 'service', defaultModel: 'omniroute-fast' },
  { id: 'svc-tavily', label: 'Pipeline Tavily', kind: 'service', defaultModel: 'omniroute-fast' },
  { id: 'svc-brave', label: 'Pipeline Brave Search', kind: 'service', defaultModel: 'gemini-flash-free' },
  { id: 'svc-linkup', label: 'Pipeline Linkup', kind: 'service', defaultModel: 'omniroute-fast' },
  { id: 'svc-github', label: 'Pipeline GitHub', kind: 'service', defaultModel: 'omniroute-code' },
  { id: 'svc-media', label: 'Pipeline Mídia', kind: 'service', defaultModel: 'openrouter-vision-free' },
  { id: 'svc-finance', label: 'Pipeline Finanças', kind: 'service', defaultModel: 'omniroute-fast' },
  { id: 'svc-docs', label: 'Pipeline Docs', kind: 'service', defaultModel: 'omniroute-cheap' },
];
