#!/usr/bin/env pwsh
# setup_ghidra.ps1 — Installation automatique de Ghidra + JDK pour le workflow decomp/
# Usage: ./scripts/setup_ghidra.ps1 [-GhidraVersion "12.0.4"] [-InstallDir "C:\ghidra"]

param(
    [string]$GhidraVersion = "12.0.4",
    [string]$GhidraBuild = "PUBLIC",
    [string]$GhidraDate = "20260303",
    [string]$InstallDir = "$env:USERPROFILE\ghidra",
    [string]$JdkVersion = "21",
    [switch]$SkipJdk,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$ghidraZip = "ghidra_${GhidraVersion}_${GhidraBuild}_${GhidraDate}.zip"
$ghidraUrl = "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_${GhidraVersion}_build/$ghidraZip"
$ghidraDir = Join-Path $InstallDir "ghidra_${GhidraVersion}_${GhidraBuild}"

Write-Host "=== IECODE Ghidra Setup ===" -ForegroundColor Cyan
Write-Host "Ghidra $GhidraVersion -> $InstallDir"

# --- JDK 21+ check ---
if (-not $SkipJdk) {
    $javaVer = $null
    try { $javaVer = (java -version 2>&1 | Select-String -Pattern '"(\d+)') } catch {}

    $needJdk = $true
    if ($javaVer -and $javaVer -match '"(\d+)') {
        $major = [int]$Matches[1]
        if ($major -ge 21) {
            Write-Host "[OK] JDK $major detected" -ForegroundColor Green
            $needJdk = $false
        }
    }

    if ($needJdk) {
        Write-Host "[*] Installing JDK $JdkVersion via winget..." -ForegroundColor Yellow
        winget install --id Microsoft.OpenJDK.$JdkVersion --accept-source-agreements --accept-package-agreements
        $env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-$JdkVersion"
        $env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
        Write-Host "[OK] JDK $JdkVersion installed" -ForegroundColor Green
    }
}

# --- Download Ghidra ---
if ((Test-Path $ghidraDir) -and -not $Force) {
    Write-Host "[OK] Ghidra already installed at $ghidraDir" -ForegroundColor Green
} else {
    $tempZip = Join-Path $env:TEMP $ghidraZip

    if (-not (Test-Path $tempZip)) {
        Write-Host "[*] Downloading Ghidra $GhidraVersion..." -ForegroundColor Yellow
        Write-Host "    URL: $ghidraUrl"
        Invoke-WebRequest -Uri $ghidraUrl -OutFile $tempZip -UseBasicParsing
        Write-Host "[OK] Downloaded ($([math]::Round((Get-Item $tempZip).Length / 1MB))MB)" -ForegroundColor Green
    }

    Write-Host "[*] Extracting to $InstallDir..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Expand-Archive -Path $tempZip -DestinationPath $InstallDir -Force
    Write-Host "[OK] Extracted" -ForegroundColor Green

    Remove-Item $tempZip -ErrorAction SilentlyContinue
}

# --- Install IECODE Ghidra scripts ---
$ghidraScriptsDir = Join-Path $ghidraDir "Ghidra\Features\Base\ghidra_scripts"
$projectScriptsDir = Join-Path $PSScriptRoot "ghidra"

if (Test-Path $projectScriptsDir) {
    Write-Host "[*] Copying IECODE scripts to Ghidra..." -ForegroundColor Yellow
    Copy-Item "$projectScriptsDir\*.java" $ghidraScriptsDir -Force -ErrorAction SilentlyContinue
    Write-Host "[OK] Scripts installed" -ForegroundColor Green
}

# --- Create IECODE project directory ---
$projectDir = Join-Path $InstallDir "projects"
New-Item -ItemType Directory -Path $projectDir -Force | Out-Null

# --- Add to PATH ---
$ghidraBin = Join-Path $ghidraDir "support"
if ($env:PATH -notlike "*$ghidraBin*") {
    Write-Host "[*] Adding Ghidra support/ to session PATH" -ForegroundColor Yellow
    $env:PATH = "$ghidraBin;$env:PATH"
}

# --- Summary ---
Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host "Ghidra:        $ghidraDir"
Write-Host "Projects:      $projectDir"
Write-Host "Headless:      $ghidraBin\analyzeHeadless.bat"
Write-Host ""
Write-Host "Quick start:" -ForegroundColor Cyan
Write-Host "  # Import & analyze nie.exe"
Write-Host "  analyzeHeadless.bat $projectDir IECODE -import `"path\to\nie.exe`" -postScript ExportDecompiled.java"
Write-Host ""
Write-Host "  # Or open GUI"
Write-Host "  $ghidraDir\ghidraRun.bat"
