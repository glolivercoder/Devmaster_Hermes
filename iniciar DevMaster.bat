@echo off
chcp 65001 1>nul 2>nul
title DevMaster Hermes Control Center
color 0A

echo ===============================================================================
echo                * DEVMASTER HERMES CONTROL CENTER *
echo ===============================================================================
echo.

echo [0/6] Verificando Docker Desktop...
set DOCKER_OK=0
docker ps 1>nul 2>nul
if %ERRORLEVEL% EQU 0 goto docker_ok
echo       Docker nao esta rodando. Aguardando (ate 60s)...
set COUNT=0
:wait_docker
timeout /t 5 /nobreak 1>nul 2>nul
set /a COUNT=%COUNT%+5
docker ps 1>nul 2>nul
if %ERRORLEVEL% EQU 0 goto docker_ok
if %COUNT% LSS 60 goto wait_docker
echo [AVISO] Docker nao detectado. Suba o Docker Desktop manualmente.
goto skip_gitea

:docker_ok
echo [OK] Docker disponivel.
set DOCKER_OK=1
echo.

echo [1/6] Iniciando Gitea local (porta 3011)...
docker compose up -d gitea 1>nul 2>nul
if %ERRORLEVEL% NEQ 0 goto gitea_fail
echo [OK] Container Gitea criado. Aguardando healthcheck (ate 30s)...
set COUNT=0
:wait_gitea
timeout /t 3 /nobreak 1>nul 2>nul
set /a COUNT=%COUNT%+3
curl -fsS http://localhost:3011/api/healthz 1>nul 2>nul
if %ERRORLEVEL% EQU 0 goto gitea_ok
if %COUNT% LSS 30 goto wait_gitea
echo [AVISO] Gitea nao respondeu. Tente http://localhost:3011
goto after_gitea
:gitea_ok
echo [OK] Gitea acessivel em http://localhost:3011
goto after_gitea
:gitea_fail
echo [AVISO] Falha ao subir Gitea.
:after_gitea
echo.
goto kill_ports

:skip_gitea
echo [1/6] Gitea nao iniciado (Docker indisponivel).
echo.

:kill_ports
echo [2/6] Encerrando servidores antigos (portas 4010/4020)...
call node scripts\kill-ports.js
timeout /t 2 /nobreak 1>nul 2>nul
echo [OK] Portas liberadas.
echo.

echo [3/6] Iniciando Hermes Core (npm run dev:fresh)...
echo       Process Guardian API:  http://localhost:4010
echo       Web Dashboard:         http://localhost:4020
echo       Gitea local:           http://localhost:3011
start "Hermes Core" cmd /k "npm run dev:fresh"
echo [OK] Hermes Core iniciado em nova janela.
echo.

echo [4/6] Aguardando Web Dashboard (porta 4020)...
set COUNT=0
:wait_dash
timeout /t 2 /nobreak 1>nul 2>nul
set /a COUNT=%COUNT%+2
curl -fsS http://localhost:4020 1>nul 2>nul
if %ERRORLEVEL% EQU 0 goto dash_ok
if %COUNT% LSS 30 goto wait_dash
echo [AVISO] Dashboard nao respondeu. Abrindo assim mesmo...
goto after_dash
:dash_ok
echo [OK] Dashboard acessivel em http://localhost:4020
:after_dash
echo.

echo [5/6] Verificando API Guardian (porta 4010)...
set COUNT=0
:wait_api
timeout /t 2 /nobreak 1>nul 2>nul
set /a COUNT=%COUNT%+2
curl -fsS http://localhost:4010/api/health 1>nul 2>nul
if %ERRORLEVEL% EQU 0 goto api_ok
if %COUNT% LSS 20 goto wait_api
echo [AVISO] API nao respondeu. Prosseguindo...
goto after_api
:api_ok
echo [OK] API acessivel em http://localhost:4010
:after_api
echo.

echo [6/6] Abrindo Dashboard do Hermes Control Center...
start "" http://localhost:4020

echo.
echo ===============================================================================
echo       * HERMES RODANDO *
echo.
echo         Dashboard:     http://localhost:4020
echo         API Guardian:  http://localhost:4010
echo         Gitea:         http://localhost:3011
echo.
echo         Esta janela pode ser fechada.
echo ===============================================================================
pause 1>nul 2>nul