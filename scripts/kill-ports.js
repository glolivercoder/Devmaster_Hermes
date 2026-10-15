import { execSync } from 'node:child_process';

const PORTS = (process.env.HERMES_KILL_PORTS || '4010,4020')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

const isWin = process.platform === 'win32';

function findPidsWindows(port) {
  try {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (new RegExp(`[:.]${port}\\s`).test(line) && /LISTENING/i.test(line)) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid)) pids.add(pid);
      }
    }
    return [...pids];
  } catch {
    return [];
  }
}

function findPidsUnix(port) {
  try {
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null || true`, { encoding: 'utf8' });
    return out.split(/\s+/).filter((p) => /^\d+$/.test(p));
  } catch {
    return [];
  }
}

let killed = 0;
for (const port of PORTS) {
  const pids = isWin ? findPidsWindows(port) : findPidsUnix(port);
  for (const pid of pids) {
    if (pid === String(process.pid)) continue;
    try {
      if (isWin) {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      } else {
        execSync(`kill -9 ${pid} 2>/dev/null || true`, { stdio: 'ignore' });
      }
      killed++;
      console.log(`[dev:fresh] processo ${pid} na porta ${port} encerrado.`);
    } catch {
      /* processo pode já ter saído */
    }
  }
}

if (killed === 0) {
  console.log('[dev:fresh] nenhum processo antigo encontrado nas portas ' + PORTS.join(', ') + '.');
}

