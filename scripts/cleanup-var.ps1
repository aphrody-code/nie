[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$ConfirmCleanup,
    [switch]$IncludeVcpkg,
    [switch]$ScanRepoRoot
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$var = Join-Path $repo 'var'
if (-not (Test-Path -LiteralPath $var -PathType Container)) {
    throw "Missing var directory: $var"
}

# Deliberately narrow: assets, reverse-engineering dumps, and dated backups remain untouched.
$targets = [System.Collections.Generic.List[string]]::new()
foreach ($name in @('log', 'captures', 'scratch')) {
    $path = Join-Path $var $name
    if (Test-Path -LiteralPath $path -PathType Container) { $targets.Add($path) }
}
Get-ChildItem -LiteralPath $var -File -Force |
    Where-Object { $_.Extension -in '.log', '.tmp', '.temp', '.bak', '.out', '.err' } |
    ForEach-Object { $targets.Add($_.FullName) }
Get-ChildItem -LiteralPath $var -Directory -Force |
    Where-Object { $_.Name -like 'model-cache-*' } |
    ForEach-Object { $targets.Add($_.FullName) }

if ($IncludeVcpkg) {
    $vcpkg = Join-Path $var 'vcpkg'
    if (Test-Path -LiteralPath $vcpkg -PathType Container) { $targets.Add($vcpkg) }
}

if ($ScanRepoRoot) {
    # Root scan is opt-in and excludes source/data/build trees by construction.
    foreach ($name in @('coverage', 'test-results', 'playwright-report', '.nyc_output', 'tmp', 'temp', '.cache')) {
        $path = Join-Path $repo $name
        if (Test-Path -LiteralPath $path -PathType Container) { $targets.Add($path) }
    }
    Get-ChildItem -LiteralPath $repo -File -Force |
        Where-Object { $_.Extension -in '.log', '.tmp', '.temp', '.bak', '.out', '.err' } |
        ForEach-Object { $targets.Add($_.FullName) }
}

# Exact duplicate files are removed only outside preserved dated backups and asset roots.
$hashes = @{}
$preserved = @('re-backup-*', 'vfs', 'lua-vfs', 'lua-vfs-all', 'iecode-extract', 'vcpkg')
Get-ChildItem -LiteralPath $var -Recurse -File -Force |
    Where-Object {
        $relative = $_.FullName.Substring($var.Length).TrimStart('\')
        -not ($preserved | Where-Object { $relative -like "$_\*" })
    } |
    ForEach-Object {
        try {
            $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256 -ErrorAction Stop).Hash
            if ($hashes.ContainsKey($hash)) { $targets.Add($_.FullName) } else { $hashes[$hash] = $_.FullName }
        } catch {
            Write-Warning ("Skipping unreadable file: {0}" -f $_.FullName)
        }
    }

$targets = @($targets | Sort-Object -Unique)
$bytes = ($targets | ForEach-Object { if (Test-Path -LiteralPath $_ -PathType Leaf) { (Get-Item $_).Length } }) | Measure-Object -Sum
Write-Host ("Candidates: {0} items, {1:N0} bytes" -f $targets.Count, $bytes.Sum)
$targets | ForEach-Object { Write-Host "  $_" }

if (-not $ConfirmCleanup) {
    Write-Host "Preview only. Re-run with -ConfirmCleanup to delete these exact paths."
    exit 0
}

foreach ($target in $targets) {
    # A parent directory may already have removed a nested candidate.
    if ((Test-Path -LiteralPath $target) -and $PSCmdlet.ShouldProcess($target, 'Remove cleanup artifact')) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}
Write-Host 'Cleanup complete.'
