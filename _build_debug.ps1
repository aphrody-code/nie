#Requires -Version 7.0
$ErrorActionPreference = 'Continue'

$vcvars     = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
$projectDir = $PSScriptRoot
$logFile    = Join-Path $projectDir '_build_debug.log'
$ninjaExe   = 'C:\Users\yohan\AppData\Local\Microsoft\WinGet\Packages\Ninja-build.Ninja_Microsoft.Winget.Source_8wekyb3d8bbwe\ninja.exe'
$vcpkgRoot  = 'C:\Users\yohan\vcpkg'
$winSdkBin  = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64'

# Copier ninja.exe dans un chemin sans espaces si besoin
$ninjaDir   = 'C:\tools\ninja'
if (-not (Test-Path $ninjaDir)) {
    New-Item -ItemType Directory -Path $ninjaDir -Force | Out-Null
}
if (-not (Test-Path (Join-Path $ninjaDir 'ninja.exe'))) {
    Copy-Item $ninjaExe (Join-Path $ninjaDir 'ninja.exe') -Force
    Write-Host "ninja.exe copié dans $ninjaDir" -ForegroundColor Yellow
}

Write-Host "=== ETAPE 1 : cmake --preset debug ===" -ForegroundColor Cyan

# Charger MSVC, forcer VCPKG_ROOT et PATH avec ninja sans espaces
$configCmd = "call `"$vcvars`" && set `"VCPKG_ROOT=$vcpkgRoot`" && set `"PATH=$ninjaDir;$winSdkBin;%PATH%`" && set `"CMAKE_MAKE_PROGRAM=$ninjaDir\ninja.exe`" && cd /d `"$projectDir`" && cmake --preset debug -DCMAKE_MAKE_PROGRAM=$ninjaDir\ninja.exe"
$configOut = cmd /c $configCmd 2>&1
$configOut | Tee-Object -FilePath $logFile
$configExit = $LASTEXITCODE
Write-Host "--- Configure exit code : $configExit ---" -ForegroundColor $(if ($configExit -eq 0) { 'Green' } else { 'Red' })

if ($configExit -ne 0) {
    Write-Host "ECHEC configure. Abandon." -ForegroundColor Red
    exit $configExit
}

Write-Host "`n=== ETAPE 2 : cmake --build --preset debug ===" -ForegroundColor Cyan

$buildCmd = "call `"$vcvars`" && set `"VCPKG_ROOT=$vcpkgRoot`" && set `"PATH=$ninjaDir;$winSdkBin;%PATH%`" && cd /d `"$projectDir`" && cmake --build --preset debug --parallel"
$buildOut = cmd /c $buildCmd 2>&1
$buildOut | Tee-Object -FilePath $logFile -Append
$buildExit = $LASTEXITCODE
Write-Host "--- Build exit code : $buildExit ---" -ForegroundColor $(if ($buildExit -eq 0) { 'Green' } else { 'Red' })

exit $buildExit
