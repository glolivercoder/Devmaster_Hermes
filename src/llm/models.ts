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
];

export interface RouteTarget {
  id: string;
  label: string;
  kind: 'agent' | 'service';
  defaultModel: string;
}

export const ROUTE_TARGETS: RouteTarget[] = [
  { id: 'orchestrator', label: 'Orquestrador principal', kind: 'agent', defaultModel: 'claude-code' },
  { id: 'coder', label: 'Agente CODER', kind: 'agent', defaultModel: 'deepseek-code' },
  { id: 'security', label: 'Agente SECURITY', kind: 'agent', defaultModel: 'claude-fast' },
  { id: 'pentest', label: 'Agente PENTEST', kind: 'agent', defaultModel: 'claude-code' },
  { id: 'qa', label: 'Agente QA', kind: 'agent', defaultModel: 'gemini-flash' },
  { id: 'integrator', label: 'Agente INTEGRATOR', kind: 'agent', defaultModel: 'claude-fast' },
  { id: 'computer_user', label: 'Agente COMPUTER_USE', kind: 'agent', defaultModel: 'openrouter-vision-free' },
  { id: 'telegram', label: 'Telegram 1-to-1', kind: 'agent', defaultModel: 'deepseek-code' },
  { id: 'svc-serpapi', label: 'Pipeline SerpAPI', kind: 'service', defaultModel: 'gemini-flash' },
  { id: 'svc-tavily', label: 'Pipeline Tavily', kind: 'service', defaultModel: 'gemini-flash' },
  { id: 'svc-brave', label: 'Pipeline Brave Search', kind: 'service', defaultModel: 'gemini-flash-free' },
  { id: 'svc-linkup', label: 'Pipeline Linkup', kind: 'service', defaultModel: 'gemini-pro' },
  { id: 'svc-github', label: 'Pipeline GitHub', kind: 'service', defaultModel: 'deepseek-code' },
  { id: 'svc-media', label: 'Pipeline Mídia', kind: 'service', defaultModel: 'openrouter-vision-free' },
  { id: 'svc-finance', label: 'Pipeline Finanças', kind: 'service', defaultModel: 'gemini-flash' },
  { id: 'svc-docs', label: 'Pipeline Docs', kind: 'service', defaultModel: 'openrouter-qwen-free' },
];
