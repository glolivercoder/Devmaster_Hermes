<#
.SYNOPSIS
  Configura segredos no .env de forma interativa e segura.
.DESCRIPTION
  Os valores NUNCA sao exibidos no terminal (input mascarado) e NUNCA passam
  pelo assistente de AI. Uso:
    .\scripts\set-secret.ps1 COMPOSIO_API_KEY
    .\scripts\set-secret.ps1 TELEGRAM_BOT_TOKEN TELEGRAM_ALLOWED_CHAT_ID
#>
param(
    [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
    [string[]]$Names
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$EnvFile = 'F:\Projetos2026\DevMaster_Hermes\.env'

foreach ($name in $Names) {
    if ($name -notmatch '^[A-Z][A-Z0-9_]+$') {
        Write-Host "  [ERRO] Nome invalido: $name (use CAIXA ALTA)" -ForegroundColor Red
        continue
    }
    $sec = Read-Host "  Valor para $name (digitacao oculta)"
    if ([string]::IsNullOrWhiteSpace($sec)) {
        Write-Host "  [SKIP] $name vazio — nada alterado." -ForegroundColor Yellow
        continue
    }
    $value = $sec.Trim()

    $lines = if (Test-Path $EnvFile) { [System.Collections.Generic.List[string]]::new() } else { [System.Collections.Generic.List[string]]::new() }
    if (Test-Path $EnvFile) { foreach ($l in [System.IO.File]::ReadAllLines($EnvFile)) { $lines.Add($l) } }

    $found = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^\s*$name\s*=") { $lines[$i] = "$name=$value"; $found = $true }
    }
    if (-not $found) { $lines.Add("$name=$value") }

    if (Test-Path $EnvFile) {
        Copy-Item $EnvFile "$EnvFile.backup-$(Get-Date -Format yyyyMMdd-HHmmss)" -Force
    }
    [System.IO.File]::WriteAllLines($EnvFile, $lines, [System.Text.UTF8Encoding]::new($false))
    Write-Host "  [OK] $name gravado no .env (len=$($value.Length))." -ForegroundColor Green
}
Write-Host "`nReinicie o hermes-core para aplicar: docker compose up -d --force-recreate hermes-core" -ForegroundColor Cyan
