@echo off
chcp 65001 > nul
title DevMaster Hermes Control Center - Launcher
color 0A

echo ===============================================================================
echo                ? DEVMASTER HERMES CONTROL CENTER ?
echo       Plataforma Modular de Orquestra??o, Ciberseguran?a e Automa??o
echo ===============================================================================
echo.

:: 1. Verificar se o Docker est? em execu??o
echo [1/4] Verificando status do Docker Engine...
docker info > nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] O Docker Desktop n?o est? rodando!
    echo Inicie o Docker Desktop e tente executar este script novamente.
    echo.
    pause
    exit /b 1
)
echo [OK] Docker Engine ativo.
echo.

:: 2. Subir os servi?os em container (Postgres, Redis, LiteLLM e Hermes Core)
echo [2/4] Inicializando containers do Hermes (docker compose up -d)...
docker compose up -d
if %errorlevel% neq 0 (
    echo [ERRO] Falha ao iniciar os containers do Docker!
    echo Verifique os logs com: docker compose logs
    pause
    exit /b 1
)
echo [OK] Containers iniciados com sucesso!
echo.

:: 3. Exibir status dos servi?os
echo [3/4] Status dos Servi?os:
echo - LiteLLM AI Gateway:    http://localhost:4000
echo - Hermes Process API:    http://localhost:4010
echo - Hermes Core Bus:       http://localhost:4020
echo - Postgres (LiteLLM):    localhost:5434
echo - Redis Cache:           localhost:6380
echo.

:: 4. Abrir Dashboard UI no navegador padr?o
echo [4/4] Abrindo Dashboard do Hermes Control Center...
set "DASHBOARD_PATH=%~dp0src\ui\index.html"
start "" "%DASHBOARD_PATH%"

echo.
echo ===============================================================================
echo       ? Todos os servi?os est?o rodando em segundo plano com sucesso! ?
echo             Pressione qualquer tecla para encerrar este terminal.
echo ===============================================================================
pause > nul

