#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Arrete et desenregistre le service iecode_memread, optionnellement supprime le .sys.
#>

[CmdletBinding()]
param(
    [string]$ServiceName = 'iecode_memread',
    [string]$SysPath     = (Join-Path $PSScriptRoot "..\driver\iecode_memread\build\iecode_memread.sys"),
    [switch]$DeleteFile
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = [Security.Principal.WindowsPrincipal]$id
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ce script doit etre execute en administrateur"
}

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    if ($svc.Status -eq 'Running') {
        Write-Host "[*] sc stop $ServiceName..." -ForegroundColor Cyan
        & sc.exe stop $ServiceName | Out-Null
        Start-Sleep -Seconds 1
    }
    Write-Host "[*] sc delete $ServiceName..." -ForegroundColor Cyan
    & sc.exe delete $ServiceName | Out-Null
    Write-Host "[+] Service supprime" -ForegroundColor Green
} else {
    Write-Host "[*] Service $ServiceName absent — rien a faire" -ForegroundColor Gray
}

if ($DeleteFile -and (Test-Path $SysPath)) {
    Remove-Item $SysPath -Force
    Write-Host "[+] $SysPath supprime" -ForegroundColor Green
}
