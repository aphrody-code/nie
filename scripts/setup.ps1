#Requires -Version 7.0
# setup.ps1 — Bootstrap environnement build iecode cli
# Usage: .\scripts\setup.ps1 [-VcpkgRoot <path>]
[CmdletBinding()]
param(
    [string]$VcpkgRoot = $(if ($env:VCPKG_ROOT) { $env:VCPKG_ROOT } else { "$env:USERPROFILE\vcpkg" })
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root      = Split-Path -Parent $PSScriptRoot
$StartTime = Get-Date

function Write-Step { param([string]$Msg) Write-Host "`n$Msg" -ForegroundColor Cyan }
function Write-OK   { param([string]$Msg) Write-Host "  [OK] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "  [!!] $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "  [KO] $Msg" -ForegroundColor Red; exit 1 }

Write-Host "=== iecode CLI — Setup ===" -ForegroundColor Cyan
Write-Host "    Racine  : $Root"
Write-Host "    vcpkg   : $VcpkgRoot"

# ── 0. Environnement MSVC ────────────────────────────────────────────────────
$needVcvars = (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) -or ([string]::IsNullOrEmpty($env:INCLUDE))
if ($needVcvars) {
    Write-Step "[0/4] Initialisation MSVC..."

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
    Write-OK "MSVC charge (VS: $vsPath)"
} else {
    Write-OK "[0/4] MSVC deja actif"
}

# ── 1. vcpkg ─────────────────────────────────────────────────────────────────
Write-Step "[1/4] vcpkg..."
if (-not (Test-Path (Join-Path $VcpkgRoot 'vcpkg.exe'))) {
    Write-Warn "vcpkg absent — clonage dans $VcpkgRoot..."
    git clone https://github.com/microsoft/vcpkg.git $VcpkgRoot
    if ($LASTEXITCODE -ne 0) { Write-Fail "git clone vcpkg echoue" }
    Push-Location $VcpkgRoot
    try {
        & '.\bootstrap-vcpkg.bat' -disableMetrics
        if ($LASTEXITCODE -ne 0) { Write-Fail "bootstrap-vcpkg echoue" }
    } finally { Pop-Location }
} else {
    Write-OK "vcpkg deja installe : $VcpkgRoot"
}
$env:VCPKG_ROOT = $VcpkgRoot
$env:PATH       = "$VcpkgRoot;$env:PATH"

# ── 2. Outils requis ─────────────────────────────────────────────────────────
Write-Step "[2/4] Verification des outils..."
foreach ($tool in @('cmake', 'ninja', 'git')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Write-Fail "$tool introuvable — verifiez votre installation"
    }
    Write-OK "$tool present"
}

# ── 3. Headers vendored ──────────────────────────────────────────────────────
Write-Step "[3/4] Headers vendored..."
$thirdParty = Join-Path $Root 'third_party'

if (-not (Test-Path (Join-Path $thirdParty 'stb\stb_image.h'))) {
    New-Item -ItemType Directory -Path (Join-Path $thirdParty 'stb') -Force | Out-Null
    Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/nothings/stb/master/stb_image.h' `
        -OutFile (Join-Path $thirdParty 'stb\stb_image.h')
    Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/nothings/stb/master/stb_image_write.h' `
        -OutFile (Join-Path $thirdParty 'stb\stb_image_write.h')
    Write-OK "stb headers telecharges"
} else {
    Write-OK "stb headers presents"
}

if (-not (Test-Path (Join-Path $thirdParty 'bcdec\bcdec.h'))) {
    New-Item -ItemType Directory -Path (Join-Path $thirdParty 'bcdec') -Force | Out-Null
    Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/iOrange/bcdec/main/bcdec.h' `
        -OutFile (Join-Path $thirdParty 'bcdec\bcdec.h')
    Write-OK "bcdec.h telecharge"
} else {
    Write-OK "bcdec.h present"
}

# ── 4. CMake configure + premier build debug ─────────────────────────────────
Write-Step "[4/4] CMake configure (preset debug)..."
Push-Location $Root
try {
    cmake --preset debug
    if ($LASTEXITCODE -ne 0) { Write-Fail "cmake configure echoue" }
    Write-OK "Configure OK"

    cmake --build --preset debug --parallel
    if ($LASTEXITCODE -ne 0) { Write-Fail "cmake build echoue" }
    Write-OK "Build debug OK"
} finally {
    Pop-Location
}

# ── Resume ───────────────────────────────────────────────────────────────────
$Elapsed = [int]((Get-Date) - $StartTime).TotalSeconds
Write-Host "`n=== Setup termine en ${Elapsed}s ===" -ForegroundColor Green
Write-Host "    Binaire : $(Join-Path $Root 'build\debug\cli\iecode.exe')" -ForegroundColor Cyan
Write-Host "    Suivant : .\scripts\build.ps1          # build debug rapide" -ForegroundColor DarkCyan
Write-Host "              .\scripts\build-release.ps1  # build release LTO" -ForegroundColor DarkCyan
