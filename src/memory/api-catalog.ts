/**
 * api-catalog — semente do RAG com catálogos de APIs para o orquestrador e o
 * Agente Pesquisador usarem na criação de futuras aplicações/agentes.
 *
 * Projeto dedicado no pgvector: "api-catalog". Cada fonte é uma memória
 * kind='doc' com tags de categoria — recall por similaridade encontra a API
 * certa para um problema ("preciso de CEP" → BrasilAPI).
 *
 * On-demand: POST /api/memory/seed-apis (idempotente por título).
 */
import { remember, normProject } from './project-memory.js';

interface ApiEntry {
  title: string;
  tags: string[];
  content: string;
}

/** Catálogo curado — global + Brasil (fontes verificadas). */
export const API_CATALOG: ApiEntry[] = [
  {
    title: 'public-apis/public-apis — maior catálogo global de APIs gratuitas',
    tags: ['catalogo', 'global', 'gratuito', 'multi-categoria'],
    content: `Repositório: https://github.com/public-apis/public-apis (~490k estrelas, +1.400 APIs)
Organização: +50 categorias — finanças, clima, governo, saúde, geocodificação, machine learning, esportes etc.
Uso: primeira parada ao criar um app/agent que precise de dados externos gratuitos sem chave. É lista coletiva e curada (cada entrada indica se exige autenticação e se é HTTPS).
Como usar no Hermes: consultar para achar API gratuita de um domínio antes de escrever código novo.`,
  },
  {
    title: 'BrasilAPI — APIs brasileiras (CEP, CNPJ, bancos, FIPE, PIX)',
    tags: ['brasil', 'cep', 'cnpj', 'bancos', 'fipe', 'pix', 'feriados', 'cambio'],
    content: `Repositório: https://github.com/BrasilAPI — Documentação: https://brasilapi.com.br/docs
Principal repositório brasileiro: transforma dados/serviços nacionais em API moderna (REST).
Cobre: CEP, CNPJ, DDD, bancos (ISPB), feriados nacionais/estaduais/municipais, câmbio, corretoras, tabelas FIPE (veículos), PIX (chaves).
Uso: RECOMENDADO como padrão para integração direta em apps — simples, amplo, cobre casos comuns de dados brasileiros.
Endpoints típicos: /api/cep/v2/{cep}, /api/cnpj/v1/{cnpj}, /api/banks/v1, /api/feriados/v1/{ano}, /api/fipe/tabelas, /api/cep/v1/{ddd}/cidade/{nome}.`,
  },
  {
    title: 'mcp-brasil — servidor MCP com 70 fontes públicas brasileiras para agentes de IA',
    tags: ['brasil', 'mcp', 'governamental', 'transparencia', 'agentes', 'llm'],
    content: `Repositório: https://github.com/mcp-brasil/mcp-brasil
Servidor MCP (Model Context Protocol) expondo fontes governamentais brasileiras como FERRAMENTAS para LLMs/agentes.
Fontes: BrasilAPI, Banco Central, transparência, judiciário, eleições e mais.
Chaves: segundo o projeto, 66 das 70 fontes NÃO exigem chave; 4 usam chaves gratuitas.
Uso: especialmente interessante para agentes e automações (n8n/LangChain/Hermes) — dar acesso a dados públicos BR a um agente sem escrever integração manual.`,
  },
  {
    title: 'IF-TI/APIs-PublicasBrasil — catálogo de APIs públicas brasileiras',
    tags: ['brasil', 'catalogo', 'abertos', 'clima', 'transporte'],
    content: `Repositório: https://github.com/IF-TI/APIs-PublicasBrasil
Catálogo curado de APIs públicas brasileiras: CEP, CNPJ, feriados, clima, transporte e dados abertos.
Uso: complementar ao public-apis para achar provedores nacionais por categoria.`,
  },
  {
    title: 'awesome-brazil — civic tech, dados abertos e Estado brasileiro',
    tags: ['brasil', 'civic-tech', 'dados-abertos', 'governo'],
    content: `Repositório: https://github.com/wesleymatosdev/awesome-brazil
Lista curada de civic tech, APIs públicas, dados abertos e projetos do Estado brasileiro.
Uso: referência para projetos de interesse público e integração com órgãos governamentais.`,
  },
  {
    title: 'awesomeapibrasil — APIs brasileiras com base IBGE e geolocalização',
    tags: ['brasil', 'cep', 'ibge', 'geolocalizacao'],
    content: `Repositório: https://github.com/awesomeapibrasil
APIs brasileiras, incluindo consulta de CEP com base IBGE e retorno de latitude/longitude.
Uso: quando precisar enriquecer endereço com coordenadas ou código IBGE.`,
  },
  {
    title: 'brasilcep/api — API de CEP auto-hospedável em Go',
    tags: ['brasil', 'cep', 'self-hosted', 'go', 'offline'],
    content: `Repositório: https://github.com/brasilcep/api
API de CEP auto-hospedável escrita em Go, com banco embutido e base no DNE (Diretório de Endereçamento dos Correios).
Uso: quando quiser CEP sem depender de terceiros (on-premise/offline) ou com volume alto.`,
  },
  {
    title: 'Finnhub — API de mercado (ações, forex, crypto, notícias)',
    tags: ['mercado', 'acoes', 'crypto', 'financas', 'dados'],
    content: `Provider já catalogado no Hermes (FINNHUB). Base: https://finnhub.io/api/v1 — docs https://finnhub.io/docs
Cotações em tempo real, forex, crypto, notícias financeiras, dados de empresas.
Uso no Hermes: alvo svc-finance do smart-router. Plano gratuito já limita por minuto.`,
  },
  {
    title: 'Financial Modeling Prep — dados financeiros fundamentais',
    tags: ['mercado', 'financas', 'fundamentais', 'histórico'],
    content: `Provider já catalogado no Hermes (FINANCIAL_MODELING_PREP). Base: https://financialmodelingprep.com
Demonstrações financeiras, preços históricos, indicadores, calendário de earnings.
Uso no Hermes: fundamental analysis para o alvo svc-finance.`,
  },
  {
    title: 'SerpAPI / Tavily / Brave / Linkup — busca web para pesquisa de agentes',
    tags: ['busca', 'pesquisa', 'search', 'agente-pesquisador'],
    content: `Providers já catalogados no Hermes (categorias SEARCH). Todos com chave no .env.
- Tavily (api.tavily.com): busca IA, devolve conteúdo limpo — padrão do Agente Pesquisador (fallback em cascata).
- SerpAPI (serpapi.com): Google SERP estruturado.
- Brave (api.search.brave.com): busca independente.
- Linkup (api.linkup.so): busca profunda.
Uso no Hermes: researcher.searchWeb() usa cascata Tavily→SerpAPI→Brave→Linkup.`,
  },
];

/**
 * Semeia o catálogo no RAG. Idempotente: checa títulos já gravados do projeto
 * e só insere os que faltam (evita duplicar a cada chamada).
 */
export async function seedApiCatalog(): Promise<{ inserted: number; skipped: number; project: string }> {
  const project = normProject('api-catalog');
  const { recall } = await import('./project-memory.js');
  const existing = new Set((await recall(project, '', 200)).map((m) => m.title));

  let inserted = 0; let skipped = 0;
  for (const e of API_CATALOG) {
    if (existing.has(e.title)) { skipped++; continue; }
    await remember({ project, kind: 'doc', title: e.title, content: e.content, tags: e.tags });
    inserted++;
  }
  return { inserted, skipped, project };
}
