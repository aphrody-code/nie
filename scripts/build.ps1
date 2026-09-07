#Requires -Version 7.0
# Build the maintained Rust workspace.
[CmdletBinding()]
param([switch]$Release, [switch]$Tests)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root
try {
    if ($Release) { cargo build --workspace --release } else { cargo build --workspace }
    if ($Tests) { cargo test --workspace }
    Write-Host "niers build complete ($($Release ? 'release' : 'debug'))"
} finally { Pop-Location }
