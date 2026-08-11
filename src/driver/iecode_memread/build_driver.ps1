#Requires -Version 5.1

[CmdletBinding()]
param(
    [string]$OutDir = "",
    [ValidateSet('10.0.26100.0','10.0.22621.0','10.0.22000.0','10.0.19041.0')]
    [string]$SdkVersion = '10.0.26100.0'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $OutDir) { $OutDir = Join-Path $scriptDir "build" }

$wdkRoot = "C:\Program Files (x86)\Windows Kits\10"
if (-not (Test-Path $wdkRoot)) {
    throw "WDK introuvable : $wdkRoot"
}

$kmInc     = "$wdkRoot\Include\$SdkVersion\km"
$kmCrtInc  = "$wdkRoot\Include\$SdkVersion\km\crt"
$sharedInc = "$wdkRoot\Include\$SdkVersion\shared"
$kmLib     = "$wdkRoot\Lib\$SdkVersion\km\x64"

foreach ($p in @($kmInc, $sharedInc, $kmLib)) {
    if (-not (Test-Path $p)) { throw "Chemin WDK manquant : $p" }
}

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) { throw "vswhere.exe introuvable" }
$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) { throw "Toolchain MSVC x64 non installe" }

$vcvars = Join-Path $vsPath "VC\Auxiliary\Build\vcvars64.bat"
if (-not (Test-Path $vcvars)) { throw "vcvars64.bat introuvable : $vcvars" }

Write-Host "[*] Chargement env MSVC x64..." -ForegroundColor Cyan
$cmdOutput = cmd /c "`"$vcvars`" && set"
foreach ($line in $cmdOutput) {
    if ($line -match '^([^=]+)=(.*)$') {
        Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
    }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$src = Join-Path $scriptDir "iecode_memread.c"
$obj = Join-Path $OutDir "iecode_memread.obj"
$sys = Join-Path $OutDir "iecode_memread.sys"

Write-Host "[*] Compilation..." -ForegroundColor Cyan

$clFlags = @(
    '/nologo'
    '/c'
    '/W3'
    '/WX-'
    '/Zi'
    '/O2'
    '/GS-'
    '/Gs100000'
    '/kernel'
    '/X'            # ignorer les INCLUDE de l'env VS (evite conflits 22621 vs 26100)
    '/D_AMD64_=1'
    '/D_WIN64'
    '/DNTDDI_VERSION=0x0A000007'
    '/D_NT_TARGET_VERSION=0x0A00'
    '/DWINNT=1'
    "/I`"$kmInc`""
    "/I`"$kmCrtInc`""
    "/I`"$sharedInc`""
    "/I`"$scriptDir`""
    "/Fo`"$obj`""
    "`"$src`""
)
& cl.exe @clFlags
if ($LASTEXITCODE -ne 0) { throw "cl.exe a echoue" }

Write-Host "[*] Link..." -ForegroundColor Cyan

$linkFlags = @(
    '/NOLOGO'
    '/DRIVER'
    '/SUBSYSTEM:NATIVE,10.00'
    '/ENTRY:DriverEntry'
    '/NODEFAULTLIB'
    '/MACHINE:X64'
    '/INCREMENTAL:NO'
    '/OPT:REF'
    '/OPT:ICF'
    "/LIBPATH:`"$kmLib`""
    'ntoskrnl.lib'
    'hal.lib'
    'bufferoverflowfastfailk.lib'
    "/OUT:`"$sys`""
    "`"$obj`""
)
& link.exe @linkFlags
if ($LASTEXITCODE -ne 0) { throw "link.exe a echoue" }

Write-Host "[+] Driver construit : $sys" -ForegroundColor Green
Write-Host "[!] Non signe - utiliser install_driver.ps1" -ForegroundColor Yellow
