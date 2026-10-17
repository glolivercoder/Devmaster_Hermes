#!/usr/bin/env tsx
/**
 * Gemini CLI Test - Testa a conexão com o Gemini API via LiteLLM
 * 
 * Uso:
 *   npm run gemini "sua pergunta"
 *   npm run gemini:pro "sua pergunta complexa"
 *   tsx scripts/test-gemini-cli.ts "pergunta" --model gemini-pro
 */

import { GatewayClient } from '../src/gateway/gateway-client.js';
import { gateway } from '../src/gateway/gateway-singleton.js';
import { loadDotEnv } from '../src/llm/env-loader.js';

// Carrega variáveis de ambiente
loadDotEnv();

// Parse argumentos
const args = process.argv.slice(2);
let model = 'gemini-flash';
let message = '';

// Verifica se tem flag --model
if (args.includes('--model')) {
  const modelIndex = args.indexOf('--model');
  model = args[modelIndex + 1] || model;
  args.splice(modelIndex, 2);
}

message = args.join(' ') || 'Olá Gemini, quem é você?';

async function testGemini(modelName: string, userMessage: string) {
  console.log(`🧪 Testando Gemini (${modelName}) via LiteLLM...\n`);
  console.log(`🤔 Pergunta: ${userMessage}\n`);
  
  try {
    // Cria uma virtual key temporária para teste
    const vKey = await gateway.createVirtualKey({
      alias: 'gemini-test-cli',
      models: [modelName],
      maxBudgetUsd: 0.5,
      expiry: new Date(Date.now() + 3600000), // 1 hora
    });

    const response = await gateway.complete({
      model: modelName,
      messages: [
        { role: 'user', content: userMessage }
      ],
      virtualKey: vKey.key,
      temperature: 0.7,
      maxTokens: 1000,
    });

    console.log('✅ Resposta do Gemini:\n');
    console.log(response.content);
    console.log('\n---');
    console.log(`Modelo: ${response.model}`);
    console.log(`Tokens usados: ${response.tokensUsed}`);
    console.log(`Custo estimado: $${response.costUsd.toFixed(4)}`);
    
  } catch (error) {
    console.error('❌ Erro ao chamar Gemini:', error.message);
    console.error('\nVerifique:');
    console.error('1. Se o LiteLLM está rodando: docker compose up -d litellm');
    console.error('2. Se a chave GEMINI_API_KEY está correta no .env');
    console.error('3. Se o modelo está configurado no litellm-config.yaml');
    console.error('   Modelos Gemini disponíveis: gemini-pro, gemini-flash, gemini-flash-free');
  }
}

testGemini(model, message);