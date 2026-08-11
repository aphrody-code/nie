<#
.SYNOPSIS
    Lance les harnais du banc d'essai et agrège les résultats en un tableau.

.DESCRIPTION
    Chaque harnais imprime une ligne `clé=valeur` ; ce script les parse et compare.
    Les binaires manquants sont signalés, pas contournés : une case vide dit « pas construit »,
    ce qui n'est pas la même chose que « lent ».

    Prérequis (chacun est vérifié) :
      cargo build --release -p nie-bench -p nie-cli
      pwsh bench/cpp/build.ps1                                    (MSVC, sans vcpkg)
      dotnet build bench/cs/Bench.csproj -c Release               (JIT)
      dotnet publish bench/cs/Bench.csproj -c Release -r win-x64 -p:PublishAot=true   (AOT)
      target/release/nie-bench sample --cpk data/packs/<un>.cpk   (échantillon CRILAYLA)

.PARAMETER Mib
    Taille du tampon CRC32, en Mio (défaut 64).

.PARAMETER Iters
    Décompressions CRILAYLA par mesure (défaut 500).
#>
[CmdletBinding()]
param(
    [int]$Mib = 64,
    [int]$Iters = 500
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root

$sample = Join-Path $root 'bench\data\sample.crilayla'

# Chaque entrée : nom affiché, exécutable, et les arguments par banc.
$harnais = @(
    @{ Nom = 'rust';      Exe = 'target\release\nie-bench.exe'
       Crc = @('crc32', '--mib', $Mib)
       Cri = @('crilayla', '--input', $sample, '--iters', $Iters) }
    @{ Nom = 'cpp';       Exe = 'bench\cpp\bench.exe'
       Crc = @('crc32-slice8', $Mib)
       Cri = @('crilayla', $sample, $Iters) }
    @{ Nom = 'csharp';    Exe = 'bench\cs\bin\Release\net10.0\nie-bench-cs.exe'
       Crc = @('crc32', $Mib)
       Cri = @('crilayla', $sample, $Iters) }
    # `dotnet publish -r win-x64` insère un niveau de plateforme (`bin\x64\`) que le build
    # sans RID n'a pas — d'où deux chemins différents pour le même projet.
    @{ Nom = 'csharp-aot'; Exe = 'bench\cs\bin\x64\Release\net10.0\win-x64\publish\nie-bench-cs.exe'
       Crc = @('crc32', $Mib)
       Cri = @('crilayla', $sample, $Iters) }
)

function Invoke-Harnais {
    # `$Args` est une variable AUTOMATIQUE de PowerShell (les arguments non liés de l'appel) :
    # la nommer en paramètre ne lève pas d'erreur, mais `@Args` continue de désigner
    # l'automatique — les arguments du harnais n'arrivaient jamais, et chaque binaire
    # s'exécutait avec sa commande par défaut.
    param($Exe, $Arguments)
    if (-not (Test-Path $Exe)) { return $null }
    $sortie = & $Exe @Arguments 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { return $null }
    # Les harnais impriment `mib_s=1234.5` ; la virgule décimale dépend de la culture.
    if ($sortie -match 'mib_s=([\d.,]+)') {
        return [double]($matches[1] -replace ',', '.')
    }
    return $null
}

if (-not (Test-Path $sample)) {
    Write-Warning "Échantillon CRILAYLA absent ($sample) — le banc CRILAYLA sera vide."
    Write-Warning "  target\release\nie-bench.exe sample --cpk data\packs\<un>.cpk"
}

$resultats = foreach ($h in $harnais) {
    $exe = Join-Path $root $h.Exe
    $present = Test-Path $exe
    [pscustomobject]@{
        Langage  = $h.Nom
        Construit = if ($present) { 'oui' } else { 'NON' }
        'CRC32 Mio/s'    = if ($present) { Invoke-Harnais $exe $h.Crc } else { $null }
        'CRILAYLA Mio/s' = if ($present -and (Test-Path $sample)) { Invoke-Harnais $exe $h.Cri } else { $null }
    }
}

$resultats | Format-Table -AutoSize

# Vainqueur par banc, calculé et non commenté.
foreach ($banc in 'CRC32 Mio/s', 'CRILAYLA Mio/s') {
    $valides = $resultats | Where-Object { $null -ne $_.$banc }
    if ($valides) {
        $best = $valides | Sort-Object -Property $banc -Descending | Select-Object -First 1
        "{0,-16} gagnant={1} ({2:N0} Mio/s)" -f $banc, $best.Langage, $best.$banc
    } else {
        "{0,-16} aucune mesure" -f $banc
    }
}
