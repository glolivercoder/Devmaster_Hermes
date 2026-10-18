/**
 * deploy-routes — API do Deploy Agent (aba 🚀 DEPLOY Agent).
 *
 * POST /api/deploy/analyze          {path?}              → escaneia e classifica o projeto
 * POST /api/deploy/recommend        {profile}            → ranking de plataformas (score 0-100)
 * POST /api/deploy/guide            {profile, platform}  → plano passo-a-passo via LLM
 * POST /api/deploy/computer-use     {goal, step?}        → ação visual real (ComputerUseAgent)
 * GET  /api/deploy/computer-use/screenshot               → screenshot ao vivo p/ o painel
 * POST /api/deploy/run-command      {command, confirm?}  → executor allowlist/confirm/deny
 * POST /api/deploy/verify           {url}                → status HTTP + tempo (pós-deploy)
 * POST /api/deploy/write-file       {path, content, confirm:true} → grava DEPLOY_INFO.md etc.
 * POST /api/deploy/refresh-tiers    {query?}             → researcher atualiza free tiers
 * POST /api/deploy/chat             {message, project?}  → conversa com DeployBot (com memória)
 *
 * Segurança: scan e escrita confinados sob DEPLOY_ROOT/PREVIEW_ROOT (anti-traversal);
 * comandos no command-runner (deny-by-default); nada de credenciais nas respostas.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { resolve, sep, join, basename } from 'node:path';
import { getGateway, getVirtualKey } from '../gateway/gateway-singleton.js';
import { resolveModel } from '../llm/routing-store.js';
import { ComputerUseAgent } from '../computer-use/computer-agent.js';
import { searchWeb } from '../research/researcher.js';
import { structuredJson } from '../optimizer/pipeline.js';
import { continuityBlock, remember, normProject } from '../memory/project-memory.js';
import { auditLogger } from '../core/audit-logger.js';
import {
  classifyProject, scorePlatforms, deploySystemPrompt, FREE_TIERS, RETIRED_PLATFORMS, POST_DEPLOY_STEPS,
  type ProjectScan, type ProjectProfile, type FreeTier,
} from './deploy-agent.js';
import { runCommand, classifyCommand, type CommandResult } from './command-runner.js';

const ROOT = resolve(process.env.DEPLOY_ROOT || process.env.PREVIEW_ROOT || process.cwd());

// ─── Safe path (anti-traversal, mesmo critério do preview-routes) ────────────

function safeResolve(rel: string): string {
  const abs = resolve(ROOT, rel || '.');
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) {
    throw new Error(`path fora da raiz permitida (${ROOT})`);
  }
  return abs;
}

// ─── Scan do projeto ─────────────────────────────────────────────────────────

const FW_CONFIG_RE = /^(next|vite|astro|gatsby|nuxt|svelte|remix|webpack|rollup|parcel)\.config\.(js|ts|mjs|cjs)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', 'dist', 'build', 'out', 'coverage', '.next', '.turbo']);

async function scanProject(rel = ''): Promise<ProjectScan> {
  const root = safeResolve(rel);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  let htmlCount = 0;
  let pythonCount = 0;
  let hasDockerfile = false;
  let hasCompose = false;
  let frameworkConfig: string | null = null;

  for (const e of entries) {
    if (files.length >= 300) break;
    if (e.isDirectory()) { files.push(`${e.name}/`); continue; }
    files.push(e.name);
    const lower = e.name.toLowerCase();
    if (lower === 'dockerfile') hasDockerfile = true;
    if (/^docker-compose\.(yml|yaml)$/.test(lower)) hasCompose = true;
    if (lower.endsWith('.html')) htmlCount++;
    if (lower.endsWith('.py')) pythonCount++;
    if (FW_CONFIG_RE.test(e.name) && !frameworkConfig) frameworkConfig = e.name;
  }

  // Manifests
  let manifest: Record<string, any> = {};
  try { manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')); } catch { /* sem package.json */ }

  const deps = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];

  // Subpastas comuns (contagem limitada por velocidade — depth 2)
  for (const sub of ['src', 'app', 'pages', 'public', 'api', 'backend', 'frontend']) {
    if (htmlCount > 40 && pythonCount > 40) break;
    const dir = await readdir(join(root, sub), { withFileTypes: true }).catch(() => []);
    for (const e of dir) {
      if (e.isFile()) {
        if (e.name.endsWith('.html')) htmlCount++;
        if (e.name.endsWith('.py')) pythonCount++;
      } else if (e.isDirectory() && !SKIP_DIRS.has(e.name)) {
        const inner = await readdir(join(root, sub, e.name), { withFileTypes: true }).catch(() => []);
        for (const f of inner) {
          if (f.isFile()) {
            if (f.name.endsWith('.html')) htmlCount++;
            if (f.name.endsWith('.py')) pythonCount++;
          }
        }
      }
    }
  }

  // Python deps (requirements.txt) — vira lista sintética p/ o classificador
  try {
    const req = await readFile(join(root, 'requirements.txt'), 'utf8');
    for (const line of req.split('\n')) {
      const name = line.trim().split(/[=<>~!\[\]]/)[0].toLowerCase();
      if (name && !name.startsWith('#')) deps.push(name.replace(/-/g, '[-_]'));
    }
  } catch { /* sem requirements.txt */ }

  const goMod = files.includes('go.mod');
  const gemfile = files.includes('Gemfile');

  // Servidor "invisível" p/ o package.json: node:http direto (createServer/.listen)
  let serverSignal = false;
  for (const cand of ['src/index.ts', 'index.ts', 'src/server.ts', 'server.ts', 'src/app.ts', 'app.ts', 'src/main.ts', 'main.ts', 'src/index.js', 'server.js']) {
    try {
      const txt = await readFile(join(root, cand), 'utf8');
      if (/createServer\s*\(|\.listen\s*\(/.test(txt)) { serverSignal = true; break; }
    } catch { /* próximo candidato */ }
  }

  // Frontend sem framework: .html em dirs típicos de UI/estáticos
  let uiDirHtml = 0;
  for (const uiDir of ['src/ui', 'ui', 'public', 'static', 'www']) {
    const dir = await readdir(join(root, uiDir), { withFileTypes: true }).catch(() => []);
    for (const e of dir) if (e.isFile() && e.name.endsWith('.html')) uiDirHtml++;
  }

  // Tamanho aproximado (pula caches; cap p/ não travar em monorepos gigantes)
  let sizeBytes = 0;
  let visited = 0;
  async function walk(dir: string): Promise<void> {
    if (visited > 8000 || sizeBytes > 512 * 1024 * 1024) return;
    const list = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of list) {
      if (visited > 8000) return;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        await walk(join(dir, e.name));
      } else {
        visited++;
        try { sizeBytes += (await stat(join(dir, e.name))).size; } catch { /* race */ }
      }
    }
  }
  await walk(root);

  return {
    root, files, manifest, deps: [...new Set(deps)],
    frameworkConfig, hasDockerfile, hasCompose,
    htmlCount, pythonCount, goMod, gemfile,
    serverSignal, uiDirHtml,
    sizeMb: sizeBytes / (1024 * 1024),
  };
}

// ─── Guia passo-a-passo (LLM) ────────────────────────────────────────────────

export interface GuideStep {
  title: string;
  why: string;
  commands?: string[];
  computerUse?: boolean;
  checklist?: string[];
}

export interface DeployGuide {
  planTitle: string;
  steps: GuideStep[];
  risks: string[];
  model: string;
}

async function buildGuide(profile: ProjectProfile, platform: FreeTier, intent?: string): Promise<DeployGuide> {
  const model = await resolveModel('deploy');
  const vk = await getVirtualKey('deploy');
  const system = deploySystemPrompt(profile) + `

FORMATO DO GUIA (JSON estrito):
{"planTitle":"Plano: <Plataforma> — <tipo do projeto>",
 "steps":[{"title":"Passo curto","why":"1 frase simples para leigo",
   "commands":["comando exato"],
   "computerUse":true|false,
   "checklist":["sub-item verificável"]}],
 "risks":["limitação ou armadilha desta plataforma p/ ESTE projeto"]}
Regras: 4-8 passos; TODO passo com ação de terminal (build, git, CLI) DEVE ter
"commands" preenchidos — ex.: ["npm ci", "npm run build", "git init", "git add ."]
ou ["npx railway init"]; "computerUse":true em NO MÁXIMO 2 passos — apenas
login/cadastro e DNS/domínio; NUNCA inclua credenciais — só o NOME das variáveis.`;

  const user = `Projeto: ${profile.typeLabel} (${profile.language}${profile.framework !== '—' ? `, ${profile.framework}` : ''}${profile.docker ? ', Docker' : ''}).
Plataforma escolhida: ${platform.name} — ${platform.url} (Tier ${platform.tier}; limite: ${platform.limit}${platform.weaknesses ? '; cuidado: ' + platform.weaknesses : ''}).
${intent ? `Intenção do usuário: ${intent}` : ''}
Gere o guia de deploy.`;

  const raw = await structuredJson<any>(model, vk, system, user, 3072);
  const steps: GuideStep[] = Array.isArray(raw?.steps)
    ? raw.steps.slice(0, 10).map((s: any) => ({
        title: String(s?.title ?? 'Passo'),
        why: String(s?.why ?? ''),
        commands: Array.isArray(s?.commands) ? s.commands.map((c: any) => String(c)).slice(0, 4) : undefined,
        computerUse: s?.computerUse === true,
        checklist: Array.isArray(s?.checklist) ? s.checklist.map((c: any) => String(c)).slice(0, 6) : undefined,
      }))
    : [];
  if (!steps.length) throw new Error('LLM não devolveu passos válidos');
  return {
    planTitle: String(raw?.planTitle ?? `Plano: ${platform.name}`),
    steps,
    risks: Array.isArray(raw?.risks) ? raw.risks.map((r: any) => String(r)).slice(0, 6) : [],
    model,
  };
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

const MAX_BODY = 1024 * 1024;

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('JSON inválido'); }
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function profileFrom(b: any): ProjectProfile {
  const p = b?.profile;
  if (!p || typeof p.type !== 'string') throw new Error('profile obrigatório (rode /analyze antes)');
  return p as ProjectProfile;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handleDeployRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (!pathname.startsWith('/api/deploy/')) return false;
  const method = req.method ?? 'GET';

  try {
    // 0) Catálogo de free tiers p/ a UI (tabela + extintos + pós-deploy)
    if (pathname === '/api/deploy/tiers' && method === 'GET') {
      send(res, 200, { tiers: FREE_TIERS, retired: RETIRED_PLATFORMS, postSteps: POST_DEPLOY_STEPS });
      return true;
    }

    // 0.5) Classificação de um comando (badge AUTO/CONFIRM/DENY antes de rodar)
    if (pathname === '/api/deploy/classify-command' && method === 'POST') {
      const b = await readBody(req);
      const command = String(b.command ?? '').trim();
      if (!command) { send(res, 400, { error: 'command obrigatório' }); return true; }
      send(res, 200, classifyCommand(command));
      return true;
    }

    // 1) Analisar projeto (scan + classificação determinística)
    if (pathname === '/api/deploy/analyze' && method === 'POST') {
      const b = await readBody(req);
      const scan = await scanProject(b.path ? String(b.path) : '');
      const profile = classifyProject(scan);
      auditLogger.log({ actor: 'SUBAGENT', event: 'deploy:analyzed', payload: { type: profile.type, docker: profile.docker } });
      send(res, 200, {
        profile,
        scan: {
          root: scan.root, files: scan.files.slice(0, 120),
          frameworkConfig: scan.frameworkConfig, htmlCount: scan.htmlCount,
          pythonCount: scan.pythonCount, sizeMb: Number(scan.sizeMb.toFixed(1)),
        },
        hosting: profile.hostingCategory,
      });
      return true;
    }

    // 2) Recomendação (ranking por score)
    if (pathname === '/api/deploy/recommend' && method === 'POST') {
      const b = await readBody(req);
      const profile = profileFrom(b);
      const ranking = scorePlatforms(profile);
      send(res, 200, { ranking, retired: RETIRED_PLATFORMS, tiersCatalog: FREE_TIERS.length });
      return true;
    }

    // 3) Guia passo-a-passo via LLM
    if (pathname === '/api/deploy/guide' && method === 'POST') {
      const b = await readBody(req);
      const profile = profileFrom(b);
      const platform = FREE_TIERS.find(p => p.name === b.platform);
      if (!platform) { send(res, 400, { error: `plataforma desconhecida: ${b.platform}` }); return true; }
      const guide = await buildGuide(profile, platform, b.intent ? String(b.intent) : undefined);
      send(res, 200, guide);
      return true;
    }

    // 4) Computer use real (fallback free → pago barato acontece dentro do agent)
    if (pathname === '/api/deploy/computer-use' && method === 'POST') {
      const b = await readBody(req);
      const goal = String(b.goal ?? '').trim();
      if (!goal) { send(res, 400, { error: 'goal obrigatório' }); return true; }
      if (b.confirm !== true) {
        send(res, 409, { error: 'confirmação explícita obrigatória para ação visual', confirmationRequired: true });
        return true;
      }
      const agent = new ComputerUseAgent(getGateway(), await getVirtualKey('deploy-cu'));
      const result = await agent.executeStep(goal, Number(b.step ?? 1), true);
      let screenshotPost: string | null = null;
      try { screenshotPost = agent.getScreenshot(); } catch { /* sem tela */ }
      send(res, 200, { result, screenshotPost });
      return true;
    }

    if (pathname === '/api/deploy/computer-use/screenshot' && method === 'GET') {
      const agent = new ComputerUseAgent(getGateway(), await getVirtualKey('deploy-cu'));
      const base64 = agent.getScreenshot();
      const size = agent.getScreenSize();
      send(res, 200, { base64, width: size.width, height: size.height });
      return true;
    }

    // 5) Executor de comandos (AUTO / CONFIRM / DENY)
    if (pathname === '/api/deploy/run-command' && method === 'POST') {
      const b = await readBody(req);
      const command = String(b.command ?? '').trim();
      if (!command) { send(res, 400, { error: 'command obrigatório' }); return true; }
      const result: CommandResult = await runCommand(command, {
        confirm: b.confirm === true,
        cwd: b.cwd ? safeResolve(String(b.cwd)) : undefined,
      });
      send(res, 200, result);
      return true;
    }

    // 6) Verificação pós-deploy (status + tempo)
    if (pathname === '/api/deploy/verify' && method === 'POST') {
      const b = await readBody(req);
      const url = String(b.url ?? '').trim();
      if (!/^https?:\/\//.test(url)) { send(res, 400, { error: 'url http(s) obrigatória' }); return true; }
      const started = Date.now();
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 20_000);
        const r = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
        clearTimeout(t);
        const timeMs = Date.now() - started;
        send(res, 200, {
          ok: r.ok, status: r.status, timeMs, finalUrl: r.url,
          ssl: url.startsWith('https://'),
          hint: r.ok ? 'Site no ar!' : `Respondeu ${r.status} — verifique logs da plataforma.`,
        });
      } catch (e) {
        send(res, 200, { ok: false, status: null, timeMs: Date.now() - started, error: String(e instanceof Error ? e.message : e) });
      }
      return true;
    }

    // 7) Escrita segura (DEPLOY_INFO.md, render.yaml…) — exige confirm:true
    if (pathname === '/api/deploy/write-file' && method === 'POST') {
      const b = await readBody(req);
      const rel = String(b.path ?? '').trim();
      const content = String(b.content ?? '');
      if (!rel || !content) { send(res, 400, { error: 'path e content obrigatórios' }); return true; }
      if (b.confirm !== true) { send(res, 200, { needsConfirmation: true, path: rel, bytes: content.length }); return true; }
      const target = safeResolve(rel);
      const base = basename(target).toLowerCase();
      if (base.startsWith('.env') || target.includes(`${sep}.git${sep}`) || target.includes('node_modules')) {
        send(res, 403, { error: 'arquivo sensível/não permitido' });
        return true;
      }
      await writeFile(target, content, 'utf8');
      auditLogger.log({ actor: 'SUBAGENT', event: 'deploy:file_written', payload: { path: rel, bytes: content.length } });
      send(res, 200, { ok: true, path: rel, bytes: content.length });
      return true;
    }

    // 8) Atualizar free tiers via Agente Pesquisador (regra de comportamento #7)
    if (pathname === '/api/deploy/refresh-tiers' && method === 'POST') {
      const b = await readBody(req);
      const query = String(b.query ?? 'cloud hosting free tier comparison changes 2026');
      const sr = await searchWeb(query, undefined, 5);
      const model = await resolveModel('deploy');
      const vk = await getVirtualKey('deploy');
      const catalog = FREE_TIERS.map(p => `- ${p.name}: ${p.limit}${p.weaknesses ? ` (${p.weaknesses})` : ''}`).join('\n');
      const user = `CATÁLOGO ATUAL:\n${catalog}\n\nEXTINTOS JÁ MARCADOS: ${RETIRED_PLATFORMS.map(p => p.name).join(', ')}\n\nFONTES DA PESQUISA:\n${sr.results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n${r.snippet}`).join('\n\n')}`;
      let analysis: { summary: string; changes: any[]; recommendation: string };
      let degraded = false;
      try {
        const raw = await structuredJson<any>(model, vk,
          `Você é o DeployBot conferindo o catálogo de free tiers contra a web. JSON estrito: {"summary":"1-2 frases","changes":[{"platform":"nome","status":"ok|changed|retired","note":"o que mudou"}],"recommendation":"o que o usuário deve fazer"}`,
          user, 2048);
        analysis = {
          summary: String(raw?.summary ?? ''),
          changes: Array.isArray(raw?.changes) ? raw.changes : [],
          recommendation: String(raw?.recommendation ?? ''),
        };
      } catch {
        // Fallback: se o LLM insistir em JSON malformado, pede markdown puro —
        // a informação chega à UI de qualquer forma (endpoint é consultivo).
        degraded = true;
        const out = await getGateway().complete({
          model, virtualKey: vk, maxTokens: 1024, temperature: 0.2,
          messages: [
            { role: 'system', content: 'Você é o DeployBot. Responda em Markdown com: **Resumo** (1-2 frases), **Mudanças** (bullets plataforma — o que mudou) e **Recomendação** (1 frase). Sem HTML.' },
            { role: 'user', content: user },
          ],
        });
        analysis = { summary: out.content, changes: [], recommendation: '' };
      }
      send(res, 200, {
        provider: sr.provider,
        sources: sr.results.map(r => ({ title: r.title, url: r.url })),
        analysis,
        degraded,
        model,
      });
      return true;
    }

    // 9) Chat com DeployBot (com memória por projeto — continuidade)
    if (pathname === '/api/deploy/chat' && method === 'POST') {
      const b = await readBody(req);
      const message = String(b.message ?? '').trim();
      if (!message) { send(res, 400, { error: 'message obrigatório' }); return true; }

      const proj = b.project ? `deploy:${normProject(String(b.project))}` : undefined;
      let context = '';
      if (proj) {
        try { context = await continuityBlock(proj, message) + '\n'; } catch { /* memória off */ }
      }
      if (b.profile) {
        const p = b.profile as ProjectProfile;
        context += `PROJETO ATUAL: ${p.typeLabel} (${p.language}${p.framework !== '—' ? ', ' + p.framework : ''}) → hospedagem ${p.hostingCategory}.\n`;
      }
      if (Array.isArray(b.history) && b.history.length) {
        context += 'HISTÓRICO RECENTE:\n' + b.history.slice(-8)
          .map((h: any) => `${h?.role === 'user' ? 'Usuário' : 'DeployBot'}: ${String(h?.content ?? '').slice(0, 400)}`).join('\n') + '\n';
      }

      const model = await resolveModel('deploy');
      const vk = await getVirtualKey('deploy');
      const out = await getGateway().complete({
        model, virtualKey: vk, maxTokens: 2048, temperature: 0.3,
        messages: [
          { role: 'system', content: deploySystemPrompt(b.profile ? (b.profile as ProjectProfile) : undefined) },
          { role: 'user', content: context + `\nMENSAGEM DO USUÁRIO:\n${message}` },
        ],
      });

      // Se o usuário escolheu plataforma/contexto novo, persiste na memória por projeto.
      if (proj && b.saveToMemory !== false) {
        void remember({
          project: proj, kind: 'context',
          title: `deploy chat (${new Date().toISOString().slice(0, 16)})`,
          content: `Usuário: ${message.slice(0, 500)}\nDeployBot: ${out.content.slice(0, 800)}`,
          tags: ['deploy', 'chat'], metadata: {},
        }).catch(() => {});
      }
      send(res, 200, { reply: out.content, model: out.model || model });
      return true;
    }

    send(res, 404, { error: 'rota deploy desconhecida', path: pathname });
    return true;
  } catch (e) {
    send(res, 500, { error: String(e instanceof Error ? e.message : e) });
    return true;
  }
}
