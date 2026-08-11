#Requires -Version 7.0
# test-all.ps1 — Lancer tous les tests iecode (CTest C++)
# Usage: .\scripts\test-all.ps1 [-Config Debug|Release] [-Filter <pattern>] [-Parallel N]
[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Config = 'Debug',

    # Filtre CTest (ex: "G4TX*", "cfgbin*")
    [string]$Filter = '',

    [int]$Parallel = [Environment]::ProcessorCount
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root      = Split-Path -Parent $PSScriptRoot
$StartTime = Get-Date

function Write-Step { param([string]$Msg) Write-Host "`n$Msg" -ForegroundColor Cyan }
function Write-OK   { param([string]$Msg) Write-Host "  [OK] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "  [!!] $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "  [KO] $Msg" -ForegroundColor Red }

# ── Environnement MSVC ───────────────────────────────────────────────────────
$needVcvars = (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) -or ([string]::IsNullOrEmpty($env:INCLUDE))
if ($needVcvars) {
    Write-Step "[0] Initialisation MSVC..."

    $vsInstaller = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer'
    $vswhere     = Join-Path $vsInstaller 'vswhere.exe'

    if (-not (Test-Path $vswhere)) {
        Write-Fail "vswhere introuvable — installe Visual Studio Build Tools"
        exit 1
    }

    $env:PATH = "$vsInstaller;$env:PATH"

    $vsPath = & $vswhere -latest -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath
    if (-not $vsPath) {
        Write-Fail "Aucune installation VS avec MSVC x64 trouvee"
        exit 1
    }

    $devShellDll = Join-Path $vsPath 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll'
    Import-Module $devShellDll
    Enter-VsDevShell -VsInstallPath $vsPath -Arch amd64 -SkipAutomaticLocation
    Write-OK "MSVC charge"
}

# ── CTest ────────────────────────────────────────────────────────────────────
$preset    = $Config.ToLower()
$BuildDir  = Join-Path $Root "build\$preset"
$ctestResult = 'SKIP'

Write-Step "[1/1] CTest — preset $preset..."

if (-not (Test-Path $BuildDir)) {
    Write-Warn "Dossier build introuvable : $BuildDir"
    Write-Warn "Lancez d'abord : .\scripts\build.ps1 $(if ($Config -eq 'Release') { '-Release' })"
} else {
    Push-Location $BuildDir
    try {
        $ctestArgs = @(
            '--output-on-failure',
            '--parallel', "$Parallel",
            '--build-config', $Config
        )
        if ($Filter) { $ctestArgs += @('-R', $Filter) }

        ctest @ctestArgs
        if ($LASTEXITCODE -eq 0) {
            Write-OK "CTest : tous les tests passent"
            $ctestResult = 'PASS'
        } else {
            Write-Fail "CTest : echec ($LASTEXITCODE)"
            $ctestResult = 'FAIL'
        }
    } catch {
        Write-Fail "CTest erreur : $($_.Exception.Message)"
        $ctestResult = 'ERROR'
    } finally {
        Pop-Location
    }
}

# ── Resume ───────────────────────────────────────────────────────────────────
$Elapsed   = (Get-Date) - $StartTime
$anyFail   = $ctestResult -in @('FAIL', 'ERROR')
$summColor = if ($anyFail) { 'Red' } else { 'Green' }

Write-Host "`n=== Resultats des tests ===" -ForegroundColor $summColor

$color = switch ($ctestResult) {
    'PASS'  { 'Green' }
    'SKIP'  { 'Yellow' }
    default { 'Red' }
}
Write-Host ("    {0,-20} {1}" -f 'CTest C++ :', $ctestResult) -ForegroundColor $color
Write-Host "    Duree               : $($Elapsed.ToString('mm\:ss'))" -ForegroundColor Cyan

if ($anyFail) {
    Write-Host "`nCertains tests ont echoue." -ForegroundColor Red
    exit 1
} else {
    Write-Host "`nTous les tests OK." -ForegroundColor Green
}
