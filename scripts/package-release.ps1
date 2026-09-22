#Requires -Version 7.0
# Package the maintained `nie` Rust CLI for Windows.
[CmdletBinding()]
param([string]$OutputDir = 'dist')

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Bin = Join-Path $Root 'target\release\nie.exe'
$Out = Join-Path $Root $OutputDir
$Pkg = Join-Path $Out 'nie-windows-x64'

if (-not (Test-Path $Bin)) { throw "Release binary not found: $Bin; run scripts/build-release.ps1 first" }
New-Item -ItemType Directory -Path $Pkg -Force | Out-Null
Copy-Item $Bin (Join-Path $Pkg 'nie.exe') -Force
Copy-Item (Join-Path $Root 'README.md') $Pkg -Force
$manifest = [ordered]@{
    name = 'nie'
    platform = 'windows-x64'
    built_at = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')
    binary = 'nie.exe'
} | ConvertTo-Json
$manifest | Set-Content (Join-Path $Pkg 'manifest.json') -Encoding UTF8
$Zip = Join-Path $Out 'nie-windows-x64.zip'
if (Test-Path $Zip) { Remove-Item $Zip -Force }
Compress-Archive -Path "$Pkg\*" -DestinationPath $Zip -CompressionLevel Optimal
Write-Host "Packaged $Zip ($((Get-Item $Zip).Length) bytes)"
