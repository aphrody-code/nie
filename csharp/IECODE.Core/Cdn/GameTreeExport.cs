using System.Text;
using IECODE.Core.Archives;

namespace IECODE.Core.Cdn;

/// <summary>
/// Export NDJSON (1 enregistrement par ligne, champs séparés par TAB) de l'arbre du
/// jeu IEVR, destiné à être consommé côté Bun pour être poussé dans un index Redis.
///
/// Pourquoi du NDJSON tabulé et non du JSON via <see cref="System.Text.Json.JsonSerializer"/> :
/// IECODE.Core est compilé en mode AOT/trim-friendly ; la sérialisation par réflexion
/// de <c>JsonSerializer</c> casse sous trim/AOT. On construit donc le texte « à la main »
/// avec un <see cref="StringBuilder"/> — déterministe, sans réflexion, sans allocations
/// JSON intermédiaires. Le parsing côté Bun est un simple <c>split("\t")</c> par ligne.
///
/// Échappement : un chemin logique de fichier de jeu ne contient en théorie ni TAB ni
/// newline, mais on échappe défensivement <c>\t</c>/<c>\n</c>/<c>\r</c> (et <c>\\</c>)
/// pour garantir que chaque enregistrement tient sur exactement une ligne et que le
/// nombre de colonnes est stable. Le décodeur Bun applique l'inverse.
/// </summary>
public static class GameTreeExport
{
    /// <summary>
    /// Exporte l'arbre <c>fichier → CPK</c> RÉSOLU depuis <c>cpk_list.cfg.bin</c>
    /// (override base/patch déjà appliqué par <see cref="CpkFileIndex"/> : la dernière
    /// occurrence d'un chemin gagne). UNE ligne par fichier servable :
    /// <code>path \t cpkName \t size</code>
    /// où <c>size</c> est la taille décompressée (octets) telle que listée par cpk_list.
    ///
    /// Les <c>loose files</c> (hors CPK) sont exclus par <see cref="CpkFileIndex.Build"/>.
    /// Un seul franchissement du pont node-api-dotnet : tout l'arbre revient en un string.
    /// </summary>
    public static string ExportTreeNdjson(IEVRGame game)
    {
        ArgumentNullException.ThrowIfNull(game);

        // cpk_list résolu → index O(1) chemin→CPK (même source de vérité que le CDN/dump).
        var cpkList = game.CfgBin.ReadCpkList();
        var index = CpkFileIndex.Build(cpkList, game.PacksPath);

        var sb = new StringBuilder(index.Count * 64);
        foreach (var loc in index.All)
        {
            AppendEscaped(sb, loc.Path);
            sb.Append('\t');
            AppendEscaped(sb, loc.CpkName);
            sb.Append('\t');
            sb.Append(loc.Size);
            sb.Append('\n');
        }

        return sb.ToString();
    }

    /// <summary>
    /// Exporte le TOC d'UN CPK (par son chemin disque) : une ligne par fichier interne,
    /// <code>path \t size \t extractSize \t compressed</code>
    /// où <c>size</c> = taille stockée (compressée) dans le CPK, <c>extractSize</c> =
    /// taille décompressée, <c>compressed</c> = <c>1</c> si compressé sinon <c>0</c>.
    ///
    /// NOTE (piège connu) : <see cref="CpkFileInfo"/> n'expose PAS l'offset d'archive,
    /// donc l'offset n'est pas émis (impossible à fabriquer sans relire le header).
    /// L'enrichissement TOC reste donc partiel : il permet de connaître tailles/flags
    /// par fichier sans re-parser, mais pas d'extraire directement à un offset.
    /// </summary>
    public static string ExportCpkTocNdjson(IEVRGame game, string cpkPath)
    {
        ArgumentNullException.ThrowIfNull(game);
        ArgumentException.ThrowIfNullOrEmpty(cpkPath);

        var files = game.Cpk.GetFilesInCpk(cpkPath);

        var sb = new StringBuilder(files.Length * 96);
        foreach (var f in files)
        {
            AppendEscaped(sb, f.FullPath);
            sb.Append('\t');
            sb.Append(f.FileSize);
            sb.Append('\t');
            sb.Append(f.ExtractSize);
            sb.Append('\t');
            sb.Append(f.IsCompressed ? '1' : '0');
            sb.Append('\n');
        }

        return sb.ToString();
    }

    /// <summary>
    /// Ajoute <paramref name="value"/> au tampon en échappant les caractères qui
    /// briseraient le format ligne-orienté tabulé : <c>\\</c>, TAB, CR, LF.
    /// </summary>
    private static void AppendEscaped(StringBuilder sb, string value)
    {
        if (string.IsNullOrEmpty(value))
            return;

        foreach (char c in value)
        {
            switch (c)
            {
                case '\\': sb.Append("\\\\"); break;
                case '\t': sb.Append("\\t"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                default: sb.Append(c); break;
            }
        }
    }
}
