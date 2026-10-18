/**
 * project-store — artefatos do orquestrador na pasta do projeto.
 *
 * Cada projeto vira um diretório em PROJECTS_ROOT:
 *
 *   F:\Projetos2026\DevMaster\<projeto>\
 *     prompt-original.md          prompt original de cada run (append c/ timestamp)
 *     historico.jsonl             índice de cada run (ts, model, switches, arquivos)
 *     runs/<ts>/resposta-orquestrador.md     resposta LLM da rodada
 *     runs/<ts>/pesquisa-avancada.md         (só com pesquisaAvancada ON)
 *     runs/<ts>/analise-mercado.md           (só com analiseMercado ON)
 *     runs/<ts>/site-crm.md                  (só com siteCrm ON)
 *     runs/<ts>/site-profissional.md         (só com siteProfissional ON)
 *
 * Regras:
 *  - Nunca derruba o run: o chamador envolve em try/catch e só expõe `saved`
 *    quando a gravação deu certo.
 *  - Nome do diretório = mesma chave normalizada da memória de projeto
 *    (normProject) + chars inválidos de Windows trocados por '-'.
 *  - Leitura com guarda de path traversal (resolve + prefixo do root).
 */
import {
  appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const PROJECTS_ROOT = 'F:\\Projetos2026\\DevMaster';

/** Nome de diretório seguro para o projeto (chave estável igual à da memória). */
export function projectDirName(project: string): string {
  const slug = (project || 'default')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
  return slug || 'default';
}

interface SourceRef {
  title: string;
  url: string;
  scraped?: boolean;
}

export interface RunArtifacts {
  project: string;
  prompt: string;
  reply: string;
  model: string;
  latencyMs: number;
  switches: {
    pesquisaAvancada: boolean;
    analiseMercado: boolean;
    siteCrm: boolean;
    siteProfissional: boolean;
  };
  /** Só quando pesquisaAvancada ON (synthesis ausente + failed = pesquisa falhou). */
  research?: {
    query?: string;
    searchProvider?: string;
    synthesis?: string;
    sources?: SourceRef[];
    failed?: string;
  };
  /** Só quando analiseMercado ON (failed = análise falhou). */
  market?: {
    dashboardPath?: string;
    executiveSummary?: string;
    verdict?: string;
    strengths?: string[];
    weaknesses?: string[];
    opportunities?: string[];
    threats?: string[];
    competitors?: Array<{ name: string; sharePercent?: number }>;
    reddit?: { painPoints?: string[]; requestedFeatures?: string[] };
    sources?: Array<{ title: string; url: string }>;
    failed?: string;
  };
}

export interface SavedRun {
  folder: string;
  files: string[];
}

function isoTs(d = new Date()): string {
  return d.toISOString();
}

/** Nome de subpasta de run ordenável por tempo: 2026-10-18T23-12-05-123Z */
function runSlug(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export function saveRunArtifacts(a: RunArtifacts): SavedRun {
  const root = join(PROJECTS_ROOT, projectDirName(a.project));
  const ts = isoTs();
  const runRel = runSlug();
  const runDir = join(root, 'runs', runRel);
  mkdirSync(runDir, { recursive: true });

  const files: string[] = [];
  const runDirRel = `runs/${runRel}`;
  const write = (rel: string, content: string): void => {
    writeFileSync(join(root, rel), content, 'utf8');
    files.push(rel);
  };

  // 1) Prompt original do projeto (append — histórico acumulado).
  appendFileSync(
    join(root, 'prompt-original.md'),
    `## ${ts} - ${a.model}\n\n${a.prompt}\n\n---\n\n`,
    'utf8',
  );
  files.push('prompt-original.md');

  // 2) Resposta completa do orquestrador desta rodada.
  const capsOn = Object.entries(a.switches)
    .filter(([, on]) => on)
    .map(([k]) => k)
    .join(', ') || 'nenhuma';
  write(
    `${runDirRel}/resposta-orquestrador.md`,
    [
      '# Resposta do Hermes Orquestrador',
      '',
      `- **Projeto:** ${a.project}`,
      `- **Data:** ${ts}`,
      `- **Modelo:** ${a.model} - ${a.latencyMs}ms`,
      `- **Capacidades ativas:** ${capsOn}`,
      `- **Prompt original:** ver \`prompt-original.md\` (mesmo timestamp)`,
      '',
      '---',
      '',
      a.reply,
      '',
    ].join('\n'),
  );

  // 3) Saida por capacidade - so com o checkbox correspondente ON.
  if (a.switches.pesquisaAvancada) {
    const r = a.research;
    const fontes = r?.sources?.length
      ? r.sources
          .map((s, i) => `${i + 1}. [${s.title || s.url}](${s.url})${s.scraped ? '' : ' - so snippet'}`)
          .join('\n')
      : '(nenhuma fonte coletada)';
    write(
      `${runDirRel}/pesquisa-avancada.md`,
      [
        '# Pesquisa avancada - ' + ts,
        '',
        `- **Query:** ${r?.query ?? a.prompt.slice(0, 200)}`,
        `- **Provider de busca:** ${r?.searchProvider ?? '-'}`,
        '',
        r?.failed
          ? `> AVISO: **Pesquisa falhou nesta rodada:** ${r.failed}\n> O orquestrador respondeu com o conhecimento do modelo e declarou a limitacao.`
          : `## Sintese\n\n${r?.synthesis ?? '(sem sintese - ver aviso no log)'}`,
        '',
        '## Fontes',
        '',
        fontes,
        '',
      ].join('\n'),
    );
  }

  if (a.switches.analiseMercado) {
    const m = a.market;
    const secao = (titulo: string, itens?: string[]): string[] =>
      ['', `## ${titulo}`, '', ...(itens?.length ? itens.map((s) => `- ${s}`) : ['- (nenhum)'])];
    const corpo = m
      ? [
          '## Resumo executivo', '', m.executiveSummary ?? '-', '',
          '## Veredito (anti-sicofantia)', '', m.verdict ?? '-', '',
          ...secao('Fortes', m.strengths),
          ...secao('Fracos', m.weaknesses),
          '',
          '## Concorrentes', '',
          ...(m.competitors?.length
            ? m.competitors.map((c) => `- ${c.name}${c.sharePercent != null ? ` - ${c.sharePercent}%` : ''}`)
            : ['- (nenhum)']),
          ...secao('Oportunidades', m.opportunities),
          ...secao('Ameacas', m.threats),
          '',
          '## Voz do usuario (Reddit)', '',
          `**Dores:** ${m.reddit?.painPoints?.join(' | ') || '-'}`, '',
          `**Pedidos:** ${m.reddit?.requestedFeatures?.join(' | ') || '-'}`, '',
          '## Dashboard HTML interativo', '',
          m.dashboardPath ? `\`${m.dashboardPath}\` (aba Previews)` : '(nao gerado)', '',
          '## Fontes', '',
          m.sources?.length ? m.sources.map((s) => `- [${s.title}](${s.url})`).join('\n') : '- (nenhuma)',
          '',
        ]
      : [];
    write(
      `${runDirRel}/analise-mercado.md`,
      [
        '# Analise de Mercado - ' + ts,
        '',
        m?.failed ? `> AVISO: **Analise de mercado falhou:** ${m.failed}` : corpo.join('\n'),
        '',
      ].join('\n'),
    );
  }

  if (a.switches.siteCrm) {
    write(
      `${runDirRel}/site-crm.md`,
      [
        '# Site com CRM - resposta do orquestrador - ' + ts,
        '',
        'Capacidade ativa (referencias Odoo + Twenty: modulos/ORM, auth/roles, pipeline Kanban).',
        'A resposta completa da rodada esta em `resposta-orquestrador.md`; segue o texto integral:',
        '',
        '---',
        '',
        a.reply,
        '',
      ].join('\n'),
    );
  }

  if (a.switches.siteProfissional) {
    write(
      `${runDirRel}/site-profissional.md`,
      [
        '# Site Profissional - resposta do orquestrador - ' + ts,
        '',
        'Capacidade ativa (DESIGN.md + shadcn/ui + Tailwind v4 + Motion/GSAP + Figma MCP).',
        'A resposta completa da rodada esta em `resposta-orquestrador.md`; segue o texto integral:',
        '',
        '---',
        '',
        a.reply,
        '',
      ].join('\n'),
    );
  }

  // 4) Indice do historico (uma linha JSON por run).
  appendFileSync(
    join(root, 'historico.jsonl'),
    JSON.stringify({
      ts,
      model: a.model,
      latencyMs: a.latencyMs,
      switches: a.switches,
      promptChars: a.prompt.length,
      replyChars: a.reply.length,
      runDir: runDirRel,
      files,
    }) + '\n',
    'utf8',
  );

  return { folder: root, files };
}

// ---------------------------------------------------------------------------
// Leitura (aba Historico)
// ---------------------------------------------------------------------------

export interface ProjectSummary {
  name: string;
  path: string;
  runs: number;
  updatedAt: string;
  files: string[]; // caminhos relativos (.md/.jsonl); runs mais novos primeiro
}

function walkFiles(dir: string, base: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    const abs = join(dir, e.name);
    if (e.isDirectory()) walkFiles(abs, rel, out);
    else if (/\.(md|jsonl|txt|json)$/.test(e.name)) out.push(rel);
  }
}

export function listProjects(): ProjectSummary[] {
  if (!existsSync(PROJECTS_ROOT)) return [];
  const out: ProjectSummary[] = [];
  for (const e of readdirSync(PROJECTS_ROOT, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const path = join(PROJECTS_ROOT, e.name);
    // So diretorios criados pelo orquestrador — evita listar pastas alheias da raiz.
    if (!existsSync(join(path, 'historico.jsonl')) && !existsSync(join(path, 'prompt-original.md'))) continue;
    const files: string[] = [];
    walkFiles(path, '', files);
    // prompt-original.md primeiro; depois runs (nomes ISO → descendente = mais novo).
    files.sort((a, b) => {
      const ap = a === 'prompt-original.md' ? -1 : 0;
      const bp = b === 'prompt-original.md' ? -1 : 0;
      return ap - bp || b.localeCompare(a);
    });
    const runsDir = join(path, 'runs');
    let runs = 0;
    try {
      runs = readdirSync(runsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
    } catch { /* sem runs ainda */ }
    let updatedAt = new Date(0).toISOString();
    try {
      updatedAt = statSync(join(path, 'historico.jsonl')).mtime.toISOString();
    } catch {
      try { updatedAt = statSync(path).mtime.toISOString(); } catch { /* ok */ }
    }
    out.push({ name: e.name, path, runs, updatedAt, files });
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

export function readProjectFile(project: string, file: string): string {
  const root = resolve(PROJECTS_ROOT, projectDirName(project));
  const target = resolve(root, file);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error('caminho fora da pasta do projeto');
  }
  if (!/\.(md|jsonl|txt|json)$/.test(target)) throw new Error('extensao nao permitida');
  if (!existsSync(target)) throw new Error('arquivo nao encontrado');
  return readFileSync(target, 'utf8');
}
