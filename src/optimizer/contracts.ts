/**
 * contracts — tipos e validação do Otimizador de Prompts.
 *
 * O projeto não tem Zod (só @composio/core + pg). Em vez de puxar a stack do
 * template (Next.js/Zod/AI SDK), valido com funções puras de runtime — mesmas
 * garantias, zero dependência nova. Estes são os "contratos" do pipeline.
 */

export type Severity = 1 | 2 | 3 | 4 | 5;

/** 8 critérios da Análise Fria (nota 0–10 cada). */
export const CRITERIA = [
  'clareza', 'ambiguidade', 'contexto', 'papel',
  'formato de saída', 'restrições', 'exemplos', 'critérios de sucesso',
] as const;
export type Criterion = (typeof CRITERIA)[number];

export interface Intent {
  objective: string;      // ideia central
  audience: string;       // público
  deliverable: string;    // o que deve ser entregue
  implicitConstraints: string[];  // restrições implícitas detectadas
  summary: string;        // 1–2 frases
}

export interface AnalysisIssue {
  criterion: Criterion;
  excerpt: string;   // trecho problemático do prompt original
  problem: string;
  impact: string;
  severity: Severity;
}

export interface ColdAnalysis {
  scores: Record<Criterion, number>;   // 0–10 por critério
  overallScore: number;                // média ponderada 0–10
  issues: AnalysisIssue[];             // só problemas, sem elogios
}

export interface Source {
  ref: string;      // URL ou nome de arquivo
  kind: 'web' | 'pdf' | 'context7';
  excerpt: string;  // trecho que sustenta a afirmação
}

export interface Research {
  findings: string[];   // afirmações com respaldo (cada uma citando fonte)
  sources: Source[];
}

export interface Expansion {
  applied: string;      // resultado já aplicado (não lista de sugestões)
  addedFeatures: string[];  // recursos ampliados dentro da intenção
  guardrails: string[];     // o que NÃO foi inventado (fora da intenção)
}

export interface ChangelogEntry {
  change: string;
  rationale: string;
  source?: string;   // {url|arquivo} que justifica, quando houver
}

export interface OptimizeResult {
  optimizedPrompt: string;
  diff: { before: string; after: string; changedLines: string[] };  // antes × depois + linhas alteradas
  changelog: ChangelogEntry[];
}

/** Saída completa da API /api/optimizer/optimize. */
export interface PipelineResult {
  intent: Intent;
  analysis: ColdAnalysis;
  research: Research;
  expansion: Expansion;
  optimize: OptimizeResult;
  sources: Source[];        // agregado (research + context7)
  contextUsed: { pdfs: number; urls: number; context7: number };
  model: string;
  latencyMs: number;
}

// ─── Validação de runtime (sem dependência) ────────────────────────────────
const str = (v: unknown, fb = ''): string => (typeof v === 'string' && v.trim() ? v : fb);
const strArr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
const clamp01to10 = (n: unknown): number => {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(0, Math.min(10, Math.round(x))) : 0;
};

export function sanitizeIntent(raw: any): Intent {
  return {
    objective: str(raw?.objective, ' (não extraído)'),
    audience: str(raw?.audience, 'não especificado'),
    deliverable: str(raw?.deliverable, 'não especificado'),
    implicitConstraints: strArr(raw?.implicitConstraints),
    summary: str(raw?.summary),
  };
}

export function sanitizeAnalysis(raw: any): ColdAnalysis {
  const scores = {} as Record<Criterion, number>;
  for (const c of CRITERIA) scores[c] = clamp01to10(raw?.scores?.[c]);
  const overall = CRITERIA.reduce((a, c) => a + scores[c], 0) / CRITERIA.length;
  const issues: AnalysisIssue[] = (Array.isArray(raw?.issues) ? raw.issues : [])
    .map((i: any) => ({
      criterion: (CRITERIA as readonly string[]).includes(i?.criterion) ? i.criterion as Criterion : 'clareza',
      excerpt: str(i?.excerpt),
      problem: str(i?.problem),
      impact: str(i?.impact),
      severity: Math.max(1, Math.min(5, Math.round(Number(i?.severity) || 3))) as Severity,
    }))
    .filter((i: AnalysisIssue) => i.problem);
  return { scores, overallScore: Math.round(overall * 10) / 10, issues };
}

export function sanitizeSources(raw: any): Source[] {
  return (Array.isArray(raw) ? raw : [])
    .map((s: any) => ({ ref: str(s?.ref), kind: (['web', 'pdf', 'context7'].includes(s?.kind) ? s.kind : 'web') as Source['kind'], excerpt: str(s?.excerpt) }))
    .filter((s: Source) => s.ref);
}

/** Diff de linhas simples (antes × depois) — sem lib externa. */
export function lineDiff(before: string, after: string): { changedLines: string[] } {
  const b = new Set(before.split('\n').map((l) => l.trim()).filter(Boolean));
  const a = after.split('\n').map((l) => l.trim()).filter(Boolean);
  return { changedLines: a.filter((l) => !b.has(l)).slice(0, 60) };
}
