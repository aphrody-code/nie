#Requires -Version 7.0
# Bootstrap the maintained Rust and Bun workspace.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root
try {
    cargo fetch --locked
    bun install --frozen-lockfile
    cargo check --workspace --tests
    Write-Host 'niers workspace setup complete'
} finally { Pop-Location }
