/**
 * embeddings — geração de vetores para a memória de contexto.
 *
 * Dimensão fixa: 1536 (compatível com a coluna vector(1536) do schema).
 *  - Primário: OpenAI text-embedding-3-small (1536 nativo, barato).
 *  - Fallback: Gemini gemini-embedding-001 com output_dimensionality=1536.
 *
 * Qualquer um dos dois basta — o .env do Hermes já tem ambas as chaves.
 */

const DIM = 1536;
const TIMEOUT = 20_000;

export interface EmbeddingResult {
  vector: number[];
  provider: 'openai' | 'gemini';
}

async function embedOpenAI(text: string): Promise<number[]> {
  const key = (process.env.OPENAI_API_KEY ?? '').trim();
  if (!key) throw new Error('OPENAI_API_KEY ausente');
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`OpenAI embeddings HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json() as { data: { embedding: number[] }[] };
  const v = d.data[0]?.embedding;
  if (!v || v.length !== DIM) throw new Error(`OpenAI devolveu dim ${v?.length}, esperado ${DIM}`);
  return v;
}

async function embedGemini(text: string): Promise<number[]> {
  const key = (process.env.GEMINI_API_KEY ?? '').trim();
  if (!key) throw new Error('GEMINI_API_KEY ausente');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text: text.slice(0, 8000) }] },
      outputDimensionality: DIM,
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`Gemini embeddings HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json() as { embedding?: { values?: number[] } };
  const v = d.embedding?.values;
  if (!v || v.length !== DIM) throw new Error(`Gemini devolveu dim ${v?.length}, esperado ${DIM}`);
  return v;
}

let warned = false;

/** Gera o embedding; tenta OpenAI e cai para Gemini. Lança se ambos falharem. */
export async function embed(text: string): Promise<EmbeddingResult> {
  const clean = (text ?? '').trim();
  if (!clean) throw new Error('texto vazio para embedding');
  try {
    return { vector: await embedOpenAI(clean), provider: 'openai' };
  } catch (e1) {
    try {
      return { vector: await embedGemini(clean), provider: 'gemini' };
    } catch (e2) {
      if (!warned) {
        console.warn(`[memory] embeddings indisponíveis — openai: ${String(e1)} | gemini: ${String(e2)}`);
        warned = true;
      }
      throw new Error(`embedding falhou (openai: ${String(e1)}; gemini: ${String(e2)})`);
    }
  }
}

/** Qual provider de embedding está configurado (para /status). */
export function embeddingStatus(): { openai: boolean; gemini: boolean; dim: number } {
  return {
    openai: !!(process.env.OPENAI_API_KEY ?? '').trim(),
    gemini: !!(process.env.GEMINI_API_KEY ?? '').trim(),
    dim: DIM,
  };
}

/** Converte vetor para literal Postgres do pgvector. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => Number(x).toFixed(6)).join(',')}]`;
}
