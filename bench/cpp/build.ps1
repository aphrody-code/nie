# Compile le harnais C++ du banc d'essai avec MSVC, SANS vcpkg.
#
# Les deux unités mesurées (crc32.cpp, crilayla.cpp) ne dépendent que de la bibliothèque
# standard : le reste du toolkit tire fmt/spdlog/nlohmann et exigerait vcpkg.
#
# Flags alignés sur le Release du projet : /O2 /arch:AVX2 + IECODE_HAS_SSE42 pour que le
# chemin SIMD du CRC32 soit celui que le build normal emprunte.

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$out = Join-Path $PSScriptRoot 'bench.exe'
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'

if (-not (Test-Path $vcvars)) { throw "vcvars64.bat introuvable : $vcvars" }

$sources = @(
    (Join-Path $PSScriptRoot 'bench.cpp'),
    (Join-Path $root 'src\crypto\crc32.cpp'),
    (Join-Path $root 'src\compression\crilayla.cpp')
)
$inc = Join-Path $root 'src\include'

# Les .obj atterrissent dans le cwd : passer `/Fo` avec un dossier finissant par un
# backslash échapperait le guillemet fermant (D8036 avec plusieurs sources).
$cl = "cl.exe /nologo /std:c++20 /EHsc /O2 /arch:AVX2 /DIECODE_HAS_SSE42=1 /DNOMINMAX " +
      "/I`"$inc`" " + (($sources | ForEach-Object { "`"$_`"" }) -join ' ') +
      " /Fe:`"$out`""

Push-Location $PSScriptRoot
try {
    cmd /c "call `"$vcvars`" >nul 2>&1 && $cl"
    if ($LASTEXITCODE -ne 0) { throw "compilation échouée ($LASTEXITCODE)" }
} finally {
    Pop-Location
}
Write-Host "OK: $out"
