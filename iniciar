#!/usr/bin/env bash
# DevMaster Hermes Control Center - Launcher (Linux/Mac)
set -e

echo "==============================================================================="
echo "               * DEVMASTER HERMES CONTROL CENTER *"
echo "      Plataforma Modular de Orquestracao, Ciberseguranca e Automacao"
echo "==============================================================================="
echo ""

# ── ETAPA 0 - Verificar Docker ──
echo "[0/6] Verificando Docker..."
if command -v docker &>/dev/null && docker ps &>/dev/null; then
    echo "[OK] Docker ja esta rodando."
else
    echo "[AVISO] Docker nao esta rodando ou nao foi encontrado."
    echo "       Tente iniciar o Docker Desktop manualmente."
    echo "       O Gitea NAO sera iniciado."
fi
echo ""

# ── ETAPA 1 - Iniciar Gitea (porta 3011) ──
echo "[1/6] Iniciando Gitea local (porta 3011)..."
if command -v docker &>/dev/null && docker ps &>/dev/null; then
    if docker compose up -d gitea 2>/dev/null; then
        echo "[OK] Container Gitea iniciado. Aguardando healthcheck (ate 30s)..."
        for i in $(seq 1 15); do
            if curl -fsS http://localhost:3011/api/healthz &>/dev/null; then
                echo "[OK] Gitea acessivel em http://localhost:3011"
                break
            fi
            sleep 2
        done
    else
        echo "[AVISO] Falha ao subir Gitea. Verifique o docker-compose.yml."
    fi
else
    echo "[AVISO] Docker indisponivel. Gitea nao sera iniciado."
fi
echo ""

# ── ETAPA 2 - Kill portas antigas ──
echo "[2/6] Encerrando servidores antigos (portas 4010/4020)..."
node scripts/kill-ports.js
sleep 2
echo "[OK] Portas liberadas."
echo ""

# ── ETAPA 3 - Iniciar Hermes Core ──
echo "[3/6] Iniciando Hermes Core (npm run dev:fresh)..."
echo "      - Process Guardian API:  http://localhost:4010"
echo "      - Web Dashboard:         http://localhost:4020"
echo "      - Gitea local:           http://localhost:3011"
npm run dev:fresh &
HERMES_PID=$!
echo "[OK] Hermes Core iniciado (PID: $HERMES_PID)."
echo ""

# ── ETAPA 4 - Aguardar Dashboard ──
echo "[4/6] Aguardando Web Dashboard (porta 4020)..."
for i in $(seq 1 15); do
    if curl -fsS http://localhost:4020 &>/dev/null; then
        echo "[OK] Dashboard acessivel em http://localhost:4020"
        break
    fi
    sleep 2
done
echo ""

# ── ETAPA 5 - Aguardar API ──
echo "[5/6] Verificando API (porta 4010)..."
for i in $(seq 1 10); do
    if curl -fsS http://localhost:4010/api/health &>/dev/null; then
        echo "[OK] API acessivel em http://localhost:4010"
        break
    fi
    sleep 2
done
echo ""

# ── ETAPA 6 - Abrir Navegador ──
echo "[6/6] Abrindo Dashboard..."
if command -v xdg-open &>/dev/null; then
    xdg-open http://localhost:4020
elif command -v open &>/dev/null; then
    open http://localhost:4020
fi

echo ""
echo "==============================================================================="
echo "      * HERMES RODANDO *"
echo ""
echo "        Dashboard:     http://localhost:4020"
echo "        API Guardian:  http://localhost:4010"
echo "        Gitea:         http://localhost:3011"
echo ""
echo "        Pressione Ctrl+C para encerrar."
echo "==============================================================================="

# Aguarda o processo do Hermes
wait $HERMES_PID