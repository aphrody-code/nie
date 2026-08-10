#Requires -Version 7.0
$ErrorActionPreference = 'Continue'

$vcvars     = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
$projectDir = 'C:\Users\yohan\rg\iecode\cli'
$ninjaDir   = 'C:\tools\ninja'
$vcpkgRoot  = 'C:\Users\yohan\vcpkg'
$winSdkBin  = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64'

$buildCmd = "call `"$vcvars`" && set `"VCPKG_ROOT=$vcpkgRoot`" && set `"PATH=$ninjaDir;$winSdkBin;%PATH%`" && cd /d `"$projectDir`" && cmake --build --preset debug --target iecode_cli iecode_ffi --parallel"
$buildOut = cmd /c $buildCmd 2>&1
$buildOut
exit $LASTEXITCODE
