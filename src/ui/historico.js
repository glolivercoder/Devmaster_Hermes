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