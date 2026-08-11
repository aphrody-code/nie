namespace IECODE.Core.Cdn;

/// <summary>
/// DTO de résolution (CLASSE, pas struct) — pensé pour le pont node-api-dotnet, qui ne projette pas
/// proprement les <c>record struct</c> ni les <c>out struct</c>/<c>Nullable&lt;struct&gt;</c> vers JS.
/// </summary>
public sealed class MenuAssetDto
{
    public string ContainerPath { get; init; } = string.Empty;
    public string TextureName { get; init; } = string.Empty;
    public string AzaleePath { get; init; } = string.Empty;
}

/// <summary>
/// DTO d'icône décodée (CLASSE) pour le pont Bun. <see cref="Bytes"/> est un <c>byte[]</c> simple
/// (marshalé en typed array côté JS). Dimensions natives, ETag immuable.
/// </summary>
public sealed class MenuPngDto
{
    public string AzaleePath { get; init; } = string.Empty;
    public byte[] Bytes { get; init; } = [];
    public int Width { get; init; }
    public int Height { get; init; }
    public string ETag { get; init; } = string.Empty;
}

/// <summary>
/// Pont Bun-friendly du CDN menu azalee. Encapsule <see cref="CdnFileService"/> +
/// <see cref="MenuPngService"/> + <see cref="MenuBatchExporter"/> en n'exposant QUE des types
/// projetables par node-api-dotnet (classes, string, byte[], int, bool, List&lt;T&gt;).
///
/// C'est le point d'entrée recommandé depuis <c>@rose-griffon/iecode-cdn</c> : <c>MenuCdnBridge.Open(gamePath)</c>.
/// Toute la logique reste dans les services .NET (résolution lexicale, décodage G4TX→PNG lossless,
/// export batch) ; cette façade évite juste les <c>record struct</c>/<c>out</c> incompatibles JS.
/// </summary>
public sealed class MenuCdnBridge : IDisposable
{
    private readonly IEVRGame _game;
    private readonly CdnFileService _cdn;
    private readonly MenuPngService _png;
    private readonly bool _ownsGame;

    private MenuCdnBridge(IEVRGame game, CdnFileService cdn, bool ownsGame)
    {
        _game = game;
        _cdn = cdn;
        _png = cdn.MenuPng;
        _ownsGame = ownsGame;
    }

    /// <summary>Ouvre le pont pour un jeu installé (chemin défaut = install Steam détecté).</summary>
    public static MenuCdnBridge Open(string? gamePath = null)
    {
        var game = new IEVRGame(gamePath);
        if (!game.IsValid)
        {
            var path = game.GamePath;
            game.Dispose();
            throw new DirectoryNotFoundException($"Jeu IEVR introuvable : {path}");
        }
        var cdn = CdnFileService.FromGame(game);
        return new MenuCdnBridge(game, cdn, ownsGame: true);
    }

    /// <summary>BuildId Steam (ETag racine).</summary>
    public string BuildId => _cdn.BuildId;

    /// <summary>Nombre total de conteneurs G4TX du sous-arbre menu.</summary>
    public int MenuContainerCount => MenuAssetResolver.EnumerateMenuContainers(_cdn).Count();

    /// <summary>
    /// Résout un chemin azalee → conteneur + texture. Renvoie <c>null</c> (projeté en JS null) si
    /// le conteneur est inconnu. N'ouvre aucun CPK.
    /// </summary>
    public MenuAssetDto? Resolve(string azaleePath)
    {
        if (!_png.TryResolve(azaleePath, out var a))
            return null;
        return new MenuAssetDto { ContainerPath = a.ContainerPath, TextureName = a.TextureName, AzaleePath = a.AzaleePath };
    }

    /// <summary>Décode une icône azalee en PNG lossless. <c>null</c> si introuvable.</summary>
    public async Task<MenuPngDto?> RenderAsync(string azaleePath, CancellationToken ct = default)
    {
        var m = await _png.RenderAsync(azaleePath, ct).ConfigureAwait(false);
        return m is { } v ? ToDto(v) : null;
    }

    /// <summary>Décode toutes les (sous-)textures d'un conteneur (atlas → N PNG).</summary>
    public async Task<List<MenuPngDto>> RenderAllAsync(string containerLogicalPath, CancellationToken ct = default)
    {
        var list = await _png.RenderAllAsync(containerLogicalPath, ct).ConfigureAwait(false);
        var result = new List<MenuPngDto>(list.Count);
        foreach (var m in list) result.Add(ToDto(m));
        return result;
    }

    /// <summary>Liste les conteneurs G4TX menu (chemins logiques CPK), filtrables par sous-chaîne.</summary>
    public List<string> ListContainers(string? filter = null)
    {
        var result = new List<string>();
        foreach (var loc in MenuAssetResolver.EnumerateMenuContainers(_cdn))
            if (filter is null || loc.Path.Contains(filter, StringComparison.OrdinalIgnoreCase))
                result.Add(loc.Path);
        return result;
    }

    /// <summary>
    /// Export batch de l'arbre <c>dx11/menu/**.png</c> vers <paramref name="outputRoot"/>.
    /// Renvoie un compte-rendu sous forme de chaînes/ints (projetable JS).
    /// </summary>
    public async Task<MenuExportReportDto> ExportAsync(
        string outputRoot, string? filter = null, bool overwrite = false, int concurrency = 0, CancellationToken ct = default)
    {
        var exporter = new MenuBatchExporter(_cdn);
        var r = await exporter.ExportAsync(
            outputRoot, filter, overwrite, concurrency > 0 ? concurrency : null, progress: null, ct: ct).ConfigureAwait(false);
        return new MenuExportReportDto
        {
            Containers = r.Containers,
            PngWritten = r.PngWritten,
            Failed = r.Failed,
            BytesWritten = r.BytesWritten,
            OutputRoot = r.OutputRoot,
        };
    }

    /// <summary>
    /// Sert n'importe quel fichier du jeu par son chemin logique CPK (ex. <c>data/dx11/menu/face/c01000010_l.g4tx</c>).
    /// Renvoie <c>null</c> si le chemin est inconnu de l'index (→ 404). Octets natifs bruts : déchiffrés
    /// et décompressés CRILAYLA, aucune conversion lossy. Pour les PNG menu, préférer <see cref="RenderAsync"/>.
    /// </summary>
    public async Task<CdnFileDto?> ReadRawAsync(string path, CancellationToken ct = default)
    {
        var file = await _cdn.ReadAsync(path, ct).ConfigureAwait(false);
        if (file is not { } f) return null;
        return new CdnFileDto { Path = f.Path, Bytes = f.Bytes, ETag = f.ETag, MediaType = f.MediaType };
    }

    private static MenuPngDto ToDto(in MenuPng m) =>
        new() { AzaleePath = m.AzaleePath, Bytes = m.Bytes, Width = m.Width, Height = m.Height, ETag = m.ETag };

    public void Dispose()
    {
        _cdn.Dispose();
        if (_ownsGame) _game.Dispose();
    }
}

/// <summary>
/// DTO de fichier brut (CLASSE) pour le pont Bun. Contient les octets natifs déchiffrés/décompressés,
/// le media-type informatif et l'ETag immuable. Distinct de <c>CdnFile</c> (record struct non projetable
/// par node-api-dotnet).
/// </summary>
public sealed class CdnFileDto
{
    public string Path { get; init; } = string.Empty;
    public byte[] Bytes { get; init; } = [];
    public string ETag { get; init; } = string.Empty;
    public string MediaType { get; init; } = string.Empty;
}

/// <summary>Compte-rendu d'export (CLASSE) pour le pont Bun.</summary>
public sealed class MenuExportReportDto
{
    public int Containers { get; init; }
    public int PngWritten { get; init; }
    public int Failed { get; init; }
    public long BytesWritten { get; init; }
    public string OutputRoot { get; init; } = string.Empty;
}
