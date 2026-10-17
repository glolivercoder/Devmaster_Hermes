# 🚀 Gemini CLI - Guia de Uso

A **CLI do Gemini** está configurada e pronta para uso no projeto Hermes Control Center!

## 📋 Pré-requisitos

Certifique-se de que:
1. O **LiteLLM** está rodando: `docker compose up -d litellm`
2. A chave `GEMINI_API_KEY` está configurada no arquivo `.env`
3. As dependências do projeto estão instaladas: `pnpm install`

## 🎯 Como Usar

### 1. Modo Rápido (Gemini Flash)

```bash
pnpm gemini "sua pergunta aqui"
```

**Exemplo:**
```bash
pnpm gemini "Explique o que é TypeScript em 3 parágrafos"
```

### 2. Modo Avançado (Gemini Pro)

```bash
pnpm gemini:pro "sua pergunta complexa"
```

**Exemplo:**
```bash
pnpm gemini:pro "Crie uma função JavaScript que ordena objetos por data e explique cada linha"
```

### 3. Modo Direto (com tsx)

```bash
tsx scripts/test-gemini-cli.ts "sua pergunta" --model gemini-pro
```

**Modelos disponíveis:**
- `gemini-flash` (padrão, rápido e econômico)
- `gemini-flash-free` (tier gratuito)
- `gemini-pro` (modelo mais avançado)

## 🔧 Configuração no VS Code

Para usar no terminal integrado do VS Code:

1. Abra o terminal (`Ctrl+``)
2. Use qualquer um dos comandos acima

**Exemplo prático:**

```bash
# Pergunta rápida
pnpm gemini "Qual a capital da França?"

# Explicação de código
pnpm gemini:pro "Explique closures em JavaScript com exemplos"

# Ajuda com projeto
pnpm gemini:pro "Como estruturar um projeto Node.js com TypeScript?"
```

## 🛠️ Solução de Problemas

Se encontrar erros:

1. **Verifique se o LiteLLM está rodando:**
   ```bash
   docker compose ps
   ```

2. **Teste a chave diretamente:**
   ```bash
   npx tsx scripts/test-gemini-cli.ts "teste básico"
   ```

3. **Verifique os logs:**
   ```bash
   docker compose logs litellm
   ```

## 📊 Modelos Configurados

Verifique `litellm-config.yaml` para ver todos os modelos Gemini disponíveis:

```yaml
- model_name: gemini-pro
  model: gemini/gemini-2.5-pro
  
- model_name: gemini-flash
  model: gemini/gemini-2.5-flash
  
- model_name: gemini-flash-free
  model: gemini/gemini-2.5-flash
```

## 💡 Dicas

- Use `gemini-flash` para perguntas rápidas e tarefas simples
- Use `gemini-pro` para código complexo, análise profunda e tarefas de raciocínio
- O gateway LiteLLM automaticamente gerencia custos e tokens
- Todas as chamadas são registradas no sistema de auditoria do Hermes

---

**Pronto para usar!** 🎉

Basta abrir o terminal do VS Code e começar a usar o Gemini CLI.