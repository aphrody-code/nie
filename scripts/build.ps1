#Requires -Version 7.0
# build.ps1 — Build debug rapide (workflow quotidien)
# Usage: .\scripts\build.ps1 [-Release] [-Tests] [-Clean]
[CmdletBinding()]
param(
    [switch]$Release,
    [switch]$Tests,
    [switch]$Clean,
    [string]$VcpkgRoot = $(if ($env:VCPKG_ROOT) { $env:VCPKG_ROOT } else { "$env:USERPROFILE\vcpkg" }),
    [int]$Parallel     = [Environment]::ProcessorCount
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root      = Split-Path -Parent $PSScriptRoot
$StartTime = Get-Date
$Preset    = if ($Release) { 'release' } else { 'debug' }
$Config    = if ($Release) { 'Release' } else { 'Debug' }
$BuildDir  = Join-Path $Root "build\$Preset"

function Write-Step { param([string]$Msg) Write-Host "`n$Msg" -ForegroundColor Cyan }
function Write-OK   { param([string]$Msg) Write-Host "  [OK] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "  [!!] $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "  [KO] $Msg" -ForegroundColor Red; exit 1 }

Write-Host "=== iecode build ($Preset) ===" -ForegroundColor Cyan

# ── Environnement MSVC ───────────────────────────────────────────────────────
$needVcvars = (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) -or ([string]::IsNullOrEmpty($env:INCLUDE))
if ($needVcvars) {
    Write-Step "[0] Initialisation MSVC..."

    $vsInstaller = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer'
    $vswhere     = Join-Path $vsInstaller 'vswhere.exe'

    if (-not (Test-Path $vswhere)) { Write-Fail "vswhere introuvable — installe Visual Studio Build Tools" }

    # Ajouter vswhere au PATH pour que DevShell.dll le trouve
    $env:PATH = "$vsInstaller;$env:PATH"

    $vsPath = & $vswhere -latest -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath
    if (-not $vsPath) { Write-Fail "Aucune installation VS avec MSVC x64 trouvee" }

    $devShellDll = Join-Path $vsPath 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll'
    if (-not (Test-Path $devShellDll)) { Write-Fail "DevShell.dll introuvable : $devShellDll" }

    Import-Module $devShellDll
    Enter-VsDevShell -VsInstallPath $vsPath -Arch amd64 -SkipAutomaticLocation
    Write-OK "MSVC charge"
} else {
    Write-OK "[0] MSVC deja actif"
}

# ── vcpkg ────────────────────────────────────────────────────────────────────
if (-not (Test-Path (Join-Path $VcpkgRoot 'vcpkg.exe'))) {
    Write-Fail "vcpkg introuvable dans $VcpkgRoot — lancez d'abord .\scripts\setup.ps1"
}
$env:VCPKG_ROOT = $VcpkgRoot

# ── Clean ────────────────────────────────────────────────────────────────────
if ($Clean -and (Test-Path $BuildDir)) {
    Write-Step "Clean : suppression de $BuildDir..."
    Remove-Item $BuildDir -Recurse -Force
    Write-OK "BuildDir supprime"
}

# ── Configure ────────────────────────────────────────────────────────────────
$CacheFile = Join-Path $BuildDir 'CMakeCache.txt'
Push-Location $Root
try {
    if (-not (Test-Path $CacheFile)) {
        Write-Step "Configure (preset $Preset)..."
        cmake --preset $Preset
        if ($LASTEXITCODE -ne 0) { Write-Fail "cmake configure echoue" }
        Write-OK "Configure OK"
    }

    # ── Build ────────────────────────────────────────────────────────────────
    Write-Step "Build..."
    $t0 = Get-Date
    cmake --build --preset $Preset --parallel $Parallel
    if ($LASTEXITCODE -ne 0) { Write-Fail "cmake build echoue" }
    $buildSec = [int]((Get-Date) - $t0).TotalSeconds
    Write-OK "Build OK (${buildSec}s)"

    # ── Tests ────────────────────────────────────────────────────────────────
    if ($Tests) {
        Write-Step "CTest ($Config)..."
        Push-Location $BuildDir
        try {
            ctest --output-on-failure --parallel $Parallel --build-config $Config
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "Certains tests ont echoue"
            } else {
                Write-OK "Tous les tests passes"
            }
        } finally { Pop-Location }
    }

} finally {
    Pop-Location
}

# ── Resume ───────────────────────────────────────────────────────────────────
$Elapsed = [int]((Get-Date) - $StartTime).TotalSeconds
$Bin     = Join-Path $BuildDir "cli\iecode.exe"

Write-Host "`n=== Termine en ${Elapsed}s ===" -ForegroundColor Green
if (Test-Path $Bin) {
    $sz = '{0:N1}' -f ((Get-Item $Bin).Length / 1MB)
    Write-Host "    $Bin ($sz MB)" -ForegroundColor Cyan
} else {
    Write-Warn "Binaire introuvable : $Bin"
}
