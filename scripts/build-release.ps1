#Requires -Version 7.0
# Build the maintained Rust release binaries.
[CmdletBinding()]
param([switch]$SkipTests)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root
try {
    cargo build --release -p nie-cli
    if (-not $SkipTests) { cargo test -p nie-cli --lib --tests }
    $bin = Join-Path $Root 'target\release\niers.exe'
    if (-not (Test-Path $bin)) { throw "Release binary not found: $bin" }
    $item = Get-Item $bin
    Write-Host "Built $($item.FullName) ($($item.Length) bytes)"
} finally { Pop-Location }
