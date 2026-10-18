// ── Histórico & Auditoria ──
let historicoData = [];

async function loadHistorico() {
  const btn = document.getElementById('historico-refresh-btn');
  const el = document.getElementById('historico-entries');
  if (btn) { btn.disabled = true; btn.innerText = 'Carregando...'; }
  el.innerHTML = '<div class="p-4 bg-gray-950 rounded-xl border border-gray-800 text-xs font-mono text-amber-300 text-center animate-pulse">Carregando historico de eventos...</div>';
  try {
    const urls = apiUrls('/api/audit');
    let result = null, lastErr = null;
    for (const u of urls) {
      try {
        const r = await fetch(u);
        if (!r.ok) { lastErr = 'HTTP ' + r.status; continue; }
        result = await r.json();
        break;
      } catch (e) { lastErr = e.message; }
    }
    if (!result) throw new Error(lastErr || 'indisponivel');
    historicoData = result.entries || [];
    renderHistorico();
    // 📁 Projetos do orquestrador (pasta F:\Projetos2026\DevMaster) junto do load.
    loadOrchProjects();
  } catch (e) {
    el.innerHTML = '<div class="p-4 bg-red-950/20 rounded-xl border border-red-900/50 text-xs font-mono text-red-400 text-center">Erro ao carregar historico: ' + (e.message || 'desconhecido') + '</div>';
  }
  if (btn) { btn.disabled = false; btn.innerText = 'Atualizar'; }
}

function renderHistorico() {
  const el = document.getElementById('historico-entries');
  const countEl = document.getElementById('historico-count');
  const actorFilter = document.getElementById('historico-actor-filter').value;
  const search = (document.getElementById('historico-search').value || '').toLowerCase();

  let filtered = historicoData;
  if (actorFilter) filtered = filtered.filter(e => e.actor === actorFilter);
  if (search) filtered = filtered.filter(e =>
    (e.event || '').toLowerCase().includes(search) ||
    JSON.stringify(e.payload || {}).toLowerCase().includes(search)
  );

  countEl.innerText = filtered.length + ' evento(s)';

  if (!filtered.length) {
    el.innerHTML = '<div class="p-4 bg-gray-950 rounded-xl border border-gray-800 text-xs font-mono text-gray-500 text-center">Nenhum evento encontrado com os filtros atuais.</div>';
    return;
  }

  const actorBadge = (actor) => {
    const map = {
      'USER': '<span class="px-1.5 py-0.5 rounded text-[10px] bg-blue-950 text-blue-400">USER</span>',
      'ORCHESTRATOR': '<span class="px-1.5 py-0.5 rounded text-[10px] bg-amber-950 text-amber-400">ORCH</span>',
      'SUBAGENT': '<span class="px-1.5 py-0.5 rounded text-[10px] bg-purple-950 text-purple-400">AGENT</span>',
      'GUARDIAN': '<span class="px-1.5 py-0.5 rounded text-[10px] bg-red-950 text-red-400">GUARD</span>',
      'SYSTEM': '<span class="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 text-gray-400">SYS</span>',
    };
    return map[actor] || '<span class="px-1.5 py-0.5 rounded text-[10px] bg-gray-900 text-gray-500">' + actor + '</span>';
  };

  el.innerHTML = filtered.map(e => {
    const ts = e.ts ? new Date(e.ts).toLocaleString('pt-BR') : '--';
    const payloadStr = e.payload ? JSON.stringify(e.payload).slice(0, 200) : '--';
    return '<div class="p-3 bg-gray-950 rounded-lg border border-gray-800 hover:border-gray-700 transition space-y-1.5">' +
      '<div class="flex items-center justify-between flex-wrap gap-2">' +
      '<span class="text-[10px] text-gray-600 font-mono">' + ts + '</span>' +
      actorBadge(e.actor) +
      '<span class="text-[11px] font-mono text-gray-300 font-bold truncate max-w-[300px]" title="' + (e.event || '') + '">' + (e.event || '?') + '</span>' +
      '</div>' +
      '<div class="text-[10px] font-mono text-gray-500 break-all pl-1 border-l border-gray-800">' + payloadStr + '</div>' +
      '</div>';
  }).join('');
}

// ── Port & Process Guardian / MCPs ──
let portsData = { ports: [], processes: [], mcpsHermes: [], mcpsOc: [], mcpsActive: [] };

// ── 📁 Projetos do Orquestrador (F:\Projetos2026\DevMaster\<nome>) ──
// Cada run do orquestrador grava: prompt-original.md (append), historico.jsonl
// (índice) e runs/<ts>/{resposta,pesquisa,mercado,site-crm,site-pro}.md —
// só os arquivos de capacidade cujo checkbox estava ON na rodada.
let orchProjectsData = [];

function orchEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function orchFileBadge(rel) {
  const n = rel.split('/').pop();
  if (n === 'prompt-original.md') return ['📝', 'Prompt original', 'bg-blue-950 text-blue-300 border-blue-900/60'];
  if (n === 'historico.jsonl') return ['🗒️', 'Índice', 'bg-gray-800 text-gray-300 border-gray-700'];
  if (n === 'resposta-orquestrador.md') return ['💬', 'Resposta', 'bg-amber-950 text-amber-300 border-amber-900/60'];
  if (n === 'pesquisa-avancada.md') return ['🔎', 'Pesquisa', 'bg-purple-950 text-purple-300 border-purple-900/60'];
  if (n === 'analise-mercado.md') return ['📊', 'Mercado', 'bg-emerald-950 text-emerald-300 border-emerald-900/60'];
  if (n === 'site-crm.md') return ['🏢', 'Site+CRM', 'bg-cyan-950 text-cyan-300 border-cyan-900/60'];
  if (n === 'site-profissional.md') return ['🎨', 'Site Pro', 'bg-pink-950 text-pink-300 border-pink-900/60'];
  return ['📄', n, 'bg-gray-900 text-gray-300 border-gray-800'];
}

async function loadOrchProjects() {
  const btn = document.getElementById('orch-projects-refresh');
  const el = document.getElementById('orch-projects-list');
  if (!el) return;
  if (btn) { btn.disabled = true; btn.innerText = 'Carregando...'; }
  el.innerHTML = '<div class="p-3 bg-gray-950 rounded-lg border border-gray-800 text-xs font-mono text-cyan-300 text-center animate-pulse">Listando pastas de projeto...</div>';
  try {
    const urls = apiUrls('/api/orchestrator/projects');
    let result = null, lastErr = null;
    for (const u of urls) {
      try {
        const r = await fetch(u);
        if (!r.ok) { lastErr = 'HTTP ' + r.status; continue; }
        result = await r.json();
        break;
      } catch (e) { lastErr = e.message; }
    }
    if (!result) throw new Error(lastErr || 'indisponivel');
    orchProjectsData = result.projects || [];
    renderOrchProjects(result.root);
  } catch (e) {
    el.innerHTML = '<div class="p-3 bg-red-950/20 rounded-lg border border-red-900/50 text-xs font-mono text-red-400 text-center">Erro ao carregar projetos: ' + orchEsc(e.message || e) + '</div>';
  }
  if (btn) { btn.disabled = false; btn.innerText = '⟳ Carregar projetos'; }
}

function renderOrchProjects(root) {
  const el = document.getElementById('orch-projects-list');
  if (!orchProjectsData.length) {
    el.innerHTML = '<div class="p-3 bg-gray-950 rounded-lg border border-gray-800 text-xs font-mono text-gray-500 text-center">Nenhum projeto ainda — envie um prompt na aba <strong>Orquestrador</strong> preenchendo o campo <strong>📁 Projeto</strong> (a pasta é criada em ' + orchEsc(root || 'F:\\Projetos2026\\DevMaster') + ').</div>';
    return;
  }
  el.innerHTML = orchProjectsData.map(p => {
    const files = (p.files || []).map(f => {
      const b = orchFileBadge(f);
      return '<button onclick="viewOrchFile(\'' + p.name + '\', \'' + f + '\', this)" ' +
        'class="flex items-center space-x-1.5 px-2 py-1 rounded-md border text-[10px] font-mono hover:border-cyan-500/60 hover:bg-gray-900 transition ' + b[2] + '" title="' + orchEsc(f) + '">' +
        '<span>' + b[0] + '</span><span class="font-semibold">' + b[1] + '</span>' +
        '<span class="opacity-60 truncate max-w-[180px]">' + orchEsc(f.split('/').slice(0, -1).join('/') || f.split('/').pop()) + '</span>' +
        '</button>';
    }).join('');
    return '<div class="p-3 bg-gray-950 rounded-lg border border-gray-800 space-y-2">' +
      '<div class="flex items-center justify-between flex-wrap gap-2">' +
      '<span class="text-xs font-mono text-gray-200 font-bold">📁 ' + orchEsc(p.name) + '</span>' +
      '<span class="text-[10px] font-mono text-gray-500">' + (p.runs || 0) + ' execução(ões) · atualizado ' +
      (p.updatedAt ? new Date(p.updatedAt).toLocaleString('pt-BR') : '—') + '</span>' +
      '</div>' +
      '<div class="text-[10px] font-mono text-gray-600 break-all">' + orchEsc(p.path) + '</div>' +
      '<div class="flex flex-wrap gap-1.5">' + (files || '<span class="text-[10px] text-gray-600">(sem arquivos)</span>') + '</div>' +
      '</div>';
  }).join('');
}

async function viewOrchFile(project, file, btn) {
  const view = document.getElementById('orch-project-view');
  if (!view) return;
  view.classList.remove('hidden');
  view.innerHTML = '<div class="p-3 bg-gray-950 rounded-lg border border-gray-800 text-xs font-mono text-cyan-300 text-center animate-pulse">Abrindo ' + orchEsc(file) + '...</div>';
  view.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const q = '/api/orchestrator/project-file?project=' + encodeURIComponent(project) + '&file=' + encodeURIComponent(file);
    const urls = apiUrls(q);
    let result = null, lastErr = null;
    for (const u of urls) {
      try {
        const r = await fetch(u);
        if (!r.ok) { const j = await r.json().catch(() => ({})); lastErr = j.error || ('HTTP ' + r.status); continue; }
        result = await r.json();
        break;
      } catch (e) { lastErr = e.message; }
    }
    if (!result) throw new Error(lastErr || 'indisponivel');
    const linhas = String(result.content || '').split('\n').length;
    view.innerHTML =
      '<div class="p-3 bg-gray-900 rounded-lg border border-cyan-800/60 flex items-center justify-between flex-wrap gap-2">' +
      '<span class="text-xs font-mono text-cyan-300 font-bold">📁 ' + orchEsc(project) + ' <span class="text-gray-500">/</span> ' + orchEsc(file) + '</span>' +
      '<span class="text-[10px] text-gray-500 font-mono">' + linhas + ' linha(s)</span>' +
      '<button onclick="closeOrchFile()" class="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-[10px] font-mono border border-gray-700">✕ Fechar</button>' +
      '</div>' +
      '<pre class="p-3 bg-gray-950 rounded-lg border border-gray-800 text-[11px] font-mono text-gray-300 whitespace-pre-wrap break-all max-h-96 overflow-y-auto leading-relaxed">' + orchEsc(result.content) + '</pre>';
  } catch (e) {
    view.innerHTML = '<div class="p-3 bg-red-950/20 rounded-lg border border-red-900/50 text-xs font-mono text-red-400">Erro: ' + orchEsc(e.message || e) + '</div>';
  }
}

function closeOrchFile() {
  const v = document.getElementById('orch-project-view');
  if (v) { v.classList.add('hidden'); v.innerHTML = ''; }
}

// ─── MCPs & Portas (Port & Process Guardian) ────────────────────────────────

let portsAutoTimer = null;
let portsBusy = false;

/** Auto-refresh de 12s enquanto a aba MCPs & Portas estiver visível. */
function startPortsAuto() {
  stopPortsAuto();
  portsAutoTimer = setInterval(function () {
    const v = document.getElementById('view-mcps');
    if (v && !v.classList.contains('hidden')) loadPortsInventory(true);
  }, 12000);
}

function stopPortsAuto() {
  if (portsAutoTimer) { clearInterval(portsAutoTimer); portsAutoTimer = null; }
}

async function loadPortsInventory(silent) {
  if (portsBusy) return;
  portsBusy = true;
  const btn = document.getElementById('ports-refresh-btn');
  if (!silent && btn) { btn.disabled = true; btn.innerText = 'Carregando...'; }

  const doFetch = async (path) => {
    for (const u of apiUrls(path)) {
      try {
        const r = await fetch(u);
        if (!r.ok) continue;
        return await r.json();
      } catch (e) { /* next */ }
    }
    return null;
  };

  const [portsRes, procDetail, cats, pa] = await Promise.all([
    doFetch('/api/ports'),
    doFetch('/api/processes/detail'),
    doFetch('/api/mcps/categories'),
    doFetch('/api/process-agent/status'),
  ]);

  portsData.ports = portsRes?.ports || [];
  portsData.processes = procDetail?.snapshot?.processes || [];
  portsData.mcpsHermes = cats?.hermes || [];
  portsData.mcpsOc = cats?.opencode || [];
  portsData.mcpsActive = cats?.active || [];

  const setT = (id, val) => { const e2 = document.getElementById(id); if (e2) e2.innerText = val; };
  setT('ports-total', portsData.ports.length);
  setT('processes-total', portsData.processes.length);
  setT('mcps-total', portsData.mcpsHermes.length);
  setT('mcps-oc-total', portsData.mcpsOc.length);
  setT('mcps-active-total', portsData.mcpsActive.length);

  const mon = document.getElementById('pa-monitor-status');
  if (mon) {
    mon.innerText = pa
      ? '📡 monitor: ' + ((pa.monitor && pa.monitor.running) ? 'ON' : 'OFF') +
        ' · última varredura ' + ((pa.monitor && pa.monitor.lastScanAt) ? new Date(pa.monitor.lastScanAt).toLocaleTimeString('pt-BR') : '—') +
        ' · ' + (pa.processes || 0) + ' processos · ' + (pa.portsTotal || 0) + ' portas'
      : '📡 monitor: indisponível';
  }

  renderPortsInventory();
  startPortsAuto();

  if (!silent && btn) { btn.disabled = false; btn.innerText = '⟳ Atualizar inventário'; }
  portsBusy = false;
}

function hEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPortsInventory() {
  const el = (id) => document.getElementById(id);

  // ── Processos: favicons (pausar/retomar/reiniciar/fechar) + display CPU/RAM ──
  const procEl = el('processes-list');
  if (procEl) {
    if (!portsData.processes.length) {
      procEl.innerHTML = '<div class="p-4 bg-gray-950 rounded-xl border border-gray-800 text-xs font-mono text-gray-500 text-center">Nenhum processo Node/Python/servidor detectado.</div>';
    } else {
      procEl.innerHTML = portsData.processes.map(function (p) {
        const cpuC = p.cpu >= 80 ? 'text-red-400 border-red-500/40' : p.cpu >= 50 ? 'text-amber-400 border-amber-500/40' : 'text-emerald-400 border-emerald-500/30';
        const ramC = p.ramMB >= 1024 ? 'text-red-400 border-red-500/40' : p.ramMB >= 512 ? 'text-amber-400 border-amber-500/40' : 'text-emerald-400 border-emerald-500/30';
        const portBadges = (p.ports || []).map(function (x) {
          return '<span class="px-1 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">:' + x + '</span>';
        }).join(' ');
        const dis = p.protectedProc ? 'disabled style="opacity:.35;cursor:not-allowed" ' : '';
        return '' +
          '<div class="p-3 bg-gray-950 rounded-lg border border-gray-800">' +
            '<div class="flex items-center gap-1.5 flex-wrap">' +
              '<button title="Pausar (suspende as threads)" ' + dis + 'onclick="procAction(' + p.pid + ', \'pausar\', this)" class="w-6 h-6 rounded bg-gray-800 border border-gray-700 hover:bg-amber-500/25 hover:border-amber-500/50 text-[11px]">⏸</button>' +
              '<button title="Retomar" ' + dis + 'onclick="procAction(' + p.pid + ', \'retomar\', this)" class="w-6 h-6 rounded bg-gray-800 border border-gray-700 hover:bg-emerald-500/25 hover:border-emerald-500/50 text-[11px]">▶</button>' +
              '<button title="Reiniciar (encerra e re-spawna)" ' + dis + 'onclick="procAction(' + p.pid + ', \'reiniciar\', this)" class="w-6 h-6 rounded bg-gray-800 border border-gray-700 hover:bg-blue-500/25 hover:border-blue-500/50 text-[11px]">🔄</button>' +
              '<button title="Fechar (encerra a árvore)" ' + dis + 'onclick="procAction(' + p.pid + ', \'fechar\', this)" class="w-6 h-6 rounded bg-gray-800 border border-gray-700 hover:bg-red-500/25 hover:border-red-500/50 text-[11px]">✕</button>' +
              '<span title="Uso de CPU" class="ml-1 px-1.5 py-0.5 rounded border bg-gray-900 text-[10px] font-mono ' + cpuC + '">⚡' + (p.cpu || 0) + '%</span>' +
              '<span title="Memória RAM (working set)" class="px-1.5 py-0.5 rounded border bg-gray-900 text-[10px] font-mono ' + ramC + '">▦' + Math.round(p.ramMB || 0) + 'MB</span>' +
              (p.suspended ? '<span class="px-1.5 py-0.5 rounded bg-amber-950 border border-amber-700 text-amber-300 text-[10px] font-mono">⏸ suspenso</span>' : '') +
              '<span class="px-1.5 py-0.5 rounded bg-gray-900 border border-gray-700 text-cyan-300 text-[10px] font-mono">PID ' + p.pid + '</span>' +
              '<span class="px-1.5 py-0.5 rounded bg-gray-900 border border-gray-700 text-gray-400 text-[10px] font-mono">' + hEsc(p.kind || '') + '</span>' +
              portBadges +
              (p.protectedProc ? '<span class="px-1.5 py-0.5 rounded bg-gray-900 border border-gray-700 text-gray-500 text-[10px] font-mono" title="Núcleo do Hermes/sistema — ações bloqueadas">🛡 protegido</span>' : '') +
            '</div>' +
            '<div class="text-[11px] font-mono text-gray-500 truncate mt-1.5" title="' + hEsc(p.cmd) + '">' + hEsc(p.cmd || p.name) + '</div>' +
          '</div>';
      }).join('');
    }
  }

  // ── Portas em escuta ──
  const portEl = el('ports-list');
  if (portEl) {
    if (!portsData.ports.length) {
      portEl.innerHTML = '<div class="p-4 bg-gray-950 rounded-xl border border-gray-800 text-xs font-mono text-gray-500 text-center">Nenhuma porta em escuta detectada.</div>';
    } else {
      portEl.innerHTML = portsData.ports.map(function (p) {
        return '<div class="p-4 bg-gray-950 rounded-xl border border-gray-800">' +
          '<div class="text-xs text-gray-500 font-mono">PORTA ' + p.port + '</div>' +
          '<div class="text-sm font-bold text-white mt-1 truncate">' + hEsc(p.owner || 'Processo ' + p.pid) + '</div>' +
          '<div class="mt-2 flex items-center justify-between text-xs text-emerald-400 font-mono">' +
          '<span>LISTEN</span><span class="text-gray-500">PID ' + p.pid + '</span>' +
          '</div></div>';
      }).join('');
    }
  }

  // ── MCPs do Hermes (mcp-registry.json) ──
  const mhEl = el('mcps-list');
  if (mhEl) {
    if (!portsData.mcpsHermes.length) {
      mhEl.innerHTML = '<div class="p-4 bg-gray-950 rounded-xl border border-gray-800 text-xs font-mono text-gray-500 text-center">Nenhum MCP registrado no mcp-registry.json.</div>';
    } else {
      mhEl.innerHTML = portsData.mcpsHermes.map(function (m) {
        return '<div class="p-4 bg-gray-950 rounded-xl border border-gray-800">' +
          '<div class="text-xs text-gray-500 font-mono">' + hEsc((m.transport || '').toUpperCase()) + (m.port ? ' · PORTA ' + m.port : '') +
          (m.listening === true ? ' · <span class="text-emerald-400">escutando</span>' : '') + '</div>' +
          '<div class="text-sm font-bold text-white mt-1">' + hEsc(m.name || m.id) + '</div>' +
          '<div class="text-[10px] text-gray-500 mt-1">' + hEsc(m.description || '') + '</div>' +
          '<div class="mt-2 flex gap-2"><span class="px-1.5 py-0.5 rounded text-[10px] ' + (m.priority === 'essential' ? 'bg-amber-950 text-amber-400' : 'bg-gray-900 text-gray-400') + '">' + hEsc(m.priority || '') + '</span></div>' +
          '</div>';
      }).join('');
    }
  }

  // ── MCPs do OpenCode (openrouter/omniroute — opencode.json) ──
  const ocEl = el('mcps-oc-list');
  if (ocEl) {
    if (!portsData.mcpsOc.length) {
      ocEl.innerHTML = '<div class="p-4 bg-gray-950 rounded-xl border border-gray-800 text-xs font-mono text-gray-500 text-center">Nenhum MCP configurado no OpenCode (~/.config/opencode/opencode.json).</div>';
    } else {
      ocEl.innerHTML = portsData.mcpsOc.map(function (m) {
        return '<div class="p-3 bg-gray-950 rounded-lg border border-gray-800">' +
          '<div class="flex items-center justify-between gap-2">' +
          '<div class="text-sm font-bold text-white truncate">' + hEsc(m.name) + '</div>' +
          '<span class="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-950 text-purple-300 border border-purple-800">' + hEsc(m.type || 'local') + '</span>' +
          '</div>' +
          '<div class="text-[10px] text-gray-500 font-mono mt-1 truncate">' + hEsc(m.command || '') + '</div>' +
          '</div>';
      }).join('');
    }
  }

  // ── MCPs ativos no sistema ──
  const actEl = el('mcps-active-list');
  if (actEl) {
    if (!portsData.mcpsActive.length) {
      actEl.innerHTML = '<div class="p-4 bg-gray-950 rounded-xl border border-gray-800 text-xs font-mono text-gray-500 text-center">Nenhum MCP ativo detectado.</div>';
    } else {
      actEl.innerHTML = portsData.mcpsActive.map(function (a) {
        return '<div class="p-3 bg-gray-950 rounded-lg border border-gray-800 flex items-center gap-2">' +
          '<span class="w-2 h-2 rounded-full shrink-0 ' + (a.port ? 'bg-emerald-400' : 'bg-cyan-400') + '"></span>' +
          '<div class="min-w-0">' +
          '<div class="text-xs font-bold text-white truncate">' + hEsc(a.name) + '</div>' +
          '<div class="text-[10px] text-gray-500 font-mono">' + hEsc(a.source || '') + (a.port ? ' · :' + a.port : '') + '</div>' +
          '</div>' +
          '<span class="ml-auto shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono ' + (a.port ? 'bg-emerald-950 text-emerald-300' : 'bg-gray-900 text-gray-400') + '">' + hEsc(a.status || '') + '</span>' +
          '</div>';
      }).join('');
    }
  }
}

/** Ações de processo (fechar/pausar/retomar/reiniciar) via /api/processes/action. */
async function procAction(pid, action, btn) {
  const labels = { fechar: 'Fechar (encerrar)', pausar: 'Pausar (suspender)', retomar: 'Retomar', reiniciar: 'Reiniciar' };
  if (action === 'fechar' || action === 'reiniciar') {
    if (!confirm((labels[action] || action) + ' o processo PID ' + pid + '?')) return;
  }
  if (btn) btn.disabled = true;
  try {
    let out = null;
    for (const u of apiUrls('/api/processes/action')) {
      try {
        const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: pid, action: action }) });
        if (r.ok) { out = await r.json(); break; }
      } catch (e) { /* next */ }
    }
    if (!out) alert('API de processos indisponível.');
    else alert((out.ok ? '✅ ' : '⛔ ') + 'PID ' + pid + ' · ' + action + ': ' + out.detail);
  } catch (e) {
    alert('Erro: ' + (e.message || e));
  }
  await loadPortsInventory(true);
}