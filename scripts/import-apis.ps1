<#
.SYNOPSIS
  Importa chaves de API de arquivos .txt (por provedor) direto para o .env.
.DESCRIPTION
  SEGURANCA: os valores NUNCA sao impressos no console — apenas nomes de
  variavel, arquivo de origem e mascara (4 primeiros chars + tamanho).
  Uso:  .\scripts\import-apis.ps1          (importa de verdade)
        .\scripts\import-apis.ps1 -WhatIf  (apenas mostra o plano)
#>
param(
    [string]$SourceDir = 'F:\Projetos2025BKP\APIS',
    [string]$EnvFile   = 'F:\Projetos2026\DevMaster_Hermes\.env',
    [switch]$WhatIf
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ─── Mapeamento pasta -> variavel .env (fallback quando o prefixo nao bate) ───
$folderMap = @{
    'brave'                    = 'BRAVE_API_KEY'
    'claude'                   = 'ANTHROPIC_API_KEY'
    'context7'                 = 'CONTEXT7_API_KEY'
    'contextextream'           = 'CONTEXT7_API_KEY'
    'deepseek'                 = 'DEEPSEEK_API_KEY'
    'elevenlabs_gloliverx'     = 'ELEVENLABS_API_KEY'
    'financialmodelingprep'    = 'FINANCIAL_MODELING_PREP_API_KEY'
    'finnhubbio'               = 'FINNHUB_API_KEY'
    'freepic'                  = 'FREEPIK_API_KEY'
    'geminicloud_todocalendar' = 'GEMINI_API_KEY'
    'github'                   = 'GITHUB_TOKEN'
    'google'                   = 'GOOGLE_API_KEY'
    'vertex ai'                = 'VERTEX_AI_API_KEY'
    'linkup'                   = 'LINKUP_API_KEY'
    'nvidiabuild'              = 'NVIDIA_API_KEY'
    'openai'                   = 'OPENAI_API_KEY'
    'openrouter'               = 'OPENROUTER_API_KEY'
    'novaapiopenrouter'        = 'OPENROUTER_API_KEY'
    'serpapi'                  = 'SERPAPI_API_KEY'
    'supermemory'              = 'SUPERMEMORY_API_KEY'
    'tavily'                   = 'TAVILY_API_KEY'
    'testsprite'               = 'TESTSPRITE_API_KEY'
    'wave'                     = 'WAVESPEED_API_KEY'
}

# ─── Base URLs obrigatorias para os servicos que ainda nao estao no .env ───
$baseUrls = [ordered]@{
    'SERPAPI_BASE_URL'                 = 'https://serpapi.com'
    'TAVILY_BASE_URL'                  = 'https://api.tavily.com'
    'BRAVE_SEARCH_BASE_URL'            = 'https://api.search.brave.com/res/v1'
    'NVIDIA_BUILD_BASE_URL'            = 'https://integrate.api.nvidia.com/v1'
    'LINKUP_BASE_URL'                  = 'https://api.linkup.so'
    'ELEVENLABS_BASE_URL'              = 'https://api.elevenlabs.io/v1'
    'FINNHUB_BASE_URL'                 = 'https://finnhub.io/api/v1'
    'FINANCIAL_MODELING_PREP_BASE_URL' = 'https://financialmodelingprep.com'
    'FREEPIK_BASE_URL'                 = 'https://api.freepik.com'
    'WAVESPEED_BASE_URL'               = 'https://api.wavespeed.ai'
    'SUPERMEMORY_BASE_URL'             = 'https://api.supermemory.ai'
    'GITHUB_API_URL'                   = 'https://api.github.com'
    'VERTEX_AI_BASE_URL'               = 'https://us-central1-aiplatform.googleapis.com'
    'CONTEXT7_BASE_URL'                = 'https://api.context7.com'
}

function Mask([string]$v) {
    if ([string]::IsNullOrWhiteSpace($v)) { return '(vazio)' }
    return $v.Substring(0, [Math]::Min(4, $v.Length)) + '…' + " [len=$($v.Length)]"
}


# Extrai o token candidato mais provavel de um texto livre
function Find-KeyValue([string]$text) {
    $tokens = [regex]::Matches($text, '[A-Za-z0-9_\-\.:]{16,}') |
        ForEach-Object { $_.Value } |
        Where-Object { $_ -notmatch '(?i)https?|www\.|projetos|arquivo|senha|chave|change.?me|seu_|sua_|example|placeholder|xxx+' }
    $best = $null; $bestScore = -1
    foreach ($t in $tokens) {
        $score = $t.Length
        if ($t -match '^(sk-ant-|sk-or-|AIza|gh[pousr]_|github_pat_|BSA|eyJ)') { $score += 1000 }
        if ($score -gt $bestScore) { $bestScore = $score; $best = $t }
    }
    if ($best -and $best.Length -ge 16) { return $best }
    return $null
}

# Interpreta pares CHAVE=valor (formato .env) encontrados num arquivo
function Find-EnvPairs([string]$text) {
    $pairs = @{}
    foreach ($m in [regex]::Matches($text, '(?m)^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("?)([^\r\n"]+)\2\s*$')) {
        $pairs[$m.Groups[1].Value] = $m.Groups[3].Value.Trim()
    }
    return $pairs
}

# Redireciona por prefixo conhecido (ex.: arquivo 'sk-ant-...' dentro de pasta errada)
function Resolve-VarByPrefix([string]$val) {
    if ($val -match '^sk-ant-')   { return 'ANTHROPIC_API_KEY' }
    if ($val -match '^sk-or-')    { return 'OPENROUTER_API_KEY' }
    if ($val -match '^AIza')      { return 'GEMINI_API_KEY' }
    if ($val -match '^gh[pousr]_|^github_pat_') { return 'GITHUB_TOKEN' }
    if ($val -match '^BSA')       { return 'BRAVE_API_KEY' }
    if ($val -match '^tvly-')     { return 'TAVILY_API_KEY' }
    if ($val -match '^nvapi-|^nvap') { return 'NVIDIA_API_KEY' }
    if ($val -match '^ctx7|^cx7') { return 'CONTEXT7_API_KEY' }
    if ($val -match '^sk_')       { return 'ELEVENLABS_API_KEY' }
    if ($val -match '^AQ\.')      { return 'VERTEX_AI_API_KEY' }
    return $null
}

# Prefixo esperado quando a variavel vem SO do mapeamento de pasta.
# Se o token nao bate, o arquivo vai para revisao manual (evita importar texto/lixo).
$expectedPrefix = @{
    'BRAVE_API_KEY'='^BSA'; 'ANTHROPIC_API_KEY'='^sk-ant-'; 'DEEPSEEK_API_KEY'='^sk-'
    'OPENAI_API_KEY'='^sk-'; 'OPENROUTER_API_KEY'='^sk-or-'; 'GEMINI_API_KEY'='^AIza'
    'GOOGLE_API_KEY'='^(AIza|ya29|3398|1//)'; 'GITHUB_TOKEN'='^gh[pousr]_|^github_pat_'
    'SERPAPI_API_KEY'='^[0-9a-f]{32,}$'; 'TAVILY_API_KEY'='^tvly-'; 'NVIDIA_API_KEY'='^nvapi-|^nvap'
    'CONTEXT7_API_KEY'='^ctx7|^cbiq|^cx7'; 'ELEVENLABS_API_KEY'='^sk_'; 'VERTEX_AI_API_KEY'='^AQ\.'
    'WAVESPEED_API_KEY'='^[0-9a-f]{32,}$'; 'FINNHUB_API_KEY'='^[0-9a-z]{30,}$'
    'FREEPIK_API_KEY'='^FPSX|^fp-'; 'LINKUP_API_KEY'='^[0-9a-z]{20,}$'
    'SUPERMEMORY_API_KEY'='^sm_'; 'TESTSPRITE_API_KEY'='^sk-'
    'FINANCIAL_MODELING_PREP_API_KEY'='^[A-Za-z0-9]{20,}$'
}


# ─── Varredura da pasta (script processa; console so ve nomes) ───
$wished = @{}   # var -> lista de @{File;Value}
$skipped = @()
$review = @()
$pairsQueue = @()

Get-ChildItem -Recurse -File $SourceDir -Filter '*.txt' | ForEach-Object {
    $folder = $_.Directory.Name.ToLower()
    $text   = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($text)) { $skipped += "$($_.Name) (vazio)"; return }

    $pairs = Find-EnvPairs $text
    if ($pairs.Count -gt 0) {
        # So aceita pares estilo env em CAIXA ALTA (-cmatch) com valor plausivel
        foreach ($k in $pairs.Keys) {
            $v = $pairs[$k]
            if ($k -cmatch '^[A-Z][A-Z0-9_]{2,}$' -and $v.Length -ge 8 -and $v -notmatch '(?i)change.?me|seu_|sua_|example|placeholder|xxx+') {
                $pairsQueue += [pscustomobject]@{ Key=$k; Value=$v; File=$_.Name }
            }
        }
    }

    $folderVar = if ($folderMap.ContainsKey($folder)) { $folderMap[$folder] } else { $null }
    $val = Find-KeyValue $text
    if ($val) {
        $byPrefix = Resolve-VarByPrefix $val
        if ($byPrefix) {
            # Token com assinatura inequivoca (sk-ant-, AIza, ghp_...) — confiavel
            $wishedVar = $byPrefix
        } elseif ($folderVar -and $val -match $expectedPrefix[$folderVar]) {
            # Sem assinatura, mas casa com o formato esperado do provedor da pasta
            $wishedVar = $folderVar
        } else {
            # Nao bate com nada — NAO importa cegamente; manda para revisao manual
            $review += [pscustomobject]@{ File = $_.Name; Var = $folderVar; Mask = (Mask $val) }
            $wishedVar = $null
        }
        if ($wishedVar) {
            if (-not $wished.ContainsKey($wishedVar)) { $wished[$wishedVar] = @() }
            $wished[$wishedVar] += [pscustomobject]@{ File = $_.FullName; Value = $val }
        }
    } elseif (-not $folderVar -and $pairs.Count -eq 0) {
        $skipped += "$($_.Name) (texto livre/sem chave reconhecida)"
    } elseif ($folderVar -and -not $val) {
        $skipped += "$($_.Name) (pasta '$folder' mapeada, mas nenhum token valido no arquivo)"
    }
}

# ─── Escolha do arquivo primario + dedupe + variantes ALT ───
$toWrite = [ordered]@{}   # var -> @{Value;Comment}
foreach ($var in $wished.Keys) {
    $list = $wished[$var]
    $primary = $list | Sort-Object { if ((Split-Path $_.File -Leaf) -match '(?i)api|token|key') { 0 } else { 1 } }, { (Split-Path $_.File -Leaf).Length } | Select-Object -First 1
    $toWrite[$var] = @{ Value = $primary.Value; Comment = "importado de $(Split-Path $primary.File -Leaf)" }
    $i = 1
    foreach ($alt in ($list | Where-Object { $_.Value -ne $primary.Value })) {
        $toWrite["${var}_ALT$i"] = @{ Value = $alt.Value; Comment = "variante de $(Split-Path $alt.File -Leaf)" }
        $i++
    }
}

# Pares CHAVE=valor: so preenchem variaveis ausentes/vazias (nunca sobrescrevem)
$existing = @{}
if (Test-Path $EnvFile) {
    foreach ($line in (Get-Content $EnvFile)) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $existing[$Matches[1]] = $Matches[2].Trim() }
    }
}
foreach ($p in $pairsQueue) {
    if (-not $existing.ContainsKey($p.Key) -or [string]::IsNullOrWhiteSpace($existing[$p.Key])) {
        if (-not $toWrite.Contains($p.Key)) { $toWrite[$p.Key] = @{ Value = $p.Value; Comment = "importado de $($p.File)" } }
    }
}

# ─── Relatorio mascarado ───
Write-Host "`n===== PLANO DE IMPORTACAO (valores mascarados) =====" -ForegroundColor Cyan
foreach ($k in $toWrite.Keys) {
    $estado = if ($existing.ContainsKey($k) -and -not [string]::IsNullOrWhiteSpace($existing[$k])) { 'ATUALIZA' } else { 'NOVO' }
    Write-Host ("  [{0}] {1,-32} <= {2,-45} {3}" -f $estado, $k, $toWrite[$k].Comment, (Mask $toWrite[$k].Value))
}
foreach ($k in $baseUrls.Keys) {
    $estado = if ($existing.ContainsKey($k)) { 'mantem' } else { 'cria' }
    Write-Host ("  [base-url {0}] {1,-32} = {2}" -f $estado, $k, $baseUrls[$k])
}
if ($skipped.Count -gt 0) {
    Write-Host "`n  --- ARQUIVOS IGNORADOS (revisar manualmente se esperava chave neles) ---" -ForegroundColor Yellow
    $skipped | ForEach-Object { Write-Host "    - $_" -ForegroundColor Yellow }
}
if ($review.Count -gt 0) {
    Write-Host "`n  --- REVISAO MANUAL (token detectado mas formato nao bate com o provedor) ---" -ForegroundColor Magenta
    $review | ForEach-Object { Write-Host ("    - {0,-50} (esperado p/ pasta: {1}) {2}" -f $_.File, $_.Var, $_.Mask) -ForegroundColor Magenta }
}

if ($WhatIf) { Write-Host "`n[WhatIf] Nada foi gravado." -ForegroundColor Magenta; exit 0 }

# ─── Gravacao (com backup) ───
if (Test-Path $EnvFile) {
    Copy-Item $EnvFile "$EnvFile.backup-$(Get-Date -Format yyyyMMdd-HHmmss)" -Force
    Write-Host "`nBackup criado: .env.backup-*" -ForegroundColor DarkGray
    $lines = Get-Content $EnvFile
} else { $lines = @() }

$enc = [System.Text.UTF8Encoding]::new($false)
$newLines = [System.Collections.Generic.List[string]]::new()
$done = [System.Collections.Generic.HashSet[string]]::new()
foreach ($line in $lines) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') {
        $name = $Matches[1]
        if ($toWrite.Contains($name)) {
            $newLines.Add("# $($toWrite[$name].Comment)")
            $newLines.Add("$name=$($toWrite[$name].Value)")
            [void]$done.Add($name); continue
        }
        if ($baseUrls.Contains($name)) { $newLines.Add("$name=$($baseUrls[$name])"); [void]$done.Add($name); continue }
    }
    $newLines.Add($line)
}
$newLines.Add('')
$newLines.Add('# ─── Chaves importadas automaticamente pelo scripts/import-apis.ps1 ───')
foreach ($k in $toWrite.Keys) { if (-not $done.Contains($k)) { $newLines.Add("# $($toWrite[$k].Comment)"); $newLines.Add("$k=$($toWrite[$k].Value)") } }
$newLines.Add('')
$newLines.Add('# ─── Base URLs dos servicos externos ───')
foreach ($k in $baseUrls.Keys) { if (-not $done.Contains($k)) { $newLines.Add("$k=$($baseUrls[$k])") } }

[System.IO.File]::WriteAllLines($EnvFile, $newLines, $enc)
Write-Host "`n[OK] $EnvFile atualizado: $($toWrite.Count) chave(s) + $($baseUrls.Count) base URL(s)." -ForegroundColor Green

