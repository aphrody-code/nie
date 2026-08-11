#Requires -Version 7.0
# package-release.ps1 — Packager le release iecode pour distribution Windows
# Usage: .\scripts\package-release.ps1 [-Version 1.2.0] [-OutputDir dist] [-Upload]
[CmdletBinding()]
param(
    [string]$Version   = '',
    [string]$OutputDir = 'dist',
    [switch]$Upload,
    [string]$Repo      = 'aphrody-code/iecode'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root      = Split-Path -Parent $PSScriptRoot
$StartTime = Get-Date

function Write-Step { param([string]$Msg) Write-Host "`n$Msg" -ForegroundColor Cyan }
function Write-OK   { param([string]$Msg) Write-Host "  [OK] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "  [!!] $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "  [KO] $Msg" -ForegroundColor Red; exit 1 }

# ── Version depuis CMakeLists.txt ────────────────────────────────────────────
if (-not $Version) {
    $cmakeLists = Join-Path $Root 'CMakeLists.txt'
    $match = Select-String -Path $cmakeLists -Pattern 'project\s*\(\s*iecode\s+VERSION\s+([\d.]+)' |
             Select-Object -First 1
    $Version = if ($match) { $match.Matches[0].Groups[1].Value } else { '1.0.0' }
    Write-Warn "Version auto-detectee : $Version"
}

$BinDir  = Join-Path $Root 'build\release\cli'
$Tag     = "v$Version"
$PkgName = "iecode-$Version-windows-x64"
$PkgDir  = Join-Path $Root $OutputDir $PkgName

Write-Host "=== iecode Package Release ===" -ForegroundColor Cyan
Write-Host "    Version : $Version  ->  $Tag"
Write-Host "    Binaires: $BinDir"
Write-Host "    Sortie  : $PkgDir"

# ── 1. Verifier le binaire ───────────────────────────────────────────────────
Write-Step "[1/4] Verification du binaire..."
$exePath = Join-Path $BinDir 'iecode.exe'
if (-not (Test-Path $exePath)) {
    Write-Fail "iecode.exe introuvable dans $BinDir — lancez d'abord .\scripts\build-release.ps1"
}
Write-OK "iecode.exe present"

# ── 2. Preparation du package ────────────────────────────────────────────────
Write-Step "[2/4] Preparation du package..."
if (Test-Path $PkgDir) { Remove-Item $PkgDir -Recurse -Force }
New-Item -ItemType Directory -Path $PkgDir -Force | Out-Null

# Copier les binaires
foreach ($pattern in @('*.exe', '*.dll')) {
    $files = Get-ChildItem -Path $BinDir -Filter $pattern -ErrorAction SilentlyContinue
    foreach ($f in $files) {
        Copy-Item $f.FullName -Destination $PkgDir
        Write-OK "Copie : $($f.Name)"
    }
}

# Copier docs depuis la racine du depot
foreach ($doc in @('README.md', 'LICENSE', 'CHANGELOG.md')) {
    $src = Join-Path (Split-Path $Root -Parent) $doc
    if (Test-Path $src) {
        Copy-Item $src -Destination $PkgDir
        Write-OK "Copie : $doc"
    }
}

# Manifeste
$manifest = [ordered]@{
    name     = 'iecode-cli'
    version  = $Version
    platform = 'windows-x64'
    built_at = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')
    binaries = (Get-ChildItem $PkgDir -Filter '*.exe' | Select-Object -ExpandProperty Name)
} | ConvertTo-Json -Depth 3
$manifest | Set-Content -Path (Join-Path $PkgDir 'manifest.json') -Encoding UTF8
Write-OK "manifest.json genere"

# ── 3. Archive zip ───────────────────────────────────────────────────────────
Write-Step "[3/4] Compression..."
$DistDir = Join-Path $Root $OutputDir
$ZipPath = Join-Path $DistDir "$PkgName.zip"

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path "$PkgDir\*" -DestinationPath $ZipPath -CompressionLevel Optimal
$zipSize = '{0:N1}' -f ((Get-Item $ZipPath).Length / 1MB)
Write-OK "Archive : $ZipPath ($zipSize MB)"

# ── 4. Upload GitHub Releases ────────────────────────────────────────────────
if ($Upload) {
    Write-Step "[4/4] Upload GitHub Releases ($Repo)..."

    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Fail "'gh' CLI introuvable — winget install GitHub.cli"
    }

    gh auth status 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Fail "Non authentifie avec gh — lancez : gh auth login" }

    $releaseExists = gh release view $Tag --repo $Repo 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Creation de la release $Tag..."
        gh release create $Tag $ZipPath `
            --title "iecode $Version (Windows x64)" `
            --notes "Release iecode $Version pour Windows x64 (MSVC, C++20, vcpkg)." `
            --repo $Repo
        if ($LASTEXITCODE -ne 0) { Write-Fail "gh release create echoue" }
    } else {
        Write-Warn "Mise a jour de la release $Tag existante..."
        gh release upload $Tag $ZipPath --clobber --repo $Repo
        if ($LASTEXITCODE -ne 0) { Write-Fail "gh release upload echoue" }
    }
    Write-OK "Upload termine : https://github.com/$Repo/releases/tag/$Tag"
} else {
    Write-Warn "[4/4] Upload ignore (ajoutez -Upload pour publier)"
}

# ── Resume ───────────────────────────────────────────────────────────────────
$Elapsed = (Get-Date) - $StartTime
Write-Host "`n=== Package termine ===" -ForegroundColor Green
Write-Host "    Archive : $ZipPath" -ForegroundColor Cyan
Write-Host "    Taille  : $zipSize MB" -ForegroundColor Cyan
Write-Host "    Duree   : $($Elapsed.ToString('mm\:ss'))" -ForegroundColor Cyan
if (-not $Upload) {
    Write-Host "`n    Pour publier : .\scripts\package-release.ps1 -Version $Version -Upload" -ForegroundColor DarkCyan
}
