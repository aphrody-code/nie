#Requires -Version 7.0
# build-release.ps1 — Build release Windows (Ninja + MSVC)
# Usage: .\scripts\build-release.ps1 [-Reconfigure] [-SkipTests] [-Parallel N] [-VcpkgRoot <path>]
[CmdletBinding()]
param(
    [string]$VcpkgRoot = $(if ($env:VCPKG_ROOT) { $env:VCPKG_ROOT } else { "$env:USERPROFILE\vcpkg" }),
    [int]$Parallel     = [Environment]::ProcessorCount,
    [switch]$SkipTests,
    [switch]$Reconfigure
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root  = Split-Path -Parent $PSScriptRoot
$Start = Get-Date

function step($msg) { Write-Host "`n$msg" -ForegroundColor Cyan }
function ok($msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function warn($msg) { Write-Host "  >>  $msg" -ForegroundColor Yellow }
function fail($msg) { Write-Host "  ERR $msg" -ForegroundColor Red; exit 1 }

function run([string[]]$cmd) {
    & $cmd[0] $cmd[1..($cmd.Length - 1)]
    if ($LASTEXITCODE -ne 0) { fail "Echec: $($cmd -join ' ')" }
}

# ── 0. Environnement MSVC ────────────────────────────────────────────────────
$needVcvars = (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) -or ([string]::IsNullOrEmpty($env:INCLUDE))
if ($needVcvars) {
    step "[0] Initialisation MSVC..."

    $vsInstaller = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer'
    $vswhere     = Join-Path $vsInstaller 'vswhere.exe'

    if (-not (Test-Path $vswhere)) { fail "vswhere introuvable — installe Visual Studio Build Tools" }

    # Ajouter vswhere au PATH pour que DevShell.dll le trouve
    $env:PATH = "$vsInstaller;$env:PATH"

    $vsPath = & $vswhere -latest -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath
    if (-not $vsPath) { fail "Aucune installation VS avec MSVC x64 trouvee" }

    $devShellDll = Join-Path $vsPath 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll'
    if (-not (Test-Path $devShellDll)) { fail "DevShell.dll introuvable : $devShellDll" }

    Import-Module $devShellDll
    Enter-VsDevShell -VsInstallPath $vsPath -Arch amd64 -SkipAutomaticLocation
    ok "MSVC charge (VS: $vsPath)"
} else {
    ok "[0] MSVC deja actif (cl.exe + INCLUDE definis)"
}

# ── Version ───────────────────────────────────────────────────────────────────
$verMatch = Select-String -Path "$Root\CMakeLists.txt" `
    -Pattern 'project\s*\(\s*iecode\s+VERSION\s+([\d.]+)' | Select-Object -First 1
$Version  = if ($verMatch) { $verMatch.Matches[0].Groups[1].Value } else { '0.0.0' }

Write-Host "`n=== iecode $Version — release build ===" -ForegroundColor Cyan
Write-Host "    vcpkg   : $VcpkgRoot"
Write-Host "    threads : $Parallel"

# ── 1. Prerequis ─────────────────────────────────────────────────────────────
step "[1] Prerequis..."
foreach ($tool in @('cmake', 'ninja', 'git')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { fail "$tool introuvable" }
}
ok "cmake / ninja / git presents"

if (-not (Test-Path "$VcpkgRoot\vcpkg.exe")) {
    warn "vcpkg absent — bootstrap dans $VcpkgRoot..."
    run @('git', 'clone', 'https://github.com/microsoft/vcpkg.git', $VcpkgRoot)
    run @("$VcpkgRoot\bootstrap-vcpkg.bat", '-disableMetrics')
}
$env:VCPKG_ROOT = $VcpkgRoot
ok "vcpkg : $VcpkgRoot"

# ── 2. CMake configure ────────────────────────────────────────────────────────
$BuildDir  = Join-Path $Root 'build\release'
$CacheFile = Join-Path $BuildDir 'CMakeCache.txt'

Push-Location $Root
try {
    if ($Reconfigure -or -not (Test-Path $CacheFile)) {
        step "[2] CMake configure..."
        run @('cmake', '--preset', 'release')
        ok "Configure OK"
    } else {
        ok "[2] Configure skippe (cache present — -Reconfigure pour forcer)"
    }

    # ── 3. Build ──────────────────────────────────────────────────────────────
    step "[3] Build release (LTO)..."
    $t0 = Get-Date
    run @('cmake', '--build', '--preset', 'release', '--parallel', "$Parallel")
    ok "Build OK  ($([int]((Get-Date) - $t0).TotalSeconds)s)"

    # ── 4. Tests ──────────────────────────────────────────────────────────────
    if (-not $SkipTests) {
        step "[4] CTest..."
        Push-Location $BuildDir
        try {
            ctest -C Release --output-on-failure --parallel $Parallel
            if ($LASTEXITCODE -ne 0) { warn "Certains tests ont echoue" }
            else { ok "Tous les tests passes" }
        } finally { Pop-Location }
    } else {
        warn "[4] Tests ignores (-SkipTests)"
    }

} finally {
    Pop-Location
}

# ── Resume ────────────────────────────────────────────────────────────────────
$Elapsed = [int]((Get-Date) - $Start).TotalSeconds
$Bin     = Join-Path $BuildDir 'cli\iecode.exe'

Write-Host "`n=== Termine en ${Elapsed}s ===" -ForegroundColor Green
if (Test-Path $Bin) {
    $sz = '{0:N1}' -f ((Get-Item $Bin).Length / 1MB)
    Write-Host "    $Bin  ($sz MB)" -ForegroundColor Cyan
} else {
    warn "Binaire introuvable : $Bin"
}
Write-Host "    Suivant : .\scripts\package-release.ps1 -Version $Version" -ForegroundColor DarkCyan
