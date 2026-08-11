namespace IECODE.Core.Cdn;

/// <summary>
/// Résultat de la résolution d'un chemin logique azalee vers le conteneur G4TX du jeu
/// et la sous-image (texture interne ou région d'atlas) à décoder.
/// </summary>
/// <param name="ContainerPath">
/// Chemin logique normalisé du conteneur dans les CPK, ex.
/// <c>data/dx11/menu/200_icon/10_icon_chr/face/c01000010_l.g4tx</c>. Servable tel quel via
/// <see cref="CdnFileService"/>.
/// </param>
/// <param name="TextureName">
/// Nom EXACT de la texture (ou sous-texture) à l'intérieur du G4TX, ex. <c>c01000010_1_l00</c>.
/// C'est ce nom que le décodeur cherche dans <c>G4txTexture.Name</c> (puis dans les sous-textures).
/// </param>
/// <param name="AzaleePath">
/// Chemin logique azalee normalisé (sans préfixe CDN), ex.
/// <c>dx11/menu/200_icon/10_icon_chr/face/c01000010_l_c01000010_1_l00.png</c>.
/// </param>
public readonly record struct MenuAssetRef(string ContainerPath, string TextureName, string AzaleePath);

/// <summary>
/// Résolveur de chemins « azalee » (<c>cdn.rosegriffon.fr/dx11/menu/**.png</c>) ⟷ conteneurs G4TX
/// du jeu + sous-texture à décoder.
///
/// RÈGLE UNIVERSELLE (vérifiée sur l'install réel) : tout PNG d'icône azalee a la forme
/// <c>&lt;dir&gt;/{stem}_{texname}.png</c> où <c>{stem}.g4tx</c> est le conteneur dans
/// <c>data/dx11/menu/&lt;dir&gt;/</c> et <c>{texname}</c> est le nom d'une texture/sous-texture
/// DANS ce G4TX. Le décodage de cette (sous-)texture en PNG lossless mip-0 produit l'icône.
///
/// Exemples réels (stem → textures internes) :
///   face/c01001640_l.g4tx          → c01001640_1_l00, c01001640_2_l00   → ..._l_c01001640_1_l00.png
///   uniform/u020653_10_00_l.g4tx   → u020653_10_00_1 (front), _2 (back) → ..._l_u020653_10_00_1.png
///   aura_fs/k000630_l.g4tx         → k000630_l00                         → k000630_l_k000630_l00.png
///   aura_soul/a000420_l.g4tx       → a000420_l00                         → a000420_l_a000420_l00.png
///   01_icon_emblem/em040017.g4tx   → em040017                            → em040017_em040017.png
///   02_icon_item/icon_item04.g4tx  → eq_mi0105501 (atlas, 80 tex)        → icon_item04_eq_mi0105501.png
///   220_img/telop_waza/whd01320.g4tx → whd01320                          → whd01320_whd01320.png
///
/// La résolution AVANT (azalee → conteneur) est purement lexicale et n'ouvre aucun CPK :
/// on coupe le nom de fichier au premier <c>_</c> qui isole un stem de conteneur connu
/// (via <see cref="CpkFileIndex"/>). La construction de la map INVERSE (conteneur → azalee)
/// énumère les G4TX et lit leurs noms de textures (cf. <see cref="MenuPngService"/>).
/// </summary>
public static class MenuAssetResolver
{
    /// <summary>Racine logique des assets menu dans les CPK (préfixe normalisé, minuscules).</summary>
    public const string MenuRoot = "data/dx11/menu/";

    /// <summary>
    /// Préfixe CDN qu'azalee utilise (<c>cdn.rosegriffon.fr/dx11/menu/…</c>). Le segment
    /// <c>data/</c> est implicite côté nginx (alias) ; on le rajoute pour viser les CPK.
    /// </summary>
    public const string AzaleePrefix = "dx11/menu/";

    /// <summary>
    /// Normalise un chemin azalee/CDN : retire un éventuel schéma/host, le préfixe
    /// <c>data/</c>, met en minuscules, slashes avant. Renvoie p.ex.
    /// <c>dx11/menu/200_icon/10_icon_chr/face/c01000010_l_c01000010_1_l00.png</c>.
    /// </summary>
    public static string NormalizeAzaleePath(string path)
    {
        if (string.IsNullOrEmpty(path)) return string.Empty;
        var p = path.Replace('\\', '/').Trim();

        // Retire un host/schéma éventuel.
        int schemeIdx = p.IndexOf("://", StringComparison.Ordinal);
        if (schemeIdx >= 0)
        {
            int slash = p.IndexOf('/', schemeIdx + 3);
            p = slash >= 0 ? p[slash..] : "/";
        }
        p = p.TrimStart('/').ToLowerInvariant();

        // Tolère un préfixe data/ déjà présent.
        if (p.StartsWith("data/", StringComparison.Ordinal))
            p = p["data/".Length..];
        return p;
    }

    /// <summary>
    /// Convertit un chemin azalee (<c>dx11/menu/…</c>) en chemin de CONTENEUR G4TX logique
    /// dans les CPK (<c>data/dx11/menu/…/{stem}.g4tx</c>) + le nom de texture interne.
    ///
    /// <paramref name="containerExists"/> sert d'oracle (typiquement
    /// <c>p => cdn.TryResolve(p, out _)</c>) : on essaie, du plus long au plus court, chaque coupure
    /// <c>{stem}_{rest}.png</c> et on garde la première dont <c>{stem}.g4tx</c> existe réellement
    /// dans les CPK. Cela gère sans cas particulier : face/uniform/aura/emblem/item/telop (stems
    /// contenant des <c>_</c>, ex. <c>u020653_10_00_l</c>, <c>icon_item04</c>). Renvoie false si
    /// aucun conteneur ne correspond.
    /// </summary>
    public static bool TryResolve(string azaleePath, Func<string, bool> containerExists, out MenuAssetRef result)
    {
        result = default;
        var norm = NormalizeAzaleePath(azaleePath);
        if (!norm.StartsWith(AzaleePrefix, StringComparison.Ordinal))
            return false;

        // Découpe dir / filename.png
        int lastSlash = norm.LastIndexOf('/');
        if (lastSlash < 0) return false;
        var dir = norm[..lastSlash];                 // dx11/menu/…/face
        var file = norm[(lastSlash + 1)..];          // {stem}_{tex}.png
        if (!file.EndsWith(".png", StringComparison.Ordinal)) return false;
        var stem = file[..^".png".Length];           // {stem}_{tex}

        var containerDir = "data/" + dir + "/";      // data/dx11/menu/…/face/

        // Essaie chaque position d'underscore comme frontière stem|texname,
        // du plus long stem au plus court (greedy : préfère le conteneur le plus spécifique).
        for (int u = stem.LastIndexOf('_'); u > 0; u = stem.LastIndexOf('_', u - 1))
        {
            var candStem = stem[..u];                // candidat nom de conteneur
            var texName = stem[(u + 1)..];           // reste = texture interne
            if (texName.Length == 0) continue;

            var containerPath = containerDir + candStem + ".g4tx";
            if (containerExists(containerPath))
            {
                result = new MenuAssetRef(
                    ContainerPath: CpkFileIndex.Normalize(containerPath),
                    TextureName: texName,
                    AzaleePath: norm);
                return true;
            }
        }

        // Cas dégénéré : pas d'underscore → conteneur == fichier (rare, mais sûr).
        var direct = containerDir + stem + ".g4tx";
        if (containerExists(direct))
        {
            result = new MenuAssetRef(CpkFileIndex.Normalize(direct), stem, norm);
            return true;
        }
        return false;
    }

    /// <summary>
    /// Construit le chemin azalee canonique d'une (sous-)texture à partir de son conteneur.
    /// C'est l'inverse de <see cref="TryResolve"/> : <c>{stem}.g4tx</c> + <c>{texName}</c>
    /// → <c>{dir}/{stem}_{texName}.png</c> (sans préfixe <c>data/</c>).
    /// </summary>
    public static string ToAzaleePath(string containerLogicalPath, string textureName)
    {
        var norm = CpkFileIndex.Normalize(containerLogicalPath);
        if (norm.StartsWith("data/", StringComparison.Ordinal))
            norm = norm["data/".Length..];
        int lastSlash = norm.LastIndexOf('/');
        var dir = lastSlash >= 0 ? norm[..lastSlash] : string.Empty;
        var fileName = lastSlash >= 0 ? norm[(lastSlash + 1)..] : norm;
        var stem = fileName.EndsWith(".g4tx", StringComparison.Ordinal)
            ? fileName[..^".g4tx".Length]
            : fileName;
        return (dir.Length > 0 ? dir + "/" : string.Empty) + $"{stem}_{textureName}.png";
    }

    /// <summary>
    /// True si ce chemin logique de CPK est un conteneur G4TX du sous-arbre menu (donc
    /// candidat à l'export PNG azalee).
    /// </summary>
    public static bool IsMenuG4tx(string logicalPath)
    {
        var p = CpkFileIndex.Normalize(logicalPath);
        return p.StartsWith(MenuRoot, StringComparison.Ordinal)
            && p.EndsWith(".g4tx", StringComparison.Ordinal);
    }

    /// <summary>
    /// Énumère tous les conteneurs G4TX du sous-arbre <c>data/dx11/menu/**</c> connus de l'index
    /// (la source de tous les PNG azalee). Ne lit AUCUN CPK : juste l'index cpk_list.
    /// </summary>
    public static IEnumerable<CpkFileLocation> EnumerateMenuContainers(CdnFileService cdn)
    {
        foreach (var loc in cdn.All)
            if (IsMenuG4tx(loc.Path))
                yield return loc;
    }
}
