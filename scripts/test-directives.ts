/* Teste rápido do parser de diretivos + bloco de portas. */
import { parseProcessDirectives, buildPortManagementBlock } from '../src/guardian/process-agent.js';

const txt = [
  'Análise do orquestrador...',
  '[[PROCESSO:pid=4599 acao=fechar motivo="servidor de teste parado"]]',
  '[[PROCESSO:pid=9999 acao=pausar motivo="porta órfã"]]',
  '[[PROCESSO:pid=777 acao=destruir motivo="ação inválida deve ser ignorada"]]',
  'Fim.',
].join('\n');

const dirs = parseProcessDirectives(txt);
console.log('DIRETIVOS:', JSON.stringify(dirs, null, 1));
const ok = dirs.length === 2 && dirs[0].pid === 4599 && dirs[0].action === 'fechar' && dirs[1].action === 'pausar';
console.log(ok ? 'PARSER OK (2 de 3, inválida descartada)' : 'PARSER FALHOU');
console.log('BLOCO (3 primeiras linhas):');
console.log(buildPortManagementBlock('- :4020 → PID 1 · hermes').split('\n').slice(0, 4).join('\n'));
process.exit(ok ? 0 : 1);
