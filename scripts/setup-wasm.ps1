# setup-wasm.ps1 — Bootstrap Emscripten + WASM build
# Usage: .\scripts\setup-wasm.ps1

param(
  [string]$EmsdkRoot = $(if ($env:EMSDK) { $env:EMSDK } else { "C:\emsdk" })
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot

function step($msg) { Write-Host "`n$msg" -ForegroundColor Cyan }
function ok($msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function fail($msg) { Write-Host "  ERR $msg" -ForegroundColor Red; exit 1 }

Write-Host "=== iecode WASM Setup ===" -ForegroundColor Cyan
Write-Host "    Root   : $Root"
Write-Host "    Emsdk  : $EmsdkRoot"

# ── 1. Check Python ──────────────────────────────────────────
step "[1/3] Python check..."
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  fail "Python 3 not found. Install: https://www.python.org/downloads/"
}
ok "Python $(python --version)"

# ── 2. Emscripten SDK ────────────────────────────────────────
step "[2/3] Emscripten SDK..."
if (-not (Test-Path "$EmsdkRoot\.git")) {
  Write-Host "  Cloning emsdk to $EmsdkRoot..."
  git clone https://github.com/emscripten-core/emsdk.git $EmsdkRoot
}

cd $EmsdkRoot
& .\emsdk.bat install latest
& .\emsdk.bat activate latest
$env:EMSDK = $EmsdkRoot

cd $Root
ok "Emscripten $(emcc --version | Select-Object -First 1)"

# ── 3. Configure WASM build ─────────────────────────────────
step "[3/3] Configuring WASM build..."
cmake --preset wasm
cmake --build --preset wasm --parallel

step "=== Build complete ==="
Write-Host "    Output: $Root\build\wasm\src\cli\iecode.js"
Write-Host "            $Root\build\wasm\src\cli\iecode.wasm"
Write-Host "    Test:   open $Root\build\wasm\index.html"
