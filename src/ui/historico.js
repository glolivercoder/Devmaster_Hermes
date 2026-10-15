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
let portsData = { ports: [], processes: [], mcps: [] };

async function loadPortsInventory() {
  const btn = document.getElementById('ports-refresh-btn');
  const doFetch = async (path) => {
    const urls = apiUrls(path);
    for (const u of urls) {
      try {
        const r = await fetch(u);
        if (!r.ok) continue;
        const j = await r.json();
        if (j && (Array.isArray(j.ports) || Array.isArray(j.processes) || Array.isArray(j.servers))) return j;
        if (Array.isArray(j)) return { ports: j };
      } catch (e) { /* next */ }
    }
    return null;
  };

  if (btn) { btn.disabled = true; btn.innerText = 'Carregando...'; }

  const [portsRes, procsRes, mcpsRes] = await Promise.all([
    doFetch('/api/ports'),
    doFetch('/api/processes'),
    doFetch('/api/mcps'),
  ]);

  portsData.ports = portsRes?.ports || [];
  portsData.processes = procsRes?.processes || [];
  portsData.mcps = mcpsRes?.servers || [];

  document.getElementById('ports-total').innerText = portsData.ports.length;
  document.getElementById('processes-total').innerText = portsData.processes.length;
  document.getElementById('mcps-total').innerText = portsData.mcps.length;

  renderPortsInventory();

  if (btn) { btn.disabled = false; btn.innerText = 'Atualizar inventário'; }
}

function renderPortsInventory() {
  const procEl = document.getElementById('processes-list');
  const portEl = document.getElementById('ports-list');
  const mcpEl = document.getElementById('mcps-list');

  // Processos
  if (!portsData.processes.length) {
    procEl.innerHTML = '<div class="p-4 bg-gray-950 rounded-xl border border-gray-800 text-xs font-mono text-gray-500 text-center">Nenhum processo Node/Python detectado.</div>';
  } else {
    procEl.innerHTML = portsData.processes.map(p => {
      const pid = p.pid;
      const cmd = (p.command || '').slice(0, 140);
      return '<div class="p-3 bg-gray-950 rounded-lg border border-gray-800 flex items-center justify-between gap-3">' +
        '<div class="min-w-0">' +
        '<div class="text-xs font-mono text-gray-200 truncate" title="' + cmd.replace(/"/g, '&quot;') + '">' + cmd + '</div>' +
        '<div class="text-[10px] text-gray-600 font-mono">PID ' + pid + '</div>' +
        '</div>' +
        '<div class="flex gap-2 shrink-0">' +
        '<button onclick="killProcess(\'' + pid + '\', this)" class="px-2 py-1 rounded-md bg-red-500/15 border border-red-500/40 text-red-300 text-xs font-mono hover:bg-red-500/25">Interromper</button>' +
        '<button onclick="restartProcess(\'' + pid + '\', this)" class="px-2 py-1 rounded-md bg-blue-500/15 border border-blue-500/40 text-blue-300 text-xs font-mono hover:bg-blue-500/25">Reiniciar</button>' +
        '</div></div>';
    }).join('');
  }

  // Portas
  if (!portsData.ports.length) {
    portEl.innerHTML = '<div class="p-4 bg-gray-950 rounded-xl border border-gray-800 text-xs font-mono text-gray-500 text-center">Nenhuma porta em escuta detectada.</div>';
  } else {
    portEl.innerHTML = portsData.ports.map(p => {
      return '<div class="p-4 bg-gray-950 rounded-xl border border-gray-800">' +
        '<div class="text-xs text-gray-500 font-mono">PORTA ' + p.port + '</div>' +
        '<div class="text-sm font-bold text-white mt-1 truncate">' + (p.owner || 'Processo ' + p.pid) + '</div>' +
        '<div class="mt-2 flex items-center justify-between text-xs text-emerald-400 font-mono">' +
        '<span>LISTEN</span><span class="text-gray-500">PID ' + p.pid + '</span>' +
        '</div></div>';
    }).join('');
  }

  // MCPs
  if (!portsData.mcps.length) {
    mcpEl.innerHTML = '<div class="p-4 bg-gray-950 rounded-xl border border-gray-800 text-xs font-mono text-gray-500 text-center">Nenhum MCP registrado no mcp-registry.json.</div>';
  } else {
    mcpEl.innerHTML = portsData.mcps.map(m => {
      return '<div class="p-4 bg-gray-950 rounded-xl border border-gray-800">' +
        '<div class="text-xs text-gray-500 font-mono">' + (m.transport || '').toUpperCase() + (m.port ? ' · PORTA ' + m.port : '') + '</div>' +
        '<div class="text-sm font-bold text-white mt-1">' + (m.name || m.id) + '</div>' +
        '<div class="text-[10px] text-gray-500 mt-1">' + (m.description || '') + '</div>' +
        '<div class="mt-2 flex gap-2"><span class="px-1.5 py-0.5 rounded text-[10px] ' + (m.priority === 'essential' ? 'bg-amber-950 text-amber-400' : 'bg-gray-900 text-gray-400') + '">' + (m.priority || '') + '</span></div>' +
        '</div>';
    }).join('');
  }
}

async function killProcess(pid, btn) {
  if (!confirm('Encerrar o processo PID ' + pid + '?')) return;
  if (btn) { btn.disabled = true; btn.innerText = '...'; }
  try {
    const urls = apiUrls('/api/processes/kill');
    for (const u of urls) {
      try {
        const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid }) });
        if (r.ok) break;
      } catch (e) { /* next */ }
    }
    alert('Processo PID ' + pid + ' encerrado.');
    await loadPortsInventory();
  } catch (e) {
    alert('Erro ao encerrar: ' + (e.message || e));
  }
  if (btn) { btn.disabled = false; btn.innerText = 'Interromper'; }
}

async function restartProcess(pid, btn) {
  if (!confirm('Reiniciar o processo PID ' + pid + '?')) return;
  if (btn) { btn.disabled = true; btn.innerText = '...'; }
  try {
    const urls = apiUrls('/api/processes/restart');
    for (const u of urls) {
      try {
        const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid }) });
        if (r.ok) break;
      } catch (e) { /* next */ }
    }
    alert('Processo PID ' + pid + ' encerrado para reinício (supervisor deve re-spawnar).');
    await loadPortsInventory();
  } catch (e) {
    alert('Erro ao reiniciar: ' + (e.message || e));
  }
  if (btn) { btn.disabled = false; btn.innerText = 'Reiniciar'; }
}