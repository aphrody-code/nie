#Requires -Version 7.0
# Build iecode_core via the `msvc` CMake preset (Visual Studio 17 2022 + x64
# architecture). The default `release` preset uses Ninja, which silently
# absorbs CMAKE_GENERATOR_PLATFORM=x64 from VsDevShell's environment and
# then fails configure with "Generator Ninja does not support platform
# specification, but platform x64 was specified."
#
# This script avoids that path entirely by using a generator that DOES
# accept architecture: the Visual Studio 17 2022 multi-config generator.
[CmdletBinding()]
param(
    [string]$VcpkgRoot = $(if ($env:VCPKG_ROOT) { $env:VCPKG_ROOT } else { "$env:USERPROFILE\.vcpkg" }),
    [int]$Parallel     = [Environment]::ProcessorCount,
    [switch]$Reconfigure,
    [switch]$BuildOnly,
    [string]$Target    = "iecode_core"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$cliRoot   = Split-Path -Parent $PSScriptRoot
$buildDir  = Join-Path $cliRoot 'build/msvc'

function step($msg) { Write-Host "`n$msg" -ForegroundColor Cyan }
function ok($msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function fail($msg) { Write-Host "  ERR $msg" -ForegroundColor Red; exit 1 }

# ── 0. Force MSVC env via vswhere ───────────────────────────────────────────
if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue) -or [string]::IsNullOrEmpty($env:INCLUDE)) {
    step "[0] Loading MSVC env via vswhere..."
    $vsInstaller = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer'
    $vswhere     = Join-Path $vsInstaller 'vswhere.exe'
    if (-not (Test-Path $vswhere)) { fail "vswhere not found" }
    $env:PATH = "$vsInstaller;$env:PATH"
    $vsPath = & $vswhere -latest -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath
    if (-not $vsPath) { fail "no VS installation with MSVC x64" }
    $devShellDll = Join-Path $vsPath 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll'
    if (-not (Test-Path $devShellDll)) { fail "DevShell.dll not found" }
    Import-Module $devShellDll
    Enter-VsDevShell -VsInstallPath $vsPath -Arch amd64 -SkipAutomaticLocation
    ok "MSVC loaded ($vsPath)"
}

# ── 0.5. Strip env vars that confuse the MSVC preset ────────────────────────
# CMAKE_GENERATOR_PLATFORM leaks from VsDevShell and breaks Ninja presets.
# For the VS generator we WANT x64, but we set it explicitly via -A below.
$env:CMAKE_GENERATOR_PLATFORM = ''
$env:CMAKE_GENERATOR = ''

# ── 1. Configure ────────────────────────────────────────────────────────────
$needReconfig = $Reconfigure -or -not (Test-Path (Join-Path $buildDir 'CMakeCache.txt'))
if ($needReconfig -and -not $BuildOnly) {
    step "[1] cmake --preset msvc -A x64 (VS 17 2022)"
    if (Test-Path $buildDir) { Remove-Item -Recurse -Force $buildDir }
    $env:VCPKG_ROOT = $VcpkgRoot
    Push-Location $cliRoot
    try {
        & cmake --preset msvc -A x64 -DVCPKG_TARGET_TRIPLET=x64-windows
        if ($LASTEXITCODE -ne 0) { fail "configure failed (exit $LASTEXITCODE)" }
    } finally { Pop-Location }
    ok "configure done"
} else {
    ok "[1] skipped — cache present"
}

# ── 2. Build ────────────────────────────────────────────────────────────────
step "[2] cmake --build --preset msvc-release --target $Target --parallel $Parallel"
Push-Location $cliRoot
try {
    & cmake --build --preset msvc-release --target $Target --parallel $Parallel
    if ($LASTEXITCODE -ne 0) { fail "build failed (exit $LASTEXITCODE)" }
} finally { Pop-Location }
ok "build done"

# ── 3. Locate the artefact ──────────────────────────────────────────────────
$artefactCandidates = @(
    (Join-Path $buildDir "Release/$Target.dll"),
    (Join-Path $buildDir "Release/$Target.lib"),
    (Join-Path $buildDir "$Target/Release/$Target.dll"),
    (Join-Path $buildDir "$Target/Release/$Target.lib")
)
$found = $artefactCandidates | Where-Object { Test-Path $_ }
if ($found) {
    ok "artefact: $found"
} else {
    Write-Host "  WARN no artefact at expected paths; scanning build/msvc..." -ForegroundColor Yellow
    Get-ChildItem -Recurse -Path $buildDir -Include "$Target*.dll", "$Target*.lib", "$Target*.exe" -ErrorAction SilentlyContinue | Select-Object -First 5 FullName
}
