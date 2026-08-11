using IECODE.Core.Converters;
using IECODE.Core.Formats.Level5;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Processing;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.PixelFormats;

namespace IECODE.Core.Cdn;

/// <summary>
/// Une icône menu décodée : ses octets PNG lossless, ses dimensions, l'ETag immuable du conteneur
/// source et le chemin azalee logique. Le PNG est mip-0, pleine résolution, RGBA8 sans perte
/// vis-à-vis des pixels stockés (décodage BCn/DDS → RGBA, ré-encodé PNG sans recompression lossy).
/// </summary>
public readonly record struct MenuPng(string AzaleePath, byte[] Bytes, int Width, int Height, string ETag);

/// <summary>
/// Produit / sert les PNG du sous-arbre <c>cdn.rosegriffon.fr/dx11/menu/**</c> attendus par azalee,
/// à partir des conteneurs G4TX du jeu, SANS toucher la prod et SANS dump préalable.
///
/// Pipeline d'une icône : <c>chemin azalee → MenuAssetResolver → CdnFileService.ReadAsync(conteneur)
/// → G4txParser → texture nommée → ToImage() → PNG lossless</c>.
///
/// INVARIANT QUALITÉ : décodage mip-0 pleine résolution, AUCUN downscale, AUCune recompression
/// lossy. Le décodage G4TX/BCn → RGBA puis l'encodage PNG sont sans perte par rapport aux pixels
/// stockés (cf. <see cref="TextureExportExtensions.ToImage"/>). Les icônes ressortent à leur taille
/// native (faces/auras/uniformes ≈ 256×256, emblèmes 512×512, telop 1728×352).
///
/// Le serve par défaut du CDN reste le binaire natif (<see cref="CdnFileService"/>) ; ce PNG est
/// une couche opt-in (<c>?format=png</c> ou export batch).
/// </summary>
public sealed class MenuPngService
{
    private readonly CdnFileService _cdn;

    /// <summary>Encodeur PNG lossless partagé (RGBA, compression max). Réutilisable et thread-safe.</summary>
    private static readonly PngEncoder Encoder = new()
    {
        CompressionLevel = PngCompressionLevel.BestCompression,
        ColorType = PngColorType.RgbWithAlpha,
    };

    public MenuPngService(CdnFileService cdn) => _cdn = cdn;

    /// <summary>BuildId Steam (ETag racine).</summary>
    public string BuildId => _cdn.BuildId;

    /// <summary>
    /// Résout un chemin azalee vers son conteneur + texture (sans ouvrir de CPK). Renvoie false
    /// si le conteneur n'existe pas dans cpk_list.
    /// </summary>
    public bool TryResolve(string azaleePath, out MenuAssetRef asset) =>
        MenuAssetResolver.TryResolve(azaleePath, p => _cdn.TryResolve(p, out _), out asset);

    /// <summary>
    /// Décode l'icône PNG correspondant à un chemin azalee. Renvoie <c>null</c> si le conteneur est
    /// inconnu (404). Lève <see cref="KeyNotFoundException"/> si le conteneur existe mais ne contient
    /// pas la texture nommée (incohérence azalee/jeu — utile pour diagnostiquer un template faux).
    /// </summary>
    public async Task<MenuPng?> RenderAsync(string azaleePath, CancellationToken ct = default)
    {
        if (!TryResolve(azaleePath, out var asset))
            return null;

        var container = await _cdn.ReadAsync(asset.ContainerPath, ct).ConfigureAwait(false);
        if (container is not { } c)
            return null;

        var (bytes, w, h) = DecodeNamedTexture(c.Bytes, asset.TextureName, asset.ContainerPath);
        return new MenuPng(asset.AzaleePath, bytes, w, h, c.ETag);
    }

    /// <summary>
    /// Décode directement le PNG d'une (sous-)texture nommée d'un conteneur logique donné — utile
    /// pour l'export batch (on connaît déjà conteneur + nom, pas besoin de re-résoudre).
    /// </summary>
    public async Task<MenuPng?> RenderContainerTextureAsync(
        string containerLogicalPath, string textureName, CancellationToken ct = default)
    {
        var container = await _cdn.ReadAsync(containerLogicalPath, ct).ConfigureAwait(false);
        if (container is not { } c)
            return null;

        var azaleePath = MenuAssetResolver.ToAzaleePath(containerLogicalPath, textureName);
        var (bytes, w, h) = DecodeNamedTexture(c.Bytes, textureName, containerLogicalPath);
        return new MenuPng(azaleePath, bytes, w, h, c.ETag);
    }

    /// <summary>
    /// Décode TOUTES les (sous-)textures d'un conteneur G4TX en PNG azalee. Un conteneur d'atlas
    /// (ex. <c>icon_item04.g4tx</c>, 80 textures) produit 80 PNG. C'est l'unité de travail de
    /// l'export batch (on n'ouvre/parse le CPK qu'une fois par conteneur).
    /// </summary>
    public async Task<IReadOnlyList<MenuPng>> RenderAllAsync(
        string containerLogicalPath, CancellationToken ct = default)
    {
        var container = await _cdn.ReadAsync(containerLogicalPath, ct).ConfigureAwait(false);
        if (container is not { } c)
            return [];

        var textures = G4txParser.ParseTextures(c.Bytes);
        var result = new List<MenuPng>(textures.Count);
        foreach (var tex in textures)
        {
            ct.ThrowIfCancellationRequested();
            // Texture principale.
            var azaleePath = MenuAssetResolver.ToAzaleePath(containerLogicalPath, tex.Name);
            var (bytes, w, h) = EncodeTexture(tex);
            result.Add(new MenuPng(azaleePath, bytes, w, h, c.ETag));

            // Sous-textures (régions d'atlas explicites) : chacune devient aussi un PNG nommé.
            foreach (var sub in tex.SubTextures)
            {
                if (string.IsNullOrEmpty(sub.Name) || sub.Name == tex.Name) continue;
                var subPath = MenuAssetResolver.ToAzaleePath(containerLogicalPath, sub.Name);
                var (sb, sw, sh) = EncodeSubTexture(tex, sub);
                result.Add(new MenuPng(subPath, sb, sw, sh, c.ETag));
            }
        }
        return result;
    }

    // ── Décodage ─────────────────────────────────────────────────────────────

    private static (byte[] Bytes, int Width, int Height) DecodeNamedTexture(
        byte[] g4txBytes, string textureName, string containerPath)
    {
        var textures = G4txParser.ParseTextures(g4txBytes);

        // 1) Texture principale par nom exact.
        foreach (var tex in textures)
            if (tex.Name == textureName)
                return EncodeTexture(tex);

        // 2) Sous-texture (région d'atlas) par nom exact.
        foreach (var tex in textures)
            foreach (var sub in tex.SubTextures)
                if (sub.Name == textureName)
                    return EncodeSubTexture(tex, sub);

        // 3) Conteneur mono-texture : un seul candidat → on l'accepte (tolérance suffixe).
        if (textures.Count == 1)
            return EncodeTexture(textures[0]);

        var names = string.Join(", ", textures.Select(t => t.Name));
        throw new KeyNotFoundException(
            $"Texture '{textureName}' absente du conteneur '{containerPath}'. Disponibles : {names}");
    }

    /// <summary>Encode une texture principale entière en PNG lossless (mip 0, pleine résolution).</summary>
    private static (byte[] Bytes, int Width, int Height) EncodeTexture(in G4txTexture tex)
    {
        using var image = tex.ToImage();
        return (EncodePng(image), image.Width, image.Height);
    }

    /// <summary>
    /// Encode une région d'atlas (sous-texture) en découpant la texture parente aux coordonnées
    /// (X, Y, W, H) déclarées. Le crop est un copier de pixels exacts → toujours lossless.
    /// </summary>
    private static (byte[] Bytes, int Width, int Height) EncodeSubTexture(
        in G4txTexture tex, in G4txSubTexture sub)
    {
        using var parent = tex.ToImage();
        int x = Math.Clamp(sub.X, 0, parent.Width);
        int y = Math.Clamp(sub.Y, 0, parent.Height);
        int w = Math.Clamp(sub.Width, 0, parent.Width - x);
        int h = Math.Clamp(sub.Height, 0, parent.Height - y);
        if (w <= 0 || h <= 0)
            return (EncodePng(parent), parent.Width, parent.Height);

        using var crop = parent.Clone(ctx => ctx.Crop(new Rectangle(x, y, w, h)));
        return (EncodePng(crop), crop.Width, crop.Height);
    }

    private static byte[] EncodePng(Image<Rgba32> image)
    {
        using var ms = new MemoryStream();
        image.Save(ms, Encoder);
        return ms.ToArray();
    }
}
