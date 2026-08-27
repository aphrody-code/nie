#!/usr/bin/env pwsh
# import_nie.ps1 — Import et analyse headless de nie.exe avec Ghidra
# Exporte automatiquement toutes les fonctions decompilees dans decomp/functions/
#
# Usage:
#   ./scripts/import_nie.ps1 -NiePath "C:\path\to\nie.exe"
#   ./scripts/import_nie.ps1 -NiePath "C:\path\to\nie.exe" -OutputDir "./decomp/functions"
#   ./scripts/import_nie.ps1 -NiePath "C:\path\to\nie.exe" -AnalyzeOnly
#   ./scripts/import_nie.ps1 -NiePath "C:\path\to\nie.exe" -Function "FUN_14023a5b0"

param(
    [Parameter(Mandatory=$true)]
    [string]$NiePath,

    [string]$GhidraDir = "$env:USERPROFILE\ghidra",
    [string]$ProjectDir = "$env:USERPROFILE\ghidra\projects",
    [string]$ProjectName = "IECODE",
    [string]$OutputDir = "",
    [string]$Function = "",
    [switch]$AnalyzeOnly,
    [switch]$Reimport,
    [int]$MaxMemoryMB = 8192
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $PSScriptRoot
$ghidraScripts = Join-Path $PSScriptRoot "ghidra"

# Trouver Ghidra. Deux dispositions coexistent : l'archive decompressee telle quelle
# ($GhidraDir/ghidra_<version>_PUBLIC/support/...) et l'installation a plat
# ($GhidraDir/support/...), celle que produit une extraction dans le dossier cible.
# N'accepter que la premiere faisait echouer la seconde sur "Ghidra not found".
$ghidraHome = $null
if (Test-Path (Join-Path $GhidraDir "support\analyzeHeadless.bat")) {
    $ghidraHome = $GhidraDir
} else {
    $ghidraInstalls = Get-ChildItem $GhidraDir -Directory -Filter "ghidra_*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending
    if ($ghidraInstalls) { $ghidraHome = $ghidraInstalls[0].FullName }
}
if (-not $ghidraHome) {
    Write-Error "Ghidra not found in $GhidraDir (ni a plat, ni en sous-dossier ghidra_*). Run setup_ghidra.ps1 first."
    exit 1
}
$analyzeHeadless = Join-Path $ghidraHome "support\analyzeHeadless.bat"

if (-not (Test-Path $analyzeHeadless)) {
    Write-Error "analyzeHeadless.bat not found at $analyzeHeadless"
    exit 1
}

if (-not (Test-Path $NiePath)) {
    Write-Error "nie.exe not found at $NiePath"
    exit 1
}

# Default output
if (-not $OutputDir) {
    $OutputDir = Join-Path $scriptRoot "decomp\functions"
}

New-Item -ItemType Directory -Path $ProjectDir -Force | Out-Null
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

Write-Host "=== IECODE Ghidra Import ===" -ForegroundColor Cyan
Write-Host "Ghidra:    $ghidraHome"
Write-Host "nie.exe:   $NiePath"
Write-Host "Project:   $ProjectDir\$ProjectName"
Write-Host "Output:    $OutputDir"
Write-Host ""

$env:MAXMEM = "$MaxMemoryMB"

# Check si le projet existe deja
$projectExists = Test-Path (Join-Path $ProjectDir "$ProjectName.gpr")

if ($Reimport -and $projectExists) {
    Write-Host "[*] Removing existing project..." -ForegroundColor Yellow
    Remove-Item (Join-Path $ProjectDir "$ProjectName.gpr") -Force
    Remove-Item (Join-Path $ProjectDir "$ProjectName.rep") -Recurse -Force -ErrorAction SilentlyContinue
    $projectExists = $false
}

if ($Function) {
    # --- Export d'une seule fonction ---
    Write-Host "[*] Exporting single function: $Function" -ForegroundColor Yellow
    $outFile = Join-Path $OutputDir "exported_$($Function.ToLower()).c"

    if ($projectExists) {
        & $analyzeHeadless $ProjectDir $ProjectName `
            -process "nie.exe" `
            -noanalysis `
            -scriptPath $ghidraScripts `
            -postScript ExportSingleFunction.java $outFile $Function
    } else {
        & $analyzeHeadless $ProjectDir $ProjectName `
            -import $NiePath `
            -scriptPath $ghidraScripts `
            -preScript IECODEAnalyzer.java `
            -postScript ExportSingleFunction.java $outFile $Function
    }

    if (Test-Path $outFile) {
        Write-Host "[OK] Exported: $outFile" -ForegroundColor Green
        Write-Host ""
        Get-Content $outFile | Select-Object -First 20
    }

} elseif ($AnalyzeOnly) {
    # --- Analyse seulement (pas d'export) ---
    Write-Host "[*] Running analysis only..." -ForegroundColor Yellow

    if ($projectExists) {
        & $analyzeHeadless $ProjectDir $ProjectName `
            -process "nie.exe" `
            -scriptPath $ghidraScripts `
            -preScript IECODEAnalyzer.java
    } else {
        & $analyzeHeadless $ProjectDir $ProjectName `
            -import $NiePath `
            -scriptPath $ghidraScripts `
            -preScript IECODEAnalyzer.java
    }

    Write-Host "[OK] Analysis complete. Open project in Ghidra GUI to explore." -ForegroundColor Green

} else {
    # --- Import + analyse + export complet ---
    Write-Host "[*] Full pipeline: import -> analyze -> export all functions" -ForegroundColor Yellow
    Write-Host "[!] This may take 30-60 minutes depending on CPU..." -ForegroundColor Yellow
    Write-Host ""

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    if ($projectExists) {
        & $analyzeHeadless $ProjectDir $ProjectName `
            -process "nie.exe" `
            -scriptPath $ghidraScripts `
            -postScript ExportDecompiled.java $OutputDir
    } else {
        & $analyzeHeadless $ProjectDir $ProjectName `
            -import $NiePath `
            -scriptPath $ghidraScripts `
            -preScript IECODEAnalyzer.java `
            -postScript ExportDecompiled.java $OutputDir
    }

    $stopwatch.Stop()

    $cFiles = Get-ChildItem $OutputDir -Filter "*.c" -ErrorAction SilentlyContinue
    $totalFuncs = 0
    foreach ($f in $cFiles) {
        $totalFuncs += (Select-String -Path $f.FullName -Pattern "^// Adresse:" -SimpleMatch).Count
    }

    Write-Host ""
    Write-Host "=== Export Complete ===" -ForegroundColor Green
    Write-Host "Time:      $([math]::Round($stopwatch.Elapsed.TotalMinutes, 1)) minutes"
    Write-Host "Files:     $($cFiles.Count) .c files"
    Write-Host "Functions: $totalFuncs exported"
    Write-Host "Output:    $OutputDir"

    if (Test-Path (Join-Path $OutputDir "INDEX.md")) {
        Write-Host ""
        Write-Host "--- INDEX.md ---" -ForegroundColor Cyan
        Get-Content (Join-Path $OutputDir "INDEX.md")
    }
}
