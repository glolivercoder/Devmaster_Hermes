const fs = require('fs');
function dump(name, path, a, b) {
  console.log('\n========== ' + name + ' (' + path + ') ==========');
  try {
    const l = fs.readFileSync(path, 'utf8').split(/\r?\n/);
    const from = (a || 1) - 1;
    const to = b || l.length;
    console.log('[total ' + l.length + ' lines]');
    console.log(l.slice(from, to).map((s, i) => (from + i + 1) + ' | ' + s).join('\n'));
  } catch (e) { console.log('ERR', e.message); }
}

dump('bat-main', 'iniciar DevMaster.bat');
dump('bat-2', 'iniciar-DevMaster.bat');
