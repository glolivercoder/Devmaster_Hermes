/**
 * code-map — Gerador de mapas de código (Archify) do Orquestrador.
 *
 * Integr a skill oficial tt-a1i/archify (instalada em .opencode/skills/archify)
 * para manter MEMÓRIA DE CONTEXTO arquitetura→código:
 *
 *   1. Coleta a árvore do repositório do alvo + arquivos-chave (limitados).
 *   2. O LLM do gateway gera o candidate JSON IR do Archify (tipo architecture),
 *      seguindo o contrato do SKILL.md (schema + exemplo + defaults embutidos).
 *   3. CLI Archify valida e entrega: finalize … --quality showcase --json
 *      (até 2 rodadas de reparo, conforme limite do contrato da skill).
 *   4. HTML final em data/code-maps/<alvo>.html + digest em <alvo>.meta.json.
 *
 * O digest (título, componentes, conexões, fronteiras) é injetado no contexto do
 * runOrchestrator (switch mapaCodigo) — o orquestrador "lembra" a arquitetura a
 * cada run sem reler o código inteiro.
 */
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync,
} from 'node:fs';
import { join, relative, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getGateway, getVirtualKey } from '../gateway/gateway-singleton.js';
import { resolveModel } from '../llm/routing-store.js';
import { PROJECTS_ROOT } from './project-store.js';

const execFileP = promisify(execFile);

const SKILL_DIR = join(process.cwd(), '.opencode', 'skills', 'archify');
const CLI = join(SKILL_DIR, 'bin', 'archify.mjs');
const OUT_DIR = join(process.cwd(), 'data', 'code-maps');
const WORK_ROOT = join(OUT_DIR, 'work');

/** Árvore: ignora diretórios pesados/gerados. */
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'temp', 'tmp', 'logs', 'coverage',
  '.next', '.nuxt', '.cache', '__pycache__', '.venv', 'venv', 'data',
  '.opencode', 'work', 'archify-clone',
]);

/** Limite de entradas da árvore (protege o contexto do LLM). */
const MAX_TREE_ENTRIES = 320;
/** Tamanho máximo de cada arquivo-chave embutido no prompt. */
const MAX_KEY_FILE_CHARS = 2500;
/** Rodadas máximas de reparo do candidate (contrato Archify = 2). */
const MAX_REPAIR_ROUNDS = 2;

export interface CodeMapMeta {
  slug: string;
  title: string;
  file: string;        // nome do HTML servível em /api/code-map/<file>
  target: string;      // caminho absoluto mapeado
  project?: string;
  generatedAt: string; // ISO
  model: string;
  components: number;
  connections: number;
  boundaries: number;
}

export interface CodeMapResult extends CodeMapMeta {
  url: string;
  repairRounds: number;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Coleta do repositório (árvore + arquivos-chave)
// ---------------------------------------------------------------------------

interface RepoDigestInput {
  root: string;
  tree: string;
  keyFiles: string;
}

function walkTree(dir: string, root: string, out: string[], budget: { n: number }): void {
  if (budget.n <= 0) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch { return; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (budget.n <= 0) return;
    if (e.name.startsWith('.') && e.name !== '.env.example') continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      walkTree(abs, root, out, budget);
    } else if (e.isFile()) {
      const rel = relative(root, abs).replace(/\\/g, '/');
      out.push(rel);
      budget.n--;
      if (budget.n <= 0) return;
    }
  }
}

/** Arquivos que revelam stack/arquitetura — anexados em ordem de prioridade. */
const KEY_FILE_PATTERNS = [
  /^package\.json$/, /^README(\.[a-z]+)?\.md$/i, /^docker-compose\.ya?ml$/,
  /^tsconfig.*\.json$/, /^pyproject\.toml$/, /^Cargo\.toml$/, /^go\.mod$/,
  /^src\/index\.(ts|js)$/, /^src\/main\.(ts|js)$/, /^src\/app\.(ts|js)$/,
  /^src\/index\.html$/,
];

function collectRepoDigest(root: string): RepoDigestInput {
  const out: string[] = [];
  walkTree(root, root, out, { n: MAX_TREE_ENTRIES });
  const tree = out.join('\n');

  const keyFiles: string[] = [];
  for (const pat of KEY_FILE_PATTERNS) {
    const rel = out.find((p) => pat.test(p));
    if (!rel) continue;
    try {
      const abs = join(root, rel);
      if (!statSync(abs).isFile()) continue;
      let content = readFileSync(abs, 'utf8');
      if (content.length > MAX_KEY_FILE_CHARS) {
        content = content.slice(0, MAX_KEY_FILE_CHARS) + '\n…(truncado)';
      }
      keyFiles.push(`### ${rel}\n\`\`\`\n${content}\n\`\`\``);
    } catch { /* pula arquivo ilegível */ }
    if (keyFiles.length >= 6) break;
  }
  return { root, tree, keyFiles: keyFiles.join('\n\n') };
}

// ---------------------------------------------------------------------------
// Prompt (contrato Archify embutido: schema + exemplo + authoring defaults)
// ---------------------------------------------------------------------------

function archifyContract(): string {
  const schema = readFileSync(join(SKILL_DIR, 'schemas', 'architecture.schema.json'), 'utf8');
  const example = readFileSync(join(SKILL_DIR, 'examples', 'web-app.architecture.json'), 'utf8');
  let defaults = '';
  try {
    defaults = readFileSync(join(SKILL_DIR, 'references', 'authoring-defaults.md'), 'utf8');
  } catch { /* reference opcional */ }
  return [
    'CONTRATO ARCHIFY (diagrama tipo "architecture" — siga EXATAMENTE):',
    '<schema.json>',
    schema,
    '</schema.json>',
    '<exemplo.json>',
    example,
    '</exemplo.json>',
    defaults ? `<authoring-defaults.md>\n${defaults}\n</authoring-defaults.md>` : '',
  ].filter(Boolean).join('\n\n');
}

function buildUserPrompt(input: RepoDigestInput, hint?: string): string {
  return [
    'Gere UM candidate JSON válido do Archify (tipo "architecture") deste repositório.',
    'Mostre a arquitetura em runtime: componentes essenciais (8–14), o caminho principal de dados,',
    'dependências externas e fronteiras de confiança quando existirem. Detalhe de suporte vai em cards,',
    'NÃO em mais conexões. IDs frescos e únicos; posições em grid sem sobreposição; quality_profile "showcase".',
    hint ? `Foco pedido: ${hint}` : '',
    '',
    'ÁRVORE DE ARQUIVOS (limitada):',
    '```',
    input.tree,
    '```',
    input.keyFiles ? `ARQUIVOS-CHAVE:\n${input.keyFiles}` : '',
    '',
    'Responda APENAS com o JSON do candidate (sem markdown, sem comentários).',
  ].filter(Boolean).join('\n\n');
}

/**
 * Extrai e faz parse do JSON do LLM com defesa extra:
 *  - remove BOM/controle ilegais entre elementos (motivo clássico de
 *    "Expected ',' or ']' after array element" quando o modelo escapa errado);
 *  - vírgulas finais antes de ]/};
 *  - em falha, grava o raw em workDir p/ inspeção e rethrow com posição.
 */
function extractJson(text: string, dumpPath?: string): any {
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('LLM não devolveu JSON');
  let slice = t.slice(start, end + 1);

  const attempts = [
    slice,
    // vírgula final: {"a":1,} → {"a":1}
    slice.replace(/,(\s*[}\]])/g, '$1'),
    // remove controles (\n crua dentro de string etc.) preservando \n escapado
    slice.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''),
  ];
  for (let i = 0; i < attempts.length; i++) {
    try { return JSON.parse(attempts[i]); } catch (e) {
      if (i === attempts.length - 1) {
        if (dumpPath) {
          try { writeFileSync(dumpPath, String(text), 'utf8'); } catch { /* ok */ }
        }
        throw new Error(`JSON do LLM inválido (tentativa ${i + 1}): ${e instanceof Error ? e.message : e}${dumpPath ? ` — raw gravado em ${dumpPath}` : ''}`);
      }
    }
  }
  throw new Error('JSON do LLM inválido');
}

// ---------------------------------------------------------------------------
// Finalize via CLI Archify (validação + entrega + browser-check)
// ---------------------------------------------------------------------------

interface FinalizeOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

async function runFinalize(candidatePath: string, htmlPath: string, workDir: string): Promise<FinalizeOutcome> {
  try {
    const { stdout } = await execFileP(
      process.execPath,
      [CLI, 'finalize', 'architecture', candidatePath, htmlPath, '--quality', 'showcase', '--out-dir', workDir, '--json'],
      { cwd: workDir, timeout: 240_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
    );
    return { ok: true, stdout, stderr: '', code: 0 };
  } catch (e: any) {
    return {
      ok: false,
      stdout: String(e?.stdout ?? ''),
      stderr: String(e?.stderr ?? e?.message ?? e),
      code: typeof e?.code === 'number' ? e.code : 1,
    };
  }
}

/** Extrai um resumo acionável das falhas do finalize para o LLM reparar. */
function failureDigest(out: FinalizeOutcome): string {
  const raw = (out.stdout || out.stderr).trim();
  try {
    const j = JSON.parse(raw);
    const diags = j?.diagnostics ?? j?.evidence?.diagnostics ?? [];
    if (Array.isArray(diags) && diags.length) {
      return JSON.stringify(diags.slice(0, 12), null, 2).slice(0, 6000);
    }
    return JSON.stringify(j, null, 2).slice(0, 6000);
  } catch {
    return raw.slice(0, 4000) || `exit=${out.code}`;
  }
}

// ---------------------------------------------------------------------------
// Digest (memória de contexto injetada no orquestrador)
// ---------------------------------------------------------------------------

function buildDigest(candidate: any, meta: CodeMapMeta): string {
  const comps: any[] = Array.isArray(candidate?.components) ? candidate.components : [];
  const conns: any[] = Array.isArray(candidate?.connections) ? candidate.connections : [];
  const bounds: any[] = Array.isArray(candidate?.boundaries) ? candidate.boundaries : [];
  const cards: any[] = Array.isArray(candidate?.cards) ? candidate.cards : [];
  const label = (id: string) => comps.find((c) => c.id === id)?.label ?? id;

  const lines: string[] = [];
  lines.push(`MAPA DE ARQUITETURA DO PROJETO (Archify — "${meta.title}", gerado ${meta.generatedAt.slice(0, 10)}):`);
  lines.push(`Componentes (${comps.length}): ` + comps.map((c) => `${c.label}${c.sublabel ? ` (${c.sublabel})` : ''}`).join(' · '));
  if (conns.length) {
    lines.push(`Conexões (${conns.length}): ` + conns.map((c) => `${label(String(c.from))} → ${label(String(c.to))}${c.label ? ` [${c.label}]` : ''}`).join('; ').slice(0, 2000));
  }
  if (bounds.length) {
    lines.push(`Fronteiras: ` + bounds.map((b) => `${b.kind}: ${b.label}`).join(' · '));
  }
  if (cards.length) {
    lines.push(`Notas: ` + cards.map((c) => `${c.title}: ${(c.items ?? []).join(', ')}`).join(' | ').slice(0, 1200));
  }
  lines.push('Use este mapa como memória de contexto da arquitetura antes de propor mudanças neste projeto.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/** Resolve o caminho alvo: pasta do projeto em DevMaster, senão o próprio Hermes. */
export function resolveTarget(project?: string, targetPath?: string): string {
  if (targetPath) return targetPath;
  if (project) {
    const dir = join(PROJECTS_ROOT, project);
    if (existsSync(dir)) return dir;
  }
  return process.cwd();
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'mapa';
}

export async function generateCodeMap(opts: {
  project?: string;
  targetPath?: string;
  hint?: string;
}): Promise<CodeMapResult> {
  const started = Date.now();
  const root = resolveTarget(opts.project, opts.targetPath);
  if (!existsSync(root)) throw new Error(`caminho alvo não existe: ${root}`);

  // Só trata como "projeto" se a pasta dele existir de fato; senão o alvo é o
  // próprio Hermes (cwd) e o slug/project seguem o diretório real — evita mapa
  // de um projeto fantasma apontando p/ outro código (digest errado no run).
  const projectReal = opts.project && existsSync(join(PROJECTS_ROOT, opts.project))
    ? opts.project
    : undefined;
  const slug = slugify(projectReal || basename(root));
  mkdirSync(OUT_DIR, { recursive: true });
  // só dígitos (14 = YYYYMMDDHHmmss) — ponto final quebraria caminho no Windows
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const workDir = join(WORK_ROOT, `${slug}-${stamp}`);
  mkdirSync(workDir, { recursive: true });

  const input = collectRepoDigest(root);
  const model = await resolveModel('orchestrator');
  const virtualKey = await getVirtualKey('orchestrator');
  const gateway = getGateway();

  const contract = archifyContract();
  // O modelo às vezes para no meio do JSON (truncamento ~2KB) — retry com
  // chamada nova p/ JSON íntegro, dumpando cada raw em workDir p/ diagnóstico.
  const MAX_JSON_TRIES = 3;
  let candidate: any = null;
  let lastErr = '';
  for (let attempt = 1; attempt <= MAX_JSON_TRIES; attempt++) {
    try {
      const raw = await gateway.complete({
        model,
        virtualKey,
        maxTokens: 8192,
        temperature: attempt === 1 ? 0.3 : 0.5, // varia p/ fugir do mesmo corte
        messages: [
          { role: 'system', content: `Você é o gerador de mapas de código do HERMES ORCHESTRATOR.\n\n${contract}` },
          { role: 'user', content: buildUserPrompt(input, opts.hint) },
        ],
      }).then((r) => r.content);
      candidate = extractJson(raw, join(workDir, `raw-first-try${attempt}.txt`));
      break;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.warn(`[code-map] tentativa ${attempt}/${MAX_JSON_TRIES} falhou no JSON: ${lastErr}`);
    }
  }
  if (!candidate) throw new Error(`LLM não devolveu JSON válido em ${MAX_JSON_TRIES} tentativas — ${lastErr}`);

  // Força coerência com o pipeline (tipo/qualidade/saída).
  candidate.diagram_type = 'architecture';
  candidate.schema_version = 1;
  candidate.meta = { ...(candidate.meta || {}), quality_profile: 'showcase' };
  candidate.meta.title = candidate.meta.title || opts.project || basename(root);
  candidate.meta.output = `${slug}.html`;

  const candidatePath = join(workDir, 'candidate.json');
  const htmlFinal = join(OUT_DIR, `${slug}.html`);
  // O candidate DEVE existir antes do 1º finalize (o CLI lê o arquivo).
  writeFileSync(candidatePath, JSON.stringify(candidate, null, 2), 'utf8');

  let repairRounds = 0;
  let outcome = await runFinalize(candidatePath, htmlFinal, workDir);

  while (!outcome.ok && repairRounds < MAX_REPAIR_ROUNDS) {
    repairRounds++;
    const diag = failureDigest(outcome);
    const repaired = extractJson(await gateway.complete({
      model,
      virtualKey,
      maxTokens: 8192,
      temperature: 0.2,
      messages: [
        { role: 'system', content: `Você repara candidates JSON do Archify. ${contract}\n\nDIAGNÓSTICOS DO GATE:\n${diag}\n\nResponda APENAS com o candidate JSON corrigido, preservando o significado pedido.` },
        { role: 'user', content: JSON.stringify(candidate).slice(0, 12000) },
      ],
    }).then((r) => r.content), join(workDir, `raw-repair${repairRounds}.txt`));
    repaired.diagram_type = 'architecture';
    repaired.schema_version = 1;
    repaired.meta = { ...(repaired.meta || {}), quality_profile: 'showcase' };
    repaired.meta.title = repaired.meta.title || candidate.meta.title;
    repaired.meta.output = `${slug}.html`;
    candidate = repaired;
    writeFileSync(candidatePath, JSON.stringify(candidate, null, 2), 'utf8');
    outcome = await runFinalize(candidatePath, htmlFinal, workDir);
  }

  if (!outcome.ok) {
    writeFileSync(candidatePath, JSON.stringify(candidate, null, 2), 'utf8');
    throw new Error(`Archify finalize falhou após ${repairRounds} reparo(s): ${failureDigest(outcome).slice(0, 800)}`);
  }

  writeFileSync(candidatePath, JSON.stringify(candidate, null, 2), 'utf8');
  if (!existsSync(htmlFinal)) {
    // Alguns caminhos escrevem o HTML dentro do workDir — promove para OUT_DIR.
    const produced = join(workDir, `${slug}.html`);
    if (existsSync(produced)) copyFileSync(produced, htmlFinal);
    else throw new Error('finalize ok mas o HTML não foi encontrado');
  }

  const comps: any[] = Array.isArray(candidate.components) ? candidate.components : [];
  const conns: any[] = Array.isArray(candidate.connections) ? candidate.connections : [];
  const bounds: any[] = Array.isArray(candidate.boundaries) ? candidate.boundaries : [];
  const meta: CodeMapMeta = {
    slug,
    title: String(candidate.meta.title),
    file: `${slug}.html`,
    target: root,
    project: projectReal,
    generatedAt: new Date().toISOString(),
    model,
    components: comps.length,
    connections: conns.length,
    boundaries: bounds.length,
  };
  // Digest em arquivo separado — injeção de contexto não precisa ler o candidate.
  writeFileSync(join(OUT_DIR, `${slug}.meta.json`), JSON.stringify({
    ...meta,
    digest: buildDigest(candidate, meta),
  }, null, 2), 'utf8');

  return {
    ...meta,
    url: `/api/code-map/${encodeURIComponent(meta.file)}`,
    repairRounds,
    latencyMs: Date.now() - started,
  };
}

export function listCodeMaps(): CodeMapMeta[] {
  if (!existsSync(OUT_DIR)) return [];
  try {
    return readdirSync(OUT_DIR)
      .filter((f) => f.endsWith('.meta.json'))
      .map((f) => {
        try { return JSON.parse(readFileSync(join(OUT_DIR, f), 'utf8')) as CodeMapMeta & { digest?: string }; }
        catch { return null; }
      })
      .filter((m): m is CodeMapMeta & { digest?: string } => !!m)
      .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
  } catch { return []; }
}

export function codeMapStatus(): { skillInstalled: boolean; cliPath: string; maps: number; outDir: string } {
  return {
    skillInstalled: existsSync(CLI),
    cliPath: CLI,
    maps: listCodeMaps().length,
    outDir: OUT_DIR,
  };
}

/**
 * Bloco de contexto a injetar no runOrchestrator (switch mapaCodigo).
 * Retorna null quando o projeto ainda não tem mapa gerado.
 */
export function getCodeMapBlock(project?: string): { block: string; url: string; title: string } | null {
  // 1) mapa gerado para o projeto (slug do nome)
  if (project) {
    const metaPath = join(OUT_DIR, `${slugify(project)}.meta.json`);
    const hit = readMeta(metaPath);
    if (hit) return hit;
  }
  // 2) fallback: mapa mais recente deste alvo (ex.: gerado sem projeto)
  const maps = listCodeMaps() as Array<CodeMapMeta & { digest?: string }>;
  const match = project ? maps.find((m) => m.project === project) : maps[0];
  if (!match) return null;
  return readMeta(join(OUT_DIR, `${match.slug}.meta.json`));
}

function readMeta(path: string): { block: string; url: string; title: string } | null {
  if (!existsSync(path)) return null;
  try {
    const full = JSON.parse(readFileSync(path, 'utf8')) as CodeMapMeta & { digest?: string };
    if (!full.digest) return null;
    return { block: full.digest, url: `/api/code-map/${encodeURIComponent(full.file)}`, title: full.title };
  } catch { return null; }
}

/** Serve um HTML de mapa com validação anti-traversal (true se tratou a rota). */
export function serveCodeMapFile(file: string): { path: string } | null {
  const name = basename(file);
  if (!name.endsWith('.html') || name.includes('..')) return null;
  const path = join(OUT_DIR, name);
  if (!existsSync(path)) return null;
  return { path };
}

export { slugify as codeMapSlug };
