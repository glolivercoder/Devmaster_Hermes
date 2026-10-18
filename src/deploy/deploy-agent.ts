/**
 * deploy-agent — DeployBot: classificação de projeto, free tiers e ranking.
 *
 * Lógica 100% determinística (funções puras, sem LLM) para que a classificação
 * e o ranking sejam auditáveis e instantâneos. O LLM só entra no guia passo-a-
 * passo e no chat (deploy-routes.ts).
 *
 * Fonte dos free tiers: compilação manual out/2026 (Cloudflare, Vercel, Render,
 * Oracle…). A rota /api/deploy/refresh-tiers usa o Agente Pesquisador para
 * atualizar este catálogo quando o mercado muda (regra de comportamento do
 * DeployBot). Free tiers EXTINTOS ficam numa lista de bloqueio para nunca serem
 * recomendados (Heroku, Fly.io, Hugging Face…).
 */

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type ProjectType =
  | 'STATIC' | 'JAMSTACK' | 'SPA' | 'SSR_FULLSTACK'
  | 'BACKEND_API' | 'FULLSTACK_MONO' | 'DOCKER_APP' | 'MOBILE_DESKTOP';

export type HostingCategory = 'HOSPEDAGEM SIMPLES' | 'PLATAFORMA PaaS' | 'VPS / SERVIDOR PRIVADO';

export interface ProjectScan {
  root: string;
  files: string[];                 // arquivos de topo (máx 200)
  manifest: Record<string, any>;   // package.json parseado (ou {})
  deps: string[];                  // nome de todas as deps (deps+devDeps+imports py/go)
  frameworkConfig: string | null;  // next.config.*, vite.config.*, astro.config.*, …
  hasDockerfile: boolean;
  hasCompose: boolean;
  htmlCount: number;
  pythonCount: number;
  goMod: boolean;
  gemfile: boolean;
  serverSignal: boolean;           // createServer/.listen no entrypoint (node:http puro)
  uiDirHtml: number;               // .html em src/ui|public|static|www (frontend sem framework)
  sizeMb: number;
}

export interface ProjectProfile {
  type: ProjectType;
  typeLabel: string;
  framework: string;
  language: string;
  database: string;
  docker: boolean;
  sizeLabel: string;
  hostingCategory: HostingCategory;
  indicators: string[];   // evidências da classificação (transparência p/ o leigo)
}

export type Tier = 'A' | 'B' | 'C';

export interface FreeTier {
  name: string;
  emoji: string;
  url: string;
  tier: Tier;
  limit: string;
  strengths: string;
  weaknesses?: string;
  noCard: boolean;
  /** Categorias de projeto aceitas (filtro). */
  accepts: ProjectType[];
  /** Scores base 0-10 usados no ranking. */
  facilidade: number;   // 0-10 (10 = 1 comando / git push)
  performance: number;  // 0-10 (10 = CDN global)
}

export interface PlatformScore {
  platform: FreeTier;
  score: number;          // 0-100
  custo: number;          // 0-10
  compat: number;         // 0-10
  why: string;            // razões específicas
  warnings: string[];     // limitações relevantes
}

// ─── Módulo 1 — Classificador de projetos ────────────────────────────────────

const FW_LABELS: [RegExp, string][] = [
  [/^next$/, 'Next.js'],
  [/^@sveltejs\/kit$/, 'SvelteKit'],
  [/^nuxt$/, 'Nuxt'],
  [/^remix(\/.*)?$/, 'Remix'],
  [/^@astrojs\/?.*$/, 'Astro'],
  [/^astro$/, 'Astro'],
  [/^gatsby$/, 'Gatsby'],
  [/^react$/, 'React'],
  [/^vue$/, 'Vue'],
  [/^svelte$/, 'Svelte'],
  [/^express$/, 'Express'],
  [/^fastify$/, 'Fastify'],
  [/^koa$/, 'Koa'],
  [/^@nestjs\/core$/, 'NestJS'],
  [/^electron$/, 'Electron'],
  [/^react-native$/, 'React Native'],
  [/^@prisma\/client$/, 'Prisma'],
  [/^drizzle-orm$/, 'Drizzle'],
  [/^mongoose$/, 'MongoDB (mongoose)'],
  [/^pg$/, 'PostgreSQL'],
  [/^mysql2?$/, 'MySQL'],
  [/^ioredis$|^redis$/, 'Redis'],
  [/^better-sqlite3$|^sqlite3$/, 'SQLite'],
  [/^@supabase\/supabase-js$/, 'Supabase'],
];

function hasDep(deps: string[], pattern: RegExp): boolean {
  return deps.some(d => pattern.test(d));
}

/** Módulo 1 — classifica o projeto escaneado numa das 8 categorias. */
export function classifyProject(scan: ProjectScan): ProjectProfile {
  const { manifest, deps, frameworkConfig, hasDockerfile, hasCompose, htmlCount, pythonCount, goMod, gemfile } = scan;
  const indicators: string[] = [];

  // Linguagem predominante
  let language = 'HTML/CSS/JS';
  if (goMod) language = 'Go';
  else if (gemfile) language = 'Ruby';
  else if (pythonCount > 0 && deps.length === 0) language = 'Python';
  else if (manifest.typescript || deps.includes('typescript')) language = 'TypeScript/Node.js';
  else if (Object.keys(manifest).length > 0) language = 'Node.js';

  // Banco de dados detectado
  const DB_DEPS: [string, string][] = [
    ['pg', 'PostgreSQL'], ['mysql2', 'MySQL'], ['mysql', 'MySQL'],
    ['mongoose', 'MongoDB (mongoose)'], ['mongodb', 'MongoDB'],
    ['better-sqlite3', 'SQLite'], ['sqlite3', 'SQLite'],
    ['ioredis', 'Redis'], ['redis', 'Redis'],
    ['@supabase/supabase-js', 'Supabase'],
    ['@prisma/client', 'Prisma'], ['drizzle-orm', 'Drizzle'],
  ];
  let database = 'nenhum detectado';
  for (const [dep, label] of DB_DEPS) {
    if (deps.includes(dep)) { database = label; break; }
  }

  // Framework principal
  let framework = '—';
  for (const [pattern, label] of FW_LABELS) {
    const hit = deps.find(d => pattern.test(d));
    if (hit && !/^(pg|mysql2?|mongoose|better-sqlite3|sqlite3|ioredis|redis)$/.test(hit)) { framework = label; break; }
  }
  if (framework === '—' && pythonCount > 0) {
    const names = scan.files.map(f => f.toLowerCase());
    if (names.some(f => /requirements/.test(f))) framework = 'Python (deps em requirements.txt)';
  }

  const docker = hasDockerfile || hasCompose;
  if (hasDockerfile) indicators.push('Dockerfile presente');
  if (hasCompose) indicators.push('docker-compose presente');

  const hasPkg = Object.keys(manifest).length > 0;
  // Servidor detectado por deps clássicas OU por sinal no entrypoint
  // (projetos como o próprio Hermes usam node:http direto, sem express).
  const hasServerDep = hasDep(deps, /^(express|fastify|koa|@nestjs\/core)$/) || scan.serverSignal === true;
  const hasFrontendDep = hasDep(deps, /^(react|vue|svelte)$/);
  const isSSRFw = hasDep(deps, /^(next|nuxt|remix(\/.*)?|@sveltejs\/kit)$/);

  // ── Decisão de categoria (precedência do mais específico ao mais genérico)
  let type: ProjectType;
  let typeLabel: string;

  if (hasDep(deps, /^(react-native|electron)$/)) {
    type = 'MOBILE_DESKTOP';
    typeLabel = hasDep(deps, /^react-native$/) ? 'App mobile (React Native)' : 'App desktop (Electron)';
    indicators.push('dep de mobile/desktop detectada');
  } else if (hasDockerfile && !hasPkg && !hasServerDep && !isSSRFw) {
    type = 'DOCKER_APP';
    typeLabel = 'App containerizado (Dockerfile)';
  } else if (!hasPkg && pythonCount > 0 && !hasFrontendDep) {
    type = 'BACKEND_API';
    typeLabel = 'Backend Python';
    indicators.push(`${pythonCount} arquivos .py`);
  } else if (goMod) {
    type = 'BACKEND_API';
    typeLabel = 'Backend Go';
    indicators.push('go.mod presente');
  } else if (!hasPkg && htmlCount > 0 && !hasFrontendDep && !hasServerDep) {
    type = 'STATIC';
    typeLabel = 'Site estático (HTML/CSS/JS)';
    indicators.push(`${htmlCount} arquivos .html, sem package.json`);
  } else if (frameworkConfig && /next\.config/.test(frameworkConfig) && /output:\s*['"]export['"]/.test(readConfigHint(scan))) {
    type = 'JAMSTACK';
    typeLabel = 'JAMstack (Next.js output: export)';
    indicators.push('next.config com output: export');
  } else if (frameworkConfig && /(astro|hugo|gatsby)\.config|_config\.yml/.test(frameworkConfig)) {
    type = 'JAMSTACK';
    typeLabel = `JAMstack/SSG (${framework})`;
    indicators.push(`config de SSG: ${frameworkConfig}`);
  } else if (isSSRFw) {
    type = 'SSR_FULLSTACK';
    typeLabel = `SSR/Fullstack (${framework})`;
    indicators.push(`${framework} com rotas de API/SSR`);
  } else if (hasPkg && hasFrontendDep && !hasServerDep) {
    type = 'SPA';
    typeLabel = `SPA Frontend (${framework})`;
    indicators.push('frontend sem servidor');
  } else if (hasPkg && hasServerDep && (hasFrontendDep || scan.uiDirHtml > 0)) {
    type = 'FULLSTACK_MONO';
    typeLabel = 'Fullstack monolito (backend + frontend)';
    indicators.push(hasFrontendDep ? 'deps de servidor E de frontend' : 'servidor HTTP + UI no mesmo repo');
  } else if (hasPkg && hasServerDep) {
    type = 'BACKEND_API';
    typeLabel = `Backend API (${framework})`;
    indicators.push('deps de servidor sem frontend');
  } else if (hasPkg) {
    // package.json existe mas nada bateu → assume SPA estática (vite/webpack genérico)
    type = 'SPA';
    typeLabel = 'SPA Frontend (genérico)';
    indicators.push('package.json presente, sem servidor detectado');
  } else {
    type = 'STATIC';
    typeLabel = 'Site estático (fallback)';
    indicators.push('sem manifest detectado');
  }

  // Docker presente sem ser a categoria principal → nota em hosting
  if (docker && type !== 'DOCKER_APP') indicators.push('pode ser containerizado (Docker presente)');

  const hostingCategory = classifyHosting(type);
  const sizeLabel = scan.sizeMb >= 1024
    ? `${(scan.sizeMb / 1024).toFixed(1)} GB`
    : `${scan.sizeMb.toFixed(0)} MB`;

  return {
    type, typeLabel, framework, language, database, docker, sizeLabel,
    hostingCategory, indicators,
  };
}

function readConfigHint(scan: ProjectScan): string {
  try {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    return readFileSync(join(scan.root, scan.frameworkConfig!), 'utf8').slice(0, 2000);
  } catch { return ''; }
}

/** Módulo 2 — categoria de infraestrutura por tipo de projeto. */
export function classifyHosting(type: ProjectType): HostingCategory {
  switch (type) {
    case 'STATIC':
    case 'JAMSTACK':
    case 'SPA':
      return 'HOSPEDAGEM SIMPLES';
    case 'SSR_FULLSTACK':
    case 'BACKEND_API':
    case 'FULLSTACK_MONO':
      return 'PLATAFORMA PaaS';
    case 'DOCKER_APP':
    case 'MOBILE_DESKTOP':
    default:
      return 'VPS / SERVIDOR PRIVADO';
  }
}

// ─── Módulo 3 — Banco de free tiers (out/2026) + extintos ────────────────────

export const FREE_TIERS: FreeTier[] = [
  // Tier A — estática/CDN, sem cartão
  {
    name: 'Cloudflare Pages', emoji: '☁️', url: 'https://pages.cloudflare.com', tier: 'A',
    limit: 'Ilimitado (CDN), 500 builds/mês', strengths: 'Melhor desempenho global, Workers grátis, domínio customizado grátis',
    noCard: true, facilidade: 9, performance: 10,
    accepts: ['STATIC', 'JAMSTACK', 'SPA'],
  },
  {
    name: 'GitHub Pages', emoji: '🐙', url: 'https://pages.github.com', tier: 'A',
    limit: '1GB storage, 100GB banda/mês', strengths: 'Integração direta com o repo, zero config extra',
    noCard: true, facilidade: 8, performance: 8,
    accepts: ['STATIC', 'JAMSTACK', 'SPA'],
  },
  {
    name: 'Vercel Hobby', emoji: '▲', url: 'https://vercel.com', tier: 'A',
    limit: '100GB transfer, 1M invocações', strengths: 'Melhor p/ Next.js, deploy por git push',
    weaknesses: 'Somente uso pessoal', noCard: true, facilidade: 10, performance: 9,
    accepts: ['STATIC', 'JAMSTACK', 'SPA', 'SSR_FULLSTACK'],
  },
  {
    name: 'Netlify Free', emoji: '🌐', url: 'https://netlify.com', tier: 'A',
    limit: '300 min build, 100GB banda/mês', strengths: 'Formulários embutidos, split testing grátis',
    weaknesses: 'Sistema de créditos', noCard: true, facilidade: 9, performance: 8,
    accepts: ['STATIC', 'JAMSTACK', 'SPA'],
  },
  {
    name: 'GitLab Pages', emoji: '🔷', url: 'https://gitlab.com', tier: 'A',
    limit: 'Ilimitado', strengths: 'CI/CD integrado',
    noCard: true, facilidade: 7, performance: 8,
    accepts: ['STATIC', 'JAMSTACK', 'SPA'],
  },
  // Tier B — PaaS p/ backends
  {
    name: 'Render Free', emoji: '🟣', url: 'https://render.com', tier: 'B',
    limit: '750h instância, 5GB banda/mês, DB expira em 30d', strengths: 'Docker suportado, sem cartão de crédito',
    weaknesses: 'Dorme após 15min de idle', noCard: true, facilidade: 8, performance: 6,
    accepts: ['SSR_FULLSTACK', 'BACKEND_API', 'FULLSTACK_MONO', 'DOCKER_APP'],
  },
  {
    name: 'Railway', emoji: '🚂', url: 'https://railway.app', tier: 'B',
    limit: '$5 crédito/30d, depois $1/mês', strengths: 'DX excelente, sem cartão',
    weaknesses: 'Crédito insuficiente para uptime 24/7', noCard: true, facilidade: 9, performance: 7,
    accepts: ['SSR_FULLSTACK', 'BACKEND_API', 'FULLSTACK_MONO', 'DOCKER_APP'],
  },
  {
    name: 'Supabase', emoji: '🟦', url: 'https://supabase.com', tier: 'B',
    limit: '2 projetos, 500MB DB, 5GB banda', strengths: 'BaaS completo: Auth + Storage + Postgres grátis',
    noCard: true, facilidade: 8, performance: 7,
    accepts: ['BACKEND_API', 'FULLSTACK_MONO', 'SPA', 'SSR_FULLSTACK'],
  },
  {
    name: 'Neon Postgres', emoji: '🐘', url: 'https://neon.tech', tier: 'B',
    limit: '512MB DB, 190h compute/mês', strengths: 'Postgres serverless, branching',
    noCard: true, facilidade: 7, performance: 8,
    accepts: ['BACKEND_API', 'FULLSTACK_MONO', 'SSR_FULLSTACK'],
  },
  {
    name: 'Cloudflare Workers', emoji: '⚡', url: 'https://workers.dev', tier: 'B',
    limit: '100k req/dia, 10ms CPU/req', strengths: 'Edge compute (<1ms), sem cartão',
    weaknesses: 'Sem Node.js nativo completo', noCard: true, facilidade: 6, performance: 10,
    accepts: ['BACKEND_API', 'SPA', 'JAMSTACK', 'STATIC'],
  },
  // Tier C — VPS free (cartão)
  {
    name: 'Oracle Cloud Free', emoji: '☁️', url: 'https://oracle.com/cloud', tier: 'C',
    limit: '2 vCPU ARM, 12GB RAM, 200GB storage (Always Free)', strengths: 'Melhor VPS gratuito real, sem cobrança automática',
    weaknesses: 'Exige cartão; risco de reclamação; regiões com capacidade limitada',
    noCard: false, facilidade: 3, performance: 5,
    accepts: ['DOCKER_APP', 'BACKEND_API', 'FULLSTACK_MONO', 'SSR_FULLSTACK', 'MOBILE_DESKTOP', 'SPA', 'JAMSTACK', 'STATIC'],
  },
  {
    name: 'AWS Free Tier', emoji: '🟠', url: 'https://aws.amazon.com', tier: 'C',
    limit: 't2.micro 750h/mês por 12 meses, 30GB SSD', strengths: 'Ecossistema completo',
    weaknesses: 'Expira após 1 ano; exige cartão', noCard: false, facilidade: 3, performance: 6,
    accepts: ['DOCKER_APP', 'BACKEND_API', 'FULLSTACK_MONO', 'SSR_FULLSTACK', 'SPA', 'JAMSTACK', 'STATIC'],
  },
  {
    name: 'GCP Free Tier', emoji: '🔵', url: 'https://cloud.google.com', tier: 'C',
    limit: 'e2-micro permanente, 1vCPU 614MB', strengths: 'Sempre grátis (f1-micro)',
    weaknesses: 'RAM muito limitada; exige cartão', noCard: false, facilidade: 3, performance: 6,
    accepts: ['DOCKER_APP', 'BACKEND_API', 'SPA', 'JAMSTACK', 'STATIC'],
  },
];

/** Free tiers EXTINTOS/degradados — nunca recomendar. */
export const RETIRED_PLATFORMS = [
  { name: 'Fly.io', reason: 'Sem free tier permanente desde out/2024 (só trial 2h/7d)' },
  { name: 'Heroku', reason: 'Free tier encerrado em nov/2022' },
  { name: 'Hugging Face Spaces', reason: 'Docker/Gradio agora requer plano pago' },
  { name: 'PlanetScale Free', reason: 'Free tier encerrado (migrou p/ plano pago)' },
];

// ─── Módulo 4 — Motor de recomendação ────────────────────────────────────────

/** Ajuste de compatibilidade por combinação plataforma × tipo (0-10). */
function compatFor(p: FreeTier, type: ProjectType): number {
  // Aceite nativo do tipo = compat alto; aceite "genérico" (ex.: VPS para tudo) = médio.
  const native: Record<string, ProjectType[]> = {
    'Cloudflare Pages': ['STATIC', 'JAMSTACK', 'SPA'],
    'GitHub Pages': ['STATIC', 'JAMSTACK'],
    'Vercel Hobby': ['JAMSTACK', 'SSR_FULLSTACK', 'SPA'],
    'Netlify Free': ['JAMSTACK', 'SPA', 'STATIC'],
    'GitLab Pages': ['STATIC', 'JAMSTACK'],
    'Render Free': ['BACKEND_API', 'SSR_FULLSTACK', 'FULLSTACK_MONO'],
    'Railway': ['BACKEND_API', 'FULLSTACK_MONO', 'DOCKER_APP'],
    'Supabase': ['BACKEND_API', 'FULLSTACK_MONO'],
    'Neon Postgres': ['BACKEND_API', 'FULLSTACK_MONO'],
    'Cloudflare Workers': ['BACKEND_API', 'SPA'],
    'Oracle Cloud Free': ['DOCKER_APP', 'FULLSTACK_MONO', 'BACKEND_API'],
    'AWS Free Tier': ['BACKEND_API', 'DOCKER_APP'],
    'GCP Free Tier': ['BACKEND_API', 'DOCKER_APP'],
  };
  const list = native[p.name] ?? [];
  if (list.includes(type)) return 10;
  if (p.accepts.includes(type)) return 7;   // aceita mas não é o forte
  return 3;
}

function custoFor(p: FreeTier): number {
  if (p.tier === 'A' && p.noCard) return 10;            // 100% grátis, sem cartão
  if (p.tier === 'B' && p.noCard) return p.weaknesses ? 7 : 8;
  if (p.tier === 'B') return 6;
  return 5;                                              // Tier C: cartão + risco de cobrança
}

/**
 * SCORE = (Compat×40) + (Custo×30) + (Facilidade×20) + (Performance×10), 0-100.
 * Determinístico: mesma entrada → mesmo ranking (auditável pelo usuário leigo).
 */
export function scorePlatforms(profile: ProjectProfile, tiers: FreeTier[] = FREE_TIERS): PlatformScore[] {
  const eligible = tiers.filter(p => p.accepts.includes(profile.type));
  const scored: PlatformScore[] = eligible.map(p => {
    const compat = compatFor(p, profile.type);
    const custo = custoFor(p);
    const score = Math.round(compat * 4 + custo * 3 + p.facilidade * 2 + p.performance * 1);
    const warnings: string[] = [];
    if (p.weaknesses) warnings.push(p.weaknesses);
    if (!p.noCard) warnings.push('Exige cartão de crédito');
    const why = [
      `compatível com ${profile.typeLabel.toLowerCase()}`,
      custo >= 9 ? '100% gratuito sem cartão' : custo >= 7 ? 'gratuito com limites justos' : 'gratuito com ressalvas',
      p.facilidade >= 9 ? 'deploy em 1 comando' : p.facilidade >= 7 ? 'deploy guiado na dashboard' : 'requer config manual',
    ].join('; ');
    return { platform: p, score, custo, compat, why, warnings };
  });
  // Ordena por score; desempate pelo menor custo.
  return scored.sort((a, b) => b.score - a.score || a.custo - b.custo);
}

/** Próximos passos padrão pós-deploy (checkboxes da UI). */
export const POST_DEPLOY_STEPS = [
  'Configurar domínio customizado',
  'Monitoramento de uptime (UptimeRobot grátis, até 50 monitores)',
  'Analytics (Cloudflare Analytics ou Plausible — privacidade)',
  'Backups automáticos',
];

// ─── System prompt adaptado ao Hermes ────────────────────────────────────────

/**
 * Prompt do DeployBot — adaptado do template OpenCode para o sistema Hermes:
 *  • UI HTML (não terminal ASCII) — menus viram painéis;
 *  • tools bash/write/glob do OpenCode → command-runner (allowlist+confirmação),
 *    write-file seguro e scan de projeto do servidor;
 *  • computer_use → ComputerUseAgent real do Hermes (visão free → pago barato);
 *  • sem fixar modelo — o smart-router do Hermes escolhe (resolveModel('deploy')).
 */
export function deploySystemPrompt(profile?: ProjectProfile): string {
  const profileBlock = profile
    ? `PROJETO ANALISADO (classificação determinística, não invente outra):\n` +
      `• Tipo: ${profile.typeLabel} (${profile.type})\n` +
      `• Framework: ${profile.framework} | Linguagem: ${profile.language} | Banco: ${profile.database}\n` +
      `• Docker: ${profile.docker ? 'sim' : 'não'} | Tamanho: ${profile.sizeLabel}\n` +
      `• Categoria de hospedagem: ${profile.hostingCategory}\n` +
      `• Evidências: ${profile.indicators.join('; ')}\n`
    : '';

  return `Você é o **DeployBot**, agente especialista em deploy do Hermes Control Center.
Missão: guiar o usuário — inclusive leigos — do zero até o app publicado online,
pelo menor custo possível, com linguagem simples e passos confirmados.

${profileBlock}
REGRAS DE COMPORTAMENTO (não negociáveis):
1. Nunca pule etapas. Cada passo é confirmado antes do próximo.
2. Nunca exiba credenciais. Senhas, tokens e chaves NUNCA aparecem na saída —
   apenas o NOME da variável (ex.: "defina CLOUDFLARE_API_TOKEN").
3. Sempre confirme antes de qualquer comando com efeito colateral. O executor do
   Hermes já separa comandos em AUTO (leitura) / CONFIRM (você aprova) / DENY.
4. Linguagem de leigo: explique o "porquê" de cada passo em 1 frase simples.
5. Computer use (automação visual) SOMENTE em passos gráficos críticos — login,
   dashboard, DNS. Nunca como caminho principal; o guia textual é a base.
6. Se uma plataforma falhar 2 vezes, proponha automaticamente a próxima do ranking.
7. Atualize recomendações de free tiers quando a pesquisa indicar mudança de mercado.
8. Ao final, gere o DEPLOY_INFO.md (plataforma, URL, comandos, re-deploy, próximos passos).
9. Prefira soluções GRATUITAS sem cartão de crédito (Tier A/B) antes de sugerir VPS.

FORMATO DA RESPOSTA: a UI Hermes é HTML — NÃO use caixas ASCII/box-drawing.
Entregue listas e blocos objetivos; a interface renderiza os painéis.`;
}
