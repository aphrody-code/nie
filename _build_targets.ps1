#Requires -Version 7.0
$ErrorActionPreference = 'Continue'

$vcvars     = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
$projectDir = $PSScriptRoot
# Répertoire de ninja : `$env:NINJA_DIR`, sinon celui du PATH s'il y est.
$ninjaDir = if ($env:NINJA_DIR) { $env:NINJA_DIR }
            elseif (Get-Command ninja.exe -ErrorAction SilentlyContinue) { Split-Path (Get-Command ninja.exe).Source }
            else { Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links' }
# vcpkg : `$env:VCPKG_ROOT`, sinon la copie amorcée par `just cpp-bootstrap`.
$vcpkgRoot = if ($env:VCPKG_ROOT) { $env:VCPKG_ROOT } else { Join-Path $projectDir 'var\vcpkg' }
# SDK Windows : la version la plus récente installée, plutôt qu'un numéro figé.
$winSdkBin = (Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\10.*' -Directory -ErrorAction SilentlyContinue |
              Sort-Object Name -Descending | Select-Object -First 1 |
              ForEach-Object { Join-Path $_.FullName 'x64' })

$buildCmd = "call `"$vcvars`" && set `"VCPKG_ROOT=$vcpkgRoot`" && set `"PATH=$ninjaDir;$winSdkBin;%PATH%`" && cd /d `"$projectDir`" && cmake --build --preset debug --target iecode_cli iecode_ffi --parallel"
$buildOut = cmd /c $buildCmd 2>&1
$buildOut
exit $LASTEXITCODE
