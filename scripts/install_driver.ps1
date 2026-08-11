#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installe et demarre le service iecode_memread (driver kernel).

.DESCRIPTION
  1. Verifie que test signing est actif (sinon l'indique a l'utilisateur)
  2. Genere un certificat de test auto-signe si besoin
  3. Signe le .sys
  4. sc create + sc start

.PARAMETER SysPath
  Chemin vers iecode_memread.sys. Defaut : src/driver/iecode_memread/build/iecode_memread.sys

.EXAMPLE
  .\install_driver.ps1
  .\install_driver.ps1 -SysPath C:\path\to\iecode_memread.sys
#>

[CmdletBinding()]
param(
    [string]$SysPath = (Join-Path $PSScriptRoot "..\src\driver\iecode_memread\build\iecode_memread.sys"),
    [string]$ServiceName = 'iecode_memread'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $pr = [Security.Principal.WindowsPrincipal]$id
    if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Ce script doit etre execute en administrateur"
    }
}

Require-Admin

if (-not (Test-Path $SysPath)) {
    throw "Driver introuvable : $SysPath — builder d'abord via build_driver.ps1"
}
$SysPath = (Resolve-Path $SysPath).Path

Write-Host "[*] Driver : $SysPath" -ForegroundColor Cyan

# --- 1. Test signing ---------------------------------------------------------
Write-Host "[*] Verification test signing..." -ForegroundColor Cyan
$bcd = bcdedit /enum '{current}' | Out-String
if ($bcd -notmatch 'testsigning\s+Yes') {
    Write-Host "[!] Test signing DESACTIVE." -ForegroundColor Yellow
    Write-Host "    Activer avec : bcdedit /set testsigning on" -ForegroundColor Yellow
    Write-Host "    Puis REDEMARRER la machine." -ForegroundColor Yellow
    $resp = Read-Host "Activer maintenant ? [y/N]"
    if ($resp -eq 'y') {
        bcdedit /set testsigning on
        Write-Host "[+] Active. REDEMARRE puis relance ce script." -ForegroundColor Green
    }
    exit 1
}
Write-Host "[+] Test signing actif" -ForegroundColor Green

# --- 2. Certificat de test ---------------------------------------------------
$certName = "iecode_memread_test_cert"
$cert = Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.Subject -eq "CN=$certName" } | Select-Object -First 1

if (-not $cert) {
    Write-Host "[*] Generation certificat de test..." -ForegroundColor Cyan
    $cert = New-SelfSignedCertificate `
        -Subject "CN=$certName" `
        -Type CodeSigningCert `
        -KeyUsage DigitalSignature `
        -CertStoreLocation Cert:\LocalMachine\My `
        -NotAfter (Get-Date).AddYears(5)

    # Installer aussi en Root + TrustedPublisher pour que Windows accepte la signature
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root", "LocalMachine")
    $store.Open("ReadWrite"); $store.Add($cert); $store.Close()

    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store("TrustedPublisher", "LocalMachine")
    $store.Open("ReadWrite"); $store.Add($cert); $store.Close()

    Write-Host "[+] Certificat cree et installe" -ForegroundColor Green
}
Write-Host "[+] Certificat : $($cert.Thumbprint)" -ForegroundColor Green

# --- 3. Signer le .sys -------------------------------------------------------
Write-Host "[*] Signature du driver..." -ForegroundColor Cyan
Set-AuthenticodeSignature -FilePath $SysPath -Certificate $cert -HashAlgorithm SHA256 | Out-Null
$sig = Get-AuthenticodeSignature $SysPath
if ($sig.Status -ne 'Valid') {
    throw "Echec de signature : $($sig.Status) — $($sig.StatusMessage)"
}
Write-Host "[+] Signature valide" -ForegroundColor Green

# --- 4. Enregistrer le service ----------------------------------------------
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "[*] Service deja existant — stop + delete" -ForegroundColor Yellow
    if ($existing.Status -eq 'Running') {
        & sc.exe stop $ServiceName | Out-Null
        Start-Sleep -Seconds 1
    }
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 1
}

Write-Host "[*] sc create $ServiceName..." -ForegroundColor Cyan
& sc.exe create $ServiceName type= kernel start= demand binPath= $SysPath | Out-Null
if ($LASTEXITCODE -ne 0) { throw "sc create a echoue" }

Write-Host "[*] sc start $ServiceName..." -ForegroundColor Cyan
& sc.exe start $ServiceName | Out-Null
if ($LASTEXITCODE -ne 0) { throw "sc start a echoue — verifier dbgview pour le message kernel" }

Write-Host "[+] Driver charge. Device : \\.\IecodeMemRead" -ForegroundColor Green
Write-Host "    Desinstaller : .\uninstall_driver.ps1" -ForegroundColor Gray
