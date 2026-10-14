/* eslint-disable no-console */
import { createServer } from 'node:http';
import { testProviderConnection } from '../src/llm/llm-center.js';
import { setEnvVar } from '../src/llm/env-store.js';

async function main() {
  // 1) provider inexistente
  const bad = await testProviderConnection('NOT_A_PROVIDER');
  console.log('[1] inexistente ->', bad.connected, '|', bad.message);
  if (bad.connected) throw new Error('nao deveria conectar');

  // 2) provider LLM valido mas sem chave no ambiente
  const savedKey = process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  const noKey = await testProviderConnection('nvidia');
  console.log('[2] sem chave ->', noKey.connected, '|', noKey.message);
  if (noKey.connected) throw new Error('nao deveria conectar sem chave');
  if (!/NVIDIA_API_KEY/.test(noKey.message)) throw new Error('mensagem deveria citar a env');

  // 3) probe real contra um servidor local que responde 200 (valida header/prefix/latency)
  process.env.NVIDIA_API_KEY = 'nvapi-test-1234567890';
  const server = createServer((req, res) => {
    (globalThis as any).__seenAuth = req.headers['authorization']; // captura o header recebido
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  process.env.NVIDIA_BUILD_BASE_URL = `http://127.0.0.1:${port}`;

  const ok = await testProviderConnection('NVIDIA');
  console.log('[3] 200 local ->', ok.connected, '|', ok.httpStatus, '|', ok.message);
  console.log('    auth header enviado:', (globalThis as any).__seenAuth);
  if (!ok.connected) throw new Error('deveria conectar no 200');
  if (ok.maskedKey && /nvapi-test-1234567890/.test(ok.maskedKey)) throw new Error('chave nao deve aparecer crua');
  if ((globalThis as any).__seenAuth !== 'Bearer nvapi-test-1234567890') throw new Error('prefixo Bearer ausente');

  // 4) probe contra 401 -> chave recusada
  const server401 = createServer((req, res) => { res.writeHead(401); res.end('unauthorized'); });
  await new Promise<void>((r) => server401.listen(0, r));
  const port401 = (server401.address() as any).port;
  process.env.NVIDIA_BUILD_BASE_URL = `http://127.0.0.1:${port401}`;
  const denied = await testProviderConnection('NVIDIA');
  console.log('[4] 401 local ->', denied.connected, '|', denied.httpStatus, '|', denied.message);
  if (denied.connected) throw new Error('401 nao deve conectar');
  if (!/recusada/.test(denied.message)) throw new Error('deveria dizer chave recusada');

  // 5) probe contra porta fechada -> falha de rede
  process.env.NVIDIA_BUILD_BASE_URL = 'http://127.0.0.1:1';
  const net = await testProviderConnection('NVIDIA');
  console.log('[5] rede morta ->', net.connected, '|', net.message);
  if (net.connected) throw new Error('nao deve conectar');

  // restaura ambiente
  if (savedKey === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = savedKey;
  delete process.env.NVIDIA_BUILD_BASE_URL;

  // ── Novos cenários: chave ALT específica + valor inline (sem salvar) ──
  // 6) envKey específico de um provider multi-chave (GEMINI_API_KEY_ALT3)
  const savedGemAlt = process.env.GEMINI_API_KEY_ALT3;
  const savedGem = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY; // garante que só a ALT está setada
  process.env.GEMINI_API_KEY_ALT3 = 'AIza-alt3-secret-key-xyz';
  const serverGem = createServer((req, res) => {
    (globalThis as Record<string, unknown>).__seenGemUrl = req.url; // confirma ?key=...
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"models":[]}');
  });
  await new Promise<void>((r) => serverGem.listen(0, r));
  const portGem = (serverGem.address() as { port: number }).port;
  const savedGemBase = process.env.GEMINI_API_BASE_URL;
  process.env.GEMINI_API_BASE_URL = `http://127.0.0.1:${portGem}`;
  const alt = await testProviderConnection('GEMINI', 'GEMINI_API_KEY_ALT3');
  console.log('[6] ALT3 específica ->', alt.connected, '| keyEnv:', alt.keyEnv, '|', alt.message);
  console.log('    url Gemini vista:', (globalThis as Record<string, unknown>).__seenGemUrl);
  if (!alt.connected) throw new Error('deveria conectar na ALT3');
  if (alt.keyEnv !== 'GEMINI_API_KEY_ALT3') throw new Error('keyEnv deveria reportar a ALT3');
  if (!/key=AIza-alt3-secret-key-xyz/.test(String((globalThis as Record<string, unknown>).__seenGemUrl)))
    throw new Error('Gemini deveria enviar a chave via query ?key=');
  if (JSON.stringify(alt).includes('AIza-alt3-secret-key-xyz')) throw new Error('chave Gemini não deve vazar');

  // 7) envKey que NÃO pertence ao provider -> erro claro
  const wrongEnv = await testProviderConnection('NVIDIA', 'GEMINI_API_KEY_ALT3');
  console.log('[7] env alheio ->', wrongEnv.connected, '|', wrongEnv.message);
  if (wrongEnv.connected) throw new Error('env de outro provider não deveria conectar');
  if (!/não pertence/.test(wrongEnv.message)) throw new Error('deveria avisar que a env não pertence');

  // 8) valueOverride inline: testa um valor colado sem gravá-lo (usa ?key= no Gemini)
  (globalThis as Record<string, unknown>).__seenGemUrl = '';
  const inline = await testProviderConnection('GEMINI', 'GEMINI_API_KEY', 'AIza-colada-inline-999');
  console.log('[8] valor inline ->', inline.connected, '| keyEnv:', inline.keyEnv, '|', inline.message);
  if (!inline.connected) throw new Error('deveria conectar com o valor inline');
  if (!/key=AIza-colada-inline-999/.test(String((globalThis as Record<string, unknown>).__seenGemUrl)))
    throw new Error('valor inline deveria ir no ?key=');

  // restaura Gemini
  if (savedGemAlt === undefined) delete process.env.GEMINI_API_KEY_ALT3; else process.env.GEMINI_API_KEY_ALT3 = savedGemAlt;
  if (savedGem === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedGem;
  if (savedGemBase === undefined) delete process.env.GEMINI_API_BASE_URL; else process.env.GEMINI_API_BASE_URL = savedGemBase;
  server.close(); server401.close(); serverGem.close();

  // 9) setEnvVar grava no .env e reflete em process.env (com trim + máscara).
  //    Isolado num diretório temporário para NÃO sujar o .env real do projeto.
  const os = await import('node:os');
  const nodePath = await import('node:path');
  const nodeFs = await import('node:fs');
  const tmpDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'hermes-envtest-'));
  const origCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    // import dinâmico fresco => ENV_PATH é calculado contra o tmpDir
    const { setEnvVar: setEnvIsolated } = await import(`../src/llm/env-store.js?tmp=${Date.now()}`);
    const r1 = await setEnvIsolated('TESTSPRITE_API_KEY', '  probe-key-abc123  ');
    console.log('[9] setEnvVar (novo) ->', r1.env, '| updated:', r1.updated, '| masked:', r1.masked);
    if (r1.updated) throw new Error('primeira escrita deveria ser "criada" (updated=false)');
    if (process.env.TESTSPRITE_API_KEY !== 'probe-key-abc123') throw new Error('process.env deveria refletir o valor (trim)');
    if (/probe-key-abc123/.test(r1.masked)) throw new Error('masked não deve conter a chave crua');
    // confirma que gravou no arquivo do tmpDir
    const written = nodeFs.readFileSync(nodePath.join(tmpDir, '.env'), 'utf8');
    if (!/TESTSPRITE_API_KEY=probe-key-abc123/.test(written)) throw new Error('valor deveria estar no .env do tmpDir');
    // segunda escrita na MESMA chave => updated=true e substitui (não duplica)
    const r2 = await setEnvIsolated('TESTSPRITE_API_KEY', 'segunda-chave-xyz');
    console.log('[9b] setEnvVar (atualiza) -> updated:', r2.updated);
    if (!r2.updated) throw new Error('segunda escrita deveria ser "atualizada" (updated=true)');
    const written2 = nodeFs.readFileSync(nodePath.join(tmpDir, '.env'), 'utf8');
    const occurrences = (written2.match(/TESTSPRITE_API_KEY=/g) || []).length;
    if (occurrences !== 1) throw new Error(`deveria haver 1 ocorrência, houve ${occurrences}`);
    if (/probe-key-abc123/.test(written2)) throw new Error('valor antigo deveria ter sido substituído');
  } finally {
    process.chdir(origCwd);
    try { nodeFs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    delete process.env.TESTSPRITE_API_KEY;
  }

  /**
 * Testa o loader de .env (loadDotEnv) num diretório temporário, validando:
 *  - parse de KEY=value, comentários e linhas em branco;
 *  - valor entre aspas é desfeito (unquote);
 *  - variável já presente no ambiente tem precedência (não sobrescreve).
 * Usa um .env sintético — NÃO toca no .env real do projeto.
 */
async function testLoadDotEnv() {
  const os = await import('node:os');
  const nodePath = await import('node:path');
  const nodeFs = await import('node:fs');
  const tmpDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'hermes-dotenv-'));
  const origCwd = process.cwd();
  const origShellKey = process.env.PRECEDENCE_TEST_VAR;

  try {
    process.chdir(tmpDir);
    nodeFs.writeFileSync(nodePath.join(tmpDir, '.env'), [
      '# comentário ignorado',
      '',
      'HERMES_DOTENV_A=valor-simples',
      'export HERMES_DOTENN_B=nao-deve-entrar', // nome inválido (typo) ainda é válido como identificador; usamos aspas no próximo
      'HERMES_DOTENV_QUOTED="valor com # dentro e espaco"',
      'PRECEDENCE_TEST_VAR=do-arquivo',
      'linha-invalida-sem-igual',
    ].join('\n'));

    // Ambiente já define PRECEDENCE_TEST_VAR -> deve vencer sobre o .env
    process.env.PRECEDENCE_TEST_VAR = 'do-ambiente';

    const { loadDotEnv } = await import(`../src/llm/env-loader.js?dotenv=${Date.now()}`);
    const info = await loadDotEnv();
    console.log('[D1] loadDotEnv -> loaded:', info.loaded);
    if (process.env.HERMES_DOTENV_A !== 'valor-simples') throw new Error('KEY=value simples não carregado');
    if (process.env.HERMES_DOTENV_QUOTED !== 'valor com # dentro e espaco') throw new Error('valor entre aspas não desfeito corretamente');
    if (process.env.PRECEDENCE_TEST_VAR !== 'do-ambiente') throw new Error('ambiente deveria ter precedência sobre o .env');
    if (info.loaded < 2) throw new Error('deveria ter carregado ao menos 2 variáveis novas');

    console.log('[D2] precedência ambiente>arquivo -> OK | quoted:', process.env.HERMES_DOTENV_QUOTED);
  } finally {
    process.chdir(origCwd);
    delete process.env.HERMES_DOTENV_A;
    delete process.env.HERMES_DOTENV_QUOTED;
    delete process.env.HERMES_DOTENN_B;
    if (origShellKey === undefined) delete process.env.PRECEDENCE_TEST_VAR; else process.env.PRECEDENCE_TEST_VAR = origShellKey;
    try { nodeFs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

  // 10) loader do .env: parse, unquote e precedência ambiente>arquivo.
  await testLoadDotEnv();

console.log('ALL PASS');
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

