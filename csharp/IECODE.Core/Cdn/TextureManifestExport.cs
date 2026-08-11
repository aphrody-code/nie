using System.Text;
using IECODE.Core.Archives;
using IECODE.Core.Formats.Level5;

namespace IECODE.Core.Cdn;

/// <summary>
/// Export NDJSON (1 enregistrement par ligne, champs séparés par TAB) des EN-TÊTES de
/// textures G4TX du jeu IEVR, destiné à être consommé côté Bun pour être poussé dans un
/// index Redis. AUCUN pixel décodé : on ne lit QUE l'en-tête (width/height/format/mips)
/// que <see cref="G4txParser.ParseTextures(System.ReadOnlyMemory{byte})"/> remplit déjà
/// sans décompresser de bloc BCn/DDS (cf. référence prod <c>MenuPngService</c>).
///
/// Acquisition des octets : EN MÉMOIRE via <see cref="CdnFileService"/> (résout le chemin
/// logique vers son CPK puis extrait ce seul fichier déchiffré/décompressé). AUCUNE écriture
/// disque — on n'utilise donc pas <c>CpkService.ExtractFileAsync</c> (qui, lui, écrit sur disque).
///
/// Format AOT-safe (même rationale que <see cref="GameTreeExport"/>) : on construit le texte
/// « à la main » avec un <see cref="StringBuilder"/>, sans réflexion ni <c>JsonSerializer</c>
/// (qui casse sous trim/AOT). Échappement défensif <c>\\</c>/<c>\t</c>/<c>\n</c>/<c>\r</c> sur
/// le chemin pour garantir 1 enregistrement = 1 ligne à nombre de colonnes stable.
/// </summary>
public static class TextureManifestExport
{
    /// <summary>
    /// Pour chaque conteneur <c>.g4tx</c> de l'arbre du jeu, décode l'EN-TÊTE de chacune de
    /// ses textures (sans pixel) et émet UNE ligne NDJSON par texture :
    /// <code>path \t width \t height \t format \t mips</code>
    /// où <c>path</c> est le chemin logique du conteneur <c>.g4tx</c>. Un conteneur multi-textures
    /// (atlas) émet donc plusieurs lignes partageant le même <c>path</c> ; l'ordre suit l'index
    /// interne du conteneur (la 1re ligne = texture principale 0).
    ///
    /// Énumération des conteneurs : <see cref="Archives.CpkService.GetAllCpkFiles"/> +
    /// <see cref="Archives.CpkService.GetFilesInCpk(string, bool)"/>, en filtrant les
    /// <c>FullPath</c> finissant par <c>.g4tx</c> (insensible à la casse). Dédup sur le chemin
    /// logique (override base/patch : un même <c>.g4tx</c> peut exister dans plusieurs CPK).
    ///
    /// Robustesse : toute erreur sur UN conteneur (CPK illisible, en-tête G4TX invalide, octets
    /// introuvables…) est isolée — le conteneur est sauté et compté, jamais de crash global.
    ///
    /// Un seul franchissement du pont node-api-dotnet : tout le manifeste revient en un string.
    /// </summary>
    /// <param name="game">Instance de jeu IEVR installée.</param>
    /// <param name="limit">Nombre maximum de conteneurs <c>.g4tx</c> à traiter (&lt; 0 = illimité).</param>
    /// <returns>NDJSON tabulé <c>path\twidth\theight\tformat\tmips</c>, une ligne par texture.</returns>
    public static string ExportTextureHeadersNdjson(IEVRGame game, int limit = -1)
    {
        ArgumentNullException.ThrowIfNull(game);

        // CDN « sans dump » : résout chemin logique → CPK et extrait EN MÉMOIRE (déchiffré +
        // décompressé), sans aucune écriture disque. Source de vérité = cpk_list.cfg.bin.
        using var cdn = CdnFileService.FromGame(game);

        // 1) Énumérer tous les conteneurs .g4tx servables, dédupliqués par chemin logique.
        //    On parcourt les CPK du dossier packs/ (GetAllCpkFiles → GetFilesInCpk) et on filtre
        //    les FullPath en .g4tx. Le set évite de retraiter un même conteneur présent dans
        //    plusieurs CPK (base + patch) : c'est le CDN qui résout l'override à la lecture.
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var g4txPaths = new List<string>();
        foreach (var cpkPath in game.Cpk.GetAllCpkFiles())
        {
            CpkFileInfo[] files;
            try
            {
                files = game.Cpk.GetFilesInCpk(cpkPath);
            }
            catch
            {
                // CPK illisible → on saute ce pack entier (ses fichiers restent inaccessibles).
                continue;
            }

            foreach (var f in files)
            {
                if (!f.FullPath.EndsWith(".g4tx", StringComparison.OrdinalIgnoreCase))
                    continue;
                var key = CpkFileIndex.Normalize(f.FullPath);
                if (seen.Add(key))
                    g4txPaths.Add(key);
            }
        }

        // 2) Décoder l'en-tête de chaque conteneur (octets en mémoire → G4txParser).
        var sb = new StringBuilder(g4txPaths.Count * 96);
        int processed = 0;

        foreach (var path in g4txPaths)
        {
            if (limit >= 0 && processed >= limit)
                break;

            CdnFile? file;
            try
            {
                // ReadAsync est asynchrone (extraction CPK) : on l'attend de façon synchrone car
                // l'API d'export est synchrone (un seul franchissement du pont côté Bun).
                file = cdn.ReadAsync(path).GetAwaiter().GetResult();
            }
            catch
            {
                // Octets introuvables / CPK incohérent : on saute, on compte au tour suivant.
                processed++;
                continue;
            }

            if (file is not { } cf)
            {
                // Présent à l'énumération mais non résolu par cpk_list (loose / override) : skip.
                processed++;
                continue;
            }

            try
            {
                // ParseTextures remplit width/height/format/mips depuis l'en-tête (DDS ou NXTCH)
                // SANS décompresser le moindre bloc de pixels (cf. G4txParser lignes 166–197).
                var textures = G4txParser.ParseTextures(cf.Bytes);
                foreach (var tex in textures)
                {
                    AppendEscaped(sb, path);
                    sb.Append('\t');
                    sb.Append(tex.Width);
                    sb.Append('\t');
                    sb.Append(tex.Height);
                    sb.Append('\t');
                    sb.Append(tex.Format);
                    sb.Append('\t');
                    sb.Append(tex.MipMapCount);
                    sb.Append('\n');
                }
            }
            catch
            {
                // En-tête G4TX invalide / tronqué : conteneur sauté (compté), pas de crash global.
            }

            processed++;
        }

        return sb.ToString();
    }

    /// <summary>
    /// Ajoute <paramref name="value"/> au tampon en échappant les caractères qui briseraient le
    /// format ligne-orienté tabulé : <c>\\</c>, TAB, CR, LF (inverse appliqué côté Bun).
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
