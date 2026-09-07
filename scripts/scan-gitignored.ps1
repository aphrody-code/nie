[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\var\reports'),
    [string[]]$SkipRoots = @('.git', 'node_modules', 'target', 'var', '.next', 'dist', 'build', 'coverage', '.turbo', '.cache')
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

# Git is the source of truth: this includes ignored files at every depth while
# excluding tracked files and untracked files that are not ignored.
$ignored = @(git -C $repo ls-files --others --ignored --exclude-standard -z) -join ''
$paths = @($ignored -split "`0" | Where-Object {
    if (-not $_) { return $false }
    $parts = $_ -split '[\\/]'
    -not ($SkipRoots | Where-Object { $parts -contains $_ })
})
$records = [System.Collections.Generic.List[object]]::new()
foreach ($relative in $paths) {
    $full = Join-Path $repo $relative
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
    try {
        $item = Get-Item -LiteralPath $full -Force
        $hash = (Get-FileHash -LiteralPath $full -Algorithm SHA256 -ErrorAction Stop).Hash
        $records.Add([pscustomobject]@{
            RelativePath = $relative
            Bytes = $item.Length
            Extension = $item.Extension.ToLowerInvariant()
            SHA256 = $hash
        })
    } catch {
        Write-Warning ("Skipped unreadable path: {0}" -f $relative)
    }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$csv = Join-Path $OutputDirectory "gitignored-$stamp.csv"
$json = Join-Path $OutputDirectory "gitignored-$stamp.json"
$records | Sort-Object RelativePath | Export-Csv -LiteralPath $csv -NoTypeInformation -Encoding UTF8
$records | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $json -Encoding UTF8

$total = ($records | Measure-Object Bytes -Sum).Sum
$duplicates = @($records | Group-Object SHA256 | Where-Object Count -gt 1)
Write-Host ("Ignored files: {0}" -f $records.Count)
Write-Host ("Skipped roots: {0}" -f ($SkipRoots -join ', '))
Write-Host ("Total bytes: {0:N0} ({1:N2} GB)" -f $total, ($total / 1GB))
Write-Host ("Exact duplicate groups: {0}" -f $duplicates.Count)
Write-Host "Largest ignored files:"
$records | Sort-Object Bytes -Descending | Select-Object -First 20 RelativePath,Bytes | Format-Table -AutoSize
Write-Host "Reports: $csv and $json"
