$ErrorActionPreference = 'Stop'
$vsPath = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools'
$vcvars = Join-Path $vsPath 'VC\Auxiliary\Build\vcvarsall.bat'

# Run vcvarsall + cmake in a single cmd process, capture env vars
$envBlock = cmd /c "`"$vcvars`" amd64 >nul 2>&1 && set" 2>&1
foreach ($line in $envBlock) {
    if ($line -match '^([^=]+)=(.*)$') {
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
}

Set-Location $PSScriptRoot

Write-Host "=== CONFIGURE ==="
cmake --preset debug --fresh
if ($LASTEXITCODE -ne 0) { Write-Error "CONFIGURE FAILED"; exit 1 }

Write-Host "=== BUILD ==="
cmake --build --preset debug -- -j8
if ($LASTEXITCODE -ne 0) { Write-Error "BUILD FAILED"; exit 1 }

Write-Host "=== BUILD SUCCESS ==="
$exe = Join-Path $PSScriptRoot 'build\debug\src\cli\iecode.exe'
if (Test-Path $exe) {
    $size = (Get-Item $exe).Length
    Write-Host "iecode.exe: $([math]::Round($size/1MB, 1)) MB"
}
