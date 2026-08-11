using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using IECODE.Core.Formats.Menu;

namespace IECODE.Core.Cdn;

// ── Modèle de sortie (= contrat re/menu-layout.schema.md, consommé par @rose-griffon/menu-render) ──

/// <summary>Transform 2D d'un objet-menu (pixels sur canvas 1280×720). Fourni par le squelette G4PKM.</summary>
public sealed record MenuTransform(
    double X, double Y, double ScaleX = 1, double ScaleY = 1, double Rot = 0,
    double AnchorX = 0.5, double AnchorY = 0.5);

/// <summary>Sprite d'un objet : chemin logique g4tx + URL PNG servie + dimensions natives.</summary>
public sealed record MenuLayoutSprite(string LogicalPath, string PngUrl, int W, int H);

/// <summary>Texte d'un objet (résolu via dico de hash + common/text/&lt;locale&gt;).</summary>
public sealed record MenuLayoutText(string Key, uint KeyHash, string? Value,
    string Font = "nie_main", int Size = 24, string Color = "#ffffff", string Align = "center");

/// <summary>Animations open/close (noms de motions résolus).</summary>
public sealed record MenuLayoutAnim(string? Open, string? Close);

/// <summary>Un objet du layout exporté.</summary>
public sealed record MenuLayoutObject(
    string Name,
    string? Parent,
    MenuTransform Transform,
    int DrawPriority,
    int DrawType,
    string Camera,
    MenuLayoutSprite? Sprite,
    MenuLayoutText? Text,
    MenuLayoutAnim? Anim);

/// <summary>Layout complet d'un écran de menu (sortie de <see cref="MenuLayoutExporter"/>).</summary>
public sealed record MenuLayout(
    string Screen,
    string Locale,
    MenuCanvas Canvas,
    IReadOnlyList<MenuLayoutObject> Objects);

/// <summary>Dimensions du canvas de référence.</summary>
public sealed record MenuCanvas(int W = 1280, int H = 720);

/// <summary>
/// Exporte un écran de menu du jeu en <c>menu-layout.json</c> pixel-perfect, en combinant :
/// l'arbre d'objets <see cref="ObjbParser"/> (.objbin), les transforms 2D du squelette G4PKM,
/// les sprites PNG lossless (<see cref="MenuPngService"/>) et le texte localisé.
///
/// Les deux briques RE-lourdes — transforms G4PKM (agent B) et résolution de hash (agent C) — sont
/// injectées en délégués pour un câblage propre ; à défaut, placeholders neutres (transform identité,
/// hash en hex) → l'export marche dès maintenant et se raffine quand B/C atterrissent.
/// </summary>
public sealed class MenuLayoutExporter
{
    private readonly CdnFileService _cdn;
    private readonly MenuPngService _png;

    /// <summary>g4pkmPath → transform 2D de l'objet (agent B). Null = placeholder identité.</summary>
    public Func<string, MenuTransform?>? TransformProvider { get; set; }

    /// <summary>hash CRC-32 → nom lisible (agent C). Null = hex.</summary>
    public Func<uint, string?>? HashResolver { get; set; }

    /// <summary>(nom de slot texte, locale) → chaîne affichée. Null = clé brute.</summary>
    public Func<string, string, string?>? TextResolver { get; set; }

    public MenuLayoutExporter(CdnFileService cdn, MenuPngService? png = null)
    {
        _cdn = cdn;
        _png = png ?? new MenuPngService(cdn);
    }

    /// <summary>
    /// Tous les chemins logiques d'objbin de menu (<c>data/common/gamedata/menu/obj/*.objbin</c>).
    /// </summary>
    public IEnumerable<string> EnumerateObjbinPaths() =>
        _cdn.All.Select(l => l.Path)
            .Where(p => p.Contains("/menu/obj/", StringComparison.OrdinalIgnoreCase)
                        && p.EndsWith(".objbin", StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Exporte l'écran <paramref name="screenId"/> (ex. <c>50_title</c>) pour une locale donnée.
    /// Les objbin retenus sont ceux dont la texture pointe sur <c>menu/&lt;screenId&gt;/</c>.
    /// Écrit les PNG des sprites sous <paramref name="assetsDir"/> si fourni (layout auto-suffisant).
    /// </summary>
    public async Task<MenuLayout> ExportScreenAsync(
        string screenId, string locale, string? assetsDir = null, CancellationToken ct = default)
    {
        var seg = $"menu/{screenId}/";
        var objects = new List<MenuLayoutObject>();

        foreach (var path in EnumerateObjbinPaths())
        {
            ct.ThrowIfCancellationRequested();
            MenuObject obj;
            try
            {
                var file = await _cdn.ReadAsync(path, ct).ConfigureAwait(false);
                if (file is not { } f || !ObjbParser.IsObjb(f.Bytes)) continue;
                obj = ObjbParser.Parse(f.Bytes);
            }
            catch (ObjbParseException) { continue; }

            // Filtre écran : la texture (ou le g4pkm) référence menu/<screen>/.
            var refPath = obj.G4txPath ?? obj.G4pkmPath ?? "";
            if (!refPath.Contains(seg, StringComparison.OrdinalIgnoreCase)) continue;

            objects.Add(await BuildObjectAsync(obj, locale, assetsDir, ct).ConfigureAwait(false));
        }

        // z-order croissant = au-dessus.
        objects.Sort((a, b) => a.DrawPriority.CompareTo(b.DrawPriority));
        return new MenuLayout(screenId, locale, new MenuCanvas(), objects);
    }

    private async Task<MenuLayoutObject> BuildObjectAsync(
        MenuObject obj, string locale, string? assetsDir, CancellationToken ct)
    {
        var render = obj.Components.OfType<RenderComponent>().FirstOrDefault();
        var anim = obj.Components.OfType<AnimationComponent>().FirstOrDefault();
        var textC = obj.Components.OfType<TextComponent>().FirstOrDefault();

        MenuLayoutSprite? sprite = null;
        if (obj.G4txPath is { } g4tx)
            sprite = await RenderSpriteAsync(g4tx, locale, assetsDir, ct).ConfigureAwait(false);

        // Transform = pose du bone base du squelette G4PKM (ToCss 1280×720) + dimensionnement au sprite.
        // Pour les objets animés (IsOffScreen1920 en bind pose), on applique GetMotionFinalPose
        // qui remonte la hiérarchie osseuse jusqu'à un ancêtre dans l'écran.
        bool hasOpenMotion = anim?.MotOpenHash != 0;
        var transform = (obj.G4pkmPath is { } gp
                            ? TransformProvider?.Invoke(gp) ?? await ReadBoneTransformAsync(gp, sprite, hasOpenMotion, ct).ConfigureAwait(false)
                            : null)
                        ?? new MenuTransform(640, 360);

        MenuLayoutText? text = null;
        if (textC?.Entries.FirstOrDefault() is { } e)
        {
            var hash = e.Hashes.FirstOrDefault();
            var key = e.Key;
            var value = TextResolver?.Invoke(key, locale)
                        ?? (hash != 0 ? HashResolver?.Invoke(hash) : null)
                        ?? key;
            text = new MenuLayoutText(key, hash, value);
        }

        MenuLayoutAnim? animOut = anim is null ? null : new MenuLayoutAnim(
            ResolveName(anim.MotOpenHash), ResolveName(anim.MotCloseHash));

        return new MenuLayoutObject(
            obj.Name, null, transform,
            render?.DrawPriority ?? 0, render?.DrawType ?? 0,
            ResolveName(render?.CameraNameHash ?? 0) ?? "menu",
            sprite, text, animOut);
    }

    private async Task<MenuLayoutSprite?> RenderSpriteAsync(
        string g4txLogical, string locale, string? assetsDir, CancellationToken ct)
    {
        const StringComparison OIC = StringComparison.OrdinalIgnoreCase;
        var baseRel = g4txLogical.TrimStart('#', '/');
        if (baseRel.StartsWith("menu/", OIC)) baseRel = "dx11/" + baseRel;

        // Le <LG> peut être une locale, "common", ou absent (texture non-localisée).
        foreach (var rel in new[]
                 {
                     baseRel.Replace("<LG>", locale, OIC),
                     baseRel.Replace("/<LG>", "", OIC).Replace("<LG>/", "", OIC),
                     baseRel.Replace("<LG>", "common", OIC),
                     baseRel.Replace("<LG>", "en", OIC),
                 })
        {
            var container = rel.StartsWith("data/", OIC) ? rel : "data/" + rel;
            IReadOnlyList<MenuPng> pngs;
            try { pngs = await _png.RenderAllAsync(container, ct).ConfigureAwait(false); }
            catch { continue; }
            if (pngs.Count == 0) continue;
            var p = pngs[0];
            if (p.Bytes is not { Length: > 0 }) continue;

            var pngUrl = "/" + rel[..^".g4tx".Length].TrimStart('/') + ".png";
            if (!string.IsNullOrEmpty(assetsDir))
            {
                var dest = Path.Combine(assetsDir, pngUrl.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                await File.WriteAllBytesAsync(dest, p.Bytes, ct).ConfigureAwait(false);
            }
            return new MenuLayoutSprite(rel, pngUrl, p.Width, p.Height);
        }
        return null;
    }

    /// <summary>
    /// Lit le squelette G4PKM de l'objet et renvoie le transform du bone de placement,
    /// converti en pixels 1280×720 et dimensionné au sprite.
    ///
    /// <para>Pour les objets animés dont la bind pose est hors-écran (ex. titre00_09 à tx=1873),
    /// on utilise <see cref="G4pkmMotion.GetMotionFinalPose"/> qui remonte la hiérarchie osseuse
    /// vers le premier ancêtre dans l'écran. Cela fournit une position CSS valide même quand
    /// les keyframes de la motion "open" ne sont pas encodés dans le G4PKM.</para>
    ///
    /// <para>Gestion des variantes de nom G4PKM : si le chemin contient un suffixe de plateforme
    /// (<c>_xsx</c>, <c>_ps5</c>, <c>_nx</c>, <c>_st</c>, <c>_ps</c>), on essaie aussi le chemin
    /// sans ce suffixe en cas d'échec de lecture.</para>
    /// </summary>
    private async Task<MenuTransform?> ReadBoneTransformAsync(
        string g4pkmLogical, MenuLayoutSprite? sprite, bool hasOpenMotion, CancellationToken ct)
    {
        // Construire les candidats de chemins (chemin exact + variantes sans suffixe plateforme)
        var candidates = BuildG4pkmPathCandidates(g4pkmLogical);

        byte[]? bytes = null;
        foreach (var candidate in candidates)
        {
            try
            {
                bytes = (await _cdn.ReadAsync(candidate, ct).ConfigureAwait(false))?.Bytes;
                if (bytes is { Length: > 0 }) break;
            }
            catch { /* essayer le suivant */ }
        }
        if (bytes is null) return null;

        G4pkmLayout layout;
        try { layout = G4pkmParser.ParseG4pkm(bytes); }
        catch { return null; }
        if (layout.WorldPoseByName.Count == 0) return null;

        // Obtenir la pose finale via G4pkmMotion (gère le fallback ancêtre pour les hors-écran).
        // Si le bone de placement est un locator (ScaleX ≤ 1), rechercher le bone dont la
        // géométrie correspond aux dimensions du sprite (tolérance 30 %) ; cela est nécessaire
        // pour les objets IEVR dont le bone racine est une identité et dont la vraie taille est
        // encodée dans un bone feuille (ex. _header_gtxt_title02_01 sx=776 sy=120 pour un sprite 776×120).
        var motionPose = G4pkmMotion.GetMotionFinalPose(layout, hasOpenMotion);
        var pose = PickBestPoseForSprite(layout, motionPose.Pose, sprite);

        var (px, py) = pose.ToCss1280x720();
        // scaleX = (taille géométrie en px 1920) × ratio_canvas / taille_texture_native
        // Si pose.ScaleX provient d'un bone de taille réelle (> 1), le résultat est le ratio
        // canvas/texture (ex. 1280px bone→ sprite 1920px → scaleX = 0.667 = plein écran).
        // Si pose.ScaleX reste ≤ 1 (locator sans match), on affiche le sprite à sa taille native.
        double sx = sprite is { W: > 0 } && pose.ScaleX > 1.0 ? pose.ScaleX * (1280.0 / 1920.0) / sprite.W : 1.0;
        double sy = sprite is { H: > 0 } && pose.ScaleY > 1.0 ? pose.ScaleY * (720.0 / 1080.0) / sprite.H : 1.0;
        return new MenuTransform(px, py, sx, sy, pose.Rot, pose.AnchorX, pose.AnchorY);
    }

    /// <summary>
    /// Construit la liste des chemins CDN à essayer pour un G4PKM (exact + variantes sans suffixe).
    /// </summary>
    /// <summary>
    /// Sélectionne la meilleure pose pour un sprite donné.
    ///
    /// <para>Si la pose fournie par <see cref="G4pkmMotion.GetMotionFinalPose"/> est un
    /// locator (ScaleX ≤ 1.0), cherche dans le layout le bone dont les dimensions en
    /// espace-écran 1920×1080 correspondent le mieux au sprite (tolérance 30 %).
    /// En cas de correspondance, la position X/Y est préservée depuis la pose originale
    /// (issue du bone de placement) ; seule la scale provient du bone feuille.</para>
    ///
    /// <para>Cela corrige le bug de dégénérescence : le code précédent associait un bone
    /// identité (ScaleX=1 = 1 pixel) à un sprite de plusieurs centaines de pixels, rendant
    /// scaleX_json = 0.001 → sprite invisible (0.67 px rendu).</para>
    /// </summary>
    private static Transform2D PickBestPoseForSprite(
        G4pkmLayout layout, Transform2D placementPose, MenuLayoutSprite? sprite)
    {
        // Si le bone de placement a déjà une géométrie réelle, on l'utilise directement.
        if (placementPose.ScaleX > 1.0f || sprite is not { W: > 0, H: > 0 })
            return placementPose;

        // Chercher le bone dont sx et sy sont les plus proches de sprite.W et sprite.H
        // dans un rapport de 30 % (tolérance pour les sprite légèrement recadrés).
        const float Tolerance = 0.30f;
        float targetSx = sprite.W;
        float targetSy = sprite.H;

        Transform2D? best = null;
        float bestScore = float.MaxValue;

        foreach (var bone in layout.Bones)
        {
            var wp = bone.WorldBindPose;
            if (wp.ScaleX <= 1.0f || wp.ScaleY <= 1.0f) continue;

            float ratioX = wp.ScaleX / targetSx;
            float ratioY = wp.ScaleY / targetSy;
            if (ratioX < (1.0f - Tolerance) || ratioX > (1.0f + Tolerance)) continue;
            if (ratioY < (1.0f - Tolerance) || ratioY > (1.0f + Tolerance)) continue;

            // Score = distance relative cumulée (plus c'est proche de 1, mieux c'est).
            float score = Math.Abs(1.0f - ratioX) + Math.Abs(1.0f - ratioY);
            if (score < bestScore)
            {
                bestScore = score;
                // Position X/Y depuis le bone feuille (il est positionné correctement).
                best = new Transform2D(wp.X, wp.Y, wp.ScaleX, wp.ScaleY, wp.Rot, wp.AnchorX, wp.AnchorY);
            }
        }

        return best ?? placementPose;
    }

    private static IReadOnlyList<string> BuildG4pkmPathCandidates(string g4pkmLogical)
    {
        const StringComparison OIC = StringComparison.OrdinalIgnoreCase;

        var rel = g4pkmLogical.TrimStart('#', '/');
        var primary = rel.StartsWith("data/", OIC) ? rel : "data/" + rel;

        var candidates = new List<string>(4) { primary };

        // Extraire le nom de fichier et son dossier parent pour tenter les variantes
        // Ex: "data/common/menu/50_title/title00/title00_09_xsx/title00_09_xsx.g4pkm"
        //  -> "data/common/menu/50_title/title00/title00_09/title00_09.g4pkm"
        var fileName = Path.GetFileNameWithoutExtension(primary); // "title00_09_xsx"
        var dir = Path.GetDirectoryName(primary)?.Replace('\\', '/') ?? "";
        var ext = Path.GetExtension(primary); // ".g4pkm"

        // Suffixes de plateformes à retirer
        var platformSuffixes = new[] { "_xsx", "_ps5", "_ps", "_nx", "_st" };
        foreach (var suffix in platformSuffixes)
        {
            if (!fileName.EndsWith(suffix, OIC)) continue;

            var baseName = fileName[..^suffix.Length]; // "title00_09"
            // Le dossier est souvent "title00_09_xsx" → essayer "title00_09"
            var parentDir = Path.GetDirectoryName(dir)?.Replace('\\', '/') ?? "";
            var altPath = $"{parentDir}/{baseName}/{baseName}{ext}";
            candidates.Add(altPath);
            break;
        }

        return candidates;
    }

    private string? ResolveName(uint hash) =>
        hash == 0 ? null : (HashResolver?.Invoke(hash) ?? $"0x{hash:X8}");

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>Sérialise un layout en JSON (camelCase, conforme au contrat).</summary>
    public static string ToJson(MenuLayout layout) =>
        JsonSerializer.Serialize(layout, new JsonSerializerOptions(JsonOpts)
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        });
}
