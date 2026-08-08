using IECODE.Core.Config;

namespace IECODE.Core.Cdn;

/// <summary>
/// Localisation d'un fichier jeu : son chemin logique normalisé, le CPK qui le
/// contient (nom + chemin disque) et sa taille décompressée (depuis cpk_list).
/// </summary>
public readonly record struct CpkFileLocation(string Path, string CpkName, string CpkPath, long Size);

/// <summary>
/// Index O(1) <c>chemin logique → CPK</c>, construit une fois depuis
/// <c>cpk_list.cfg.bin</c>. C'est ce qui permet de SERVIR n'importe quel fichier du jeu
/// à la demande (CDN) sans jamais dumper : on résout le chemin vers son CPK, puis on
/// extrait ce seul fichier en mémoire.
///
/// Gère l'override base/patch comme le dump (<see cref="Dump.DumpService"/>) : une même
/// entrée peut exister dans plusieurs CPK (base + patch) ; la DERNIÈRE occurrence de
/// cpk_list gagne. Les <c>loose files</c> (hors CPK) sont ignorés ici.
/// </summary>
public sealed class CpkFileIndex
{
    private readonly Dictionary<string, CpkFileLocation> _byPath;

    /// <summary>BuildId Steam de référence (pour l'ETag immuable). Vide si inconnu.</summary>
    public string BuildId { get; }

    /// <summary>Nombre de fichiers servables.</summary>
    public int Count => _byPath.Count;

    /// <summary>Toutes les localisations (pour /manifest, diagnostics).</summary>
    public IEnumerable<CpkFileLocation> All => _byPath.Values;

    private CpkFileIndex(Dictionary<string, CpkFileLocation> byPath, string buildId)
    {
        _byPath = byPath;
        BuildId = buildId;
    }

    /// <summary>
    /// Construit l'index depuis les entrées cpk_list et le dossier <c>packs/</c>.
    /// L'itération suit l'ordre de cpk_list ; la dernière écriture d'un chemin gagne
    /// (= override patch sur base, cohérent avec <c>GroupBy(...).Last()</c> du dump).
    /// </summary>
    public static CpkFileIndex Build(CpkListData cpkList, string packsPath, string buildId = "")
    {
        var map = new Dictionary<string, CpkFileLocation>(StringComparer.Ordinal);
        foreach (var f in cpkList.Files)
        {
            if (f.IsLoose || string.IsNullOrEmpty(f.CpkName))
                continue;

            var path = Normalize(f.FullPath);
            map[path] = new CpkFileLocation(
                Path: path,
                CpkName: f.CpkName,
                CpkPath: System.IO.Path.Combine(packsPath, f.CpkName),
                Size: f.FileSize);
        }

        return new CpkFileIndex(map, buildId);
    }

    /// <summary>Résout un chemin logique (tolérant casse/slashes/préfixe) vers son CPK.</summary>
    public bool TryResolve(string path, out CpkFileLocation location) =>
        _byPath.TryGetValue(Normalize(path), out location);

    /// <summary>
    /// ETag fort et stable : les assets sont IMMUABLES pour un buildid donné, donc
    /// <c>buildid + chemin + taille</c> identifie le contenu de façon unique. Permet
    /// <c>Cache-Control: immutable</c> côté HTTP et la revalidation 304 sans relire le CPK.
    /// </summary>
    public string ETag(in CpkFileLocation location) =>
        $"\"{BuildId}-{location.Size:x}-{StableHash(location.Path):x8}\"";

    /// <summary>
    /// Normalise un chemin logique : backslashes → slashes, trim des slashes de tête,
    /// minuscules (cpk_list est traité en <see cref="StringComparer.OrdinalIgnoreCase"/>
    /// par le dump). Un préfixe <c>data/</c> est conservé car il fait partie du chemin réel.
    /// </summary>
    internal static string Normalize(string path)
    {
        if (string.IsNullOrEmpty(path))
            return string.Empty;
        return path.Replace('\\', '/').TrimStart('/').ToLowerInvariant();
    }

    /// <summary>Hash FNV-1a 32 bits (stable entre runs, contrairement à string.GetHashCode).</summary>
    private static uint StableHash(string s)
    {
        uint hash = 2166136261u;
        foreach (char c in s)
        {
            hash ^= c;
            hash *= 16777619u;
        }
        return hash;
    }
}
