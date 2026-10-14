/** LLM providers — part of the provider catalog (see providers-other.ts). */
export interface ProviderInfo {
  id: string;
  label: string;
  category: 'LLM' | 'SEARCH' | 'DATA' | 'MEDIA' | 'DEV' | 'MEMORY' | 'INFRA' | 'OTHER';
  envKeys: string[];
  baseUrlEnv?: string;
  defaultBaseUrl: string;
  docsUrl: string;
  ipRestriction: 'supported' | 'partial' | 'unsupported';
  ipGuide: string;
  consoleUrl: string;
}

export const LLM_PROVIDERS: ProviderInfo[] = [
  { id: 'ANTHROPIC', label: 'Anthropic (Claude)', category: 'LLM', envKeys: ['ANTHROPIC_API_KEY'], defaultBaseUrl: 'https://api.anthropic.com', docsUrl: 'https://docs.anthropic.com', ipRestriction: 'unsupported', ipGuide: 'A Anthropic não oferece restrição por IP nas API keys. Proteja com rotação periódica e teto de gasto no console.', consoleUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'GEMINI', label: 'Google Gemini', category: 'LLM', envKeys: ['GEMINI_API_KEY','GEMINI_API_KEY_ALT1','GEMINI_API_KEY_ALT2','GEMINI_API_KEY_ALT3','GEMINI_API_KEY_ALT4','GEMINI_API_KEY_ALT5','GEMINI_API_KEY_ALT6','GEMINI_API_KEY_ALT7','GEMINI_API_KEY_ALT8','GEMINI_API_KEY_ALT9','GOOGLE_API_KEY'], baseUrlEnv: 'GEMINI_API_BASE_URL', defaultBaseUrl: 'https://generativelanguage.googleapis.com', docsUrl: 'https://ai.google.dev', ipRestriction: 'supported', ipGuide: 'Google Cloud Console → APIs & Services → Credentials → sua key → Restrict key → IP addresses → adicione o IP público do servidor.', consoleUrl: 'https://console.cloud.google.com/apis/credentials' },
  { id: 'OPENROUTER', label: 'OpenRouter', category: 'LLM', envKeys: ['OPENROUTER_API_KEY','OPENROUTER_API_KEY_ALT1','OPENROUTER_API_KEY_ALT2','OPENROUTER_API_KEY_ALT3','OPENROUTER_API_KEY_ALT4','OPENROUTER_API_KEY_ALT5','OPENROUTER_API_KEY_ALT6','OPENROUTER_API_KEY_ALT7'], defaultBaseUrl: 'https://openrouter.ai/api/v1', docsUrl: 'https://openrouter.ai/docs', ipRestriction: 'partial', ipGuide: 'A OpenRouter não tem allowlist por IP na key; use limite de crédito por key e monitore Activity. Desative a key se vazar.', consoleUrl: 'https://openrouter.ai/settings/keys' },
  { id: 'OPENAI', label: 'OpenAI', category: 'LLM', envKeys: ['OPENAI_API_KEY','OPENAI_API_KEY_ALT1','OPENAI_API_KEY_ALT2','OPENAI_API_KEY_ALT3'], defaultBaseUrl: 'https://api.openai.com/v1', docsUrl: 'https://platform.openai.com/docs', ipRestriction: 'supported', ipGuide: 'platform.openai.com → API keys → sua key → Allowed IPs (projetos verificados) → adicione o IP do servidor.', consoleUrl: 'https://platform.openai.com/api-keys' },
  { id: 'DEEPSEEK', label: 'DeepSeek', category: 'LLM', envKeys: ['DEEPSEEK_API_KEY'], defaultBaseUrl: 'https://api.deepseek.com/v1', docsUrl: 'https://api-docs.deepseek.com', ipRestriction: 'unsupported', ipGuide: 'A DeepSeek não oferece restrição por IP. Use teto de saldo (pré-pago) e rotação da key.', consoleUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'VERTEX_AI', label: 'Google Vertex AI', category: 'LLM', envKeys: ['VERTEX_AI_API_KEY'], baseUrlEnv: 'VERTEX_AI_BASE_URL', defaultBaseUrl: 'https://us-central1-aiplatform.googleapis.com', docsUrl: 'https://cloud.google.com/vertex-ai/docs', ipRestriction: 'supported', ipGuide: 'Via IAM + VPC Service Controls no projeto GCP: restrinja a service account por IP de origem.', consoleUrl: 'https://console.cloud.google.com/security/command-center' },
  { id: 'NVIDIA', label: 'NVIDIA Build (NIM)', category: 'LLM', envKeys: ['NVIDIA_API_KEY'], baseUrlEnv: 'NVIDIA_BUILD_BASE_URL', defaultBaseUrl: 'https://integrate.api.nvidia.com/v1', docsUrl: 'https://build.nvidia.com', ipRestriction: 'unsupported', ipGuide: 'A NVIDIA Build não tem allowlist por IP. Gere uma key por ambiente e revogue ao menor sinal de vazamento.', consoleUrl: 'https://build.nvidia.com/account/api-keys' },
];

export function maskSecret(v: string): string {
  const t = v.trim();
  if (t.length <= 8) return t.slice(0, 2) + '… [len=' + t.length + ']';
  return t.slice(0, 4) + '…' + t.slice(-2) + ' [len=' + t.length + ']';
}
