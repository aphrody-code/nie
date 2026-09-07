[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$ConfirmCleanup,
    [switch]$IncludeVcpkg
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$protected = @('.git', 'data', 'var', '.venv', 'target', 'node_modules', 're-backup-*', 'vfs', 'lua-vfs', 'lua-vfs-all', 'iecode-extract')
$ignored = @(git -C $repo ls-files --others --ignored --exclude-standard -z) -join ''
$paths = @($ignored -split "`0" | Where-Object { $_ })
$tracked = @{}
git -C $repo ls-files -z | ForEach-Object { $tracked[$_] = $true }
$candidates = [System.Collections.Generic.List[string]]::new()
$hashes = @{}

foreach ($relative in $paths) {
    $parts = $relative -split '[\\/]'
    if ($protected | Where-Object { $parts -contains $_ -or $relative -like $_ }) { continue }
    $full = Join-Path $repo $relative
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
    $item = Get-Item -LiteralPath $full -Force
    $isArtifact = $item.Extension.ToLowerInvariant() -in @('.log', '.tmp', '.temp', '.bak', '.out', '.err') -or
        ($parts | Where-Object { $_ -in @('coverage', 'test-results', 'playwright-report', '.nyc_output', '.cache', 'tmp', 'temp', 'scratch') })
    if ($isArtifact) { $candidates.Add($full); continue }
    try {
        $hash = (Get-FileHash -LiteralPath $full -Algorithm SHA256 -ErrorAction Stop).Hash
        if ($hashes.ContainsKey($hash)) {
            # Keep the first deterministic path; delete only an exact duplicate.
            $candidates.Add($full)
        } else { $hashes[$hash] = $full }
    } catch { Write-Warning "Unreadable file skipped: $relative" }
}

$candidates = @($candidates | Sort-Object -Unique)
$bytes = ($candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    ForEach-Object { (Get-Item -LiteralPath $_).Length } | Measure-Object -Sum).Sum
Write-Host ("Safe cleanup candidates: {0} files, {1:N0} bytes ({2:N2} GB)" -f $candidates.Count, $bytes, ($bytes / 1GB))
$candidates | ForEach-Object { Write-Host "  $_" }

if (-not $ConfirmCleanup) {
    Write-Host 'Preview only. Add -ConfirmCleanup to remove these exact files.'
    exit 0
}
foreach ($path in $candidates) {
    if ((Test-Path -LiteralPath $path) -and $PSCmdlet.ShouldProcess($path, 'Remove ignored cleanup artifact')) {
        Remove-Item -LiteralPath $path -Force
    }
}
Write-Host 'Safe cleanup complete.'
