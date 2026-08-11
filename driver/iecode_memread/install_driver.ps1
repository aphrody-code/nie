#Requires -Version 5.1
#Requires -RunAsAdministrator

[CmdletBinding()]
param(
    [string]$SysPath = "",
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$SERVICE_NAME = 'IecodeMemRead'
$scriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $SysPath) { $SysPath = Join-Path $scriptDir "build\iecode_memread.sys" }

if ($Uninstall) {
    Write-Host "[*] Arret du service..." -ForegroundColor Cyan
    $svc = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
    if ($svc) {
        if ($svc.Status -eq 'Running') {
            & sc.exe stop $SERVICE_NAME | Out-Null
            Start-Sleep -Milliseconds 500
        }
        & sc.exe delete $SERVICE_NAME | Out-Null
        Write-Host "[+] Service supprime." -ForegroundColor Green
    } else {
        Write-Host "[!] Service introuvable." -ForegroundColor Yellow
    }
    return
}

if (-not (Test-Path $SysPath)) {
    throw "Driver introuvable : $SysPath`nLancer build_driver.ps1 d'abord."
}

# Activer test signing si necessaire
$bcdedit = & bcdedit /enum '{current}' 2>&1
if ($bcdedit -notmatch 'testsigning\s+Yes') {
    Write-Host "[!] Test signing desactive. Activation..." -ForegroundColor Yellow
    & bcdedit /set testsigning on | Out-Null
    Write-Host "[!] REBOOT REQUIS pour que le test signing prenne effet." -ForegroundColor Red
    Write-Host "    Apres reboot, relancer ce script." -ForegroundColor Red
    return
}

# Supprimer le service existant s'il y en a un
$existing = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
if ($existing) {
    if ($existing.Status -eq 'Running') {
        & sc.exe stop $SERVICE_NAME | Out-Null
        Start-Sleep -Milliseconds 500
    }
    & sc.exe delete $SERVICE_NAME | Out-Null
    Write-Host "[*] Ancien service supprime." -ForegroundColor Cyan
}

# Copier le .sys dans System32\drivers
$dest = "$env:SystemRoot\System32\drivers\iecode_memread.sys"
Copy-Item -Path $SysPath -Destination $dest -Force
Write-Host "[*] Driver copie : $dest" -ForegroundColor Cyan

# Creer et demarrer le service
& sc.exe create $SERVICE_NAME type= kernel start= demand binPath= $dest | Out-Null
$r = & sc.exe start $SERVICE_NAME 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] sc.exe start output : $r" -ForegroundColor Yellow
    # Code 1275 = pilote non signe mais testsigning actif — ca ne devrait pas arriver
    # Code 577  = Windows signature verification policy (test signing pas encore actif)
    throw "Demarrage du service echoue (code $LASTEXITCODE)"
}

Write-Host "[+] Driver charge : \\.\IecodeMemRead disponible" -ForegroundColor Green
Write-Host "    Lancer le jeu, puis : python research/tools/extract_key_static.py" -ForegroundColor Cyan
