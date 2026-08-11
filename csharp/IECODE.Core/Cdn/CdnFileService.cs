using IECODE.Core.Config;

namespace IECODE.Core.Cdn;

/// <summary>
/// Un fichier jeu servi par le CDN : ses octets (déchiffrés + décompressés), sa taille,
/// son ETag immuable et un media-type informatif. Les octets sont possédés par l'appelant.
/// </summary>
public readonly record struct CdnFile(string Path, byte[] Bytes, long Size, string ETag, string MediaType);

/// <summary>
/// Cœur du CDN « sans dump » : sert N'IMPORTE QUEL fichier du jeu à la demande en le résolvant
/// via <see cref="CpkFileIndex"/> (cpk_list → CPK) puis en l'extrayant d'un reader chaud
/// (<see cref="CpkReaderPool"/>). Cache L1 mémoire optionnel des petits fichiers chauds.
///
/// Pipeline d'une requête : <c>chemin logique → TryResolve → Rent(CPK) → ExtractAsync → CdnFile</c>.
/// Aucune écriture disque, aucun dump préalable.
/// </summary>
public sealed class CdnFileService : IDisposable
{
    private readonly CpkFileIndex _index;
    private readonly CpkReaderPool _pool;
    private readonly bool _ownsPool;
    private readonly MemoryCache _l1;

    /// <summary>BuildId Steam de référence (ETag immuable).</summary>
    public string BuildId => _index.BuildId;

    /// <summary>Nombre de fichiers servables.</summary>
    public int Count => _index.Count;

    /// <summary>Toutes les localisations (pour /manifest, diagnostics).</summary>
    public IEnumerable<CpkFileLocation> All => _index.All;

    public CdnFileService(CpkFileIndex index, CpkReaderPool? pool = null)
    {
        _index = index;
        _ownsPool = pool is null;
        _pool = pool ?? new CpkReaderPool();
        _l1 = new MemoryCache();
    }

    /// <summary>
    /// Construit le service depuis un jeu installé : lit <c>cpk_list.cfg.bin</c> et indexe.
    /// </summary>
    public static CdnFileService FromGame(IEVRGame game, string buildId = "", CpkReaderPool? pool = null)
    {
        var cpkList = game.CfgBin.ReadCpkList();
        var index = CpkFileIndex.Build(cpkList, game.PacksPath, buildId);
        return new CdnFileService(index, pool);
    }

    /// <summary>Résout sans extraire (pour HEAD / 404 / ETag). Renvoie false si inconnu.</summary>
    public bool TryResolve(string path, out CpkFileLocation location) => _index.TryResolve(path, out location);

    /// <summary>ETag immuable d'une localisation résolue.</summary>
    public string ETag(in CpkFileLocation location) => _index.ETag(location);

    /// <summary>
    /// Sert un fichier par son chemin logique. Renvoie <c>null</c> si le fichier n'existe pas
    /// dans l'index. Lève <see cref="FileNotFoundException"/> si l'index le connaît mais que le
    /// CPK ne le contient pas (incohérence cpk_list/CPK).
    ///
    /// INVARIANT QUALITÉ — les octets renvoyés sont le contenu NATIF EXACT du jeu : déchiffrés
    /// puis, le cas échéant, décompressés CRILAYLA (sans perte). AUCUN ré-échantillonnage, AUCUN
    /// transcodage, AUCune compression lossy. Une texture G4TX ressort en pleine résolution avec
    /// toute sa chaîne de mipmaps, byte-for-byte identique à un dump. Toute conversion web
    /// (KTX2/PNG/AVIF…) est une couche SÉPARÉE, opt-in, et par défaut lossless/pleine résolution.
    /// </summary>
    public async Task<CdnFile?> ReadAsync(string path, CancellationToken ct = default)
    {
        if (!_index.TryResolve(path, out var loc))
            return null;

        var key = CpkFileIndex.Normalize(path);
        var etag = _index.ETag(loc);
        var mediaType = CdnMediaTypes.ForPath(key);

        if (_l1.TryGet(key, out var cached))
            return new CdnFile(key, cached, cached.LongLength, etag, mediaType);

        var reader = _pool.Rent(loc.CpkPath);
        if (!reader.TryGet(key, out var cpkFile))
            throw new FileNotFoundException($"Présent dans cpk_list mais absent du CPK '{loc.CpkName}' : {path}");

        var bytes = await reader.ExtractAsync(cpkFile, ct).ConfigureAwait(false);
        _l1.TryStore(key, bytes);
        return new CdnFile(key, bytes, bytes.LongLength, etag, mediaType);
    }

    private MenuPngService? _menuPng;

    /// <summary>Service de rendu PNG menu (azalee), créé à la demande. Immuable pour un build.</summary>
    public MenuPngService MenuPng => _menuPng ??= new MenuPngService(this);

    /// <summary>
    /// Sert une requête CDN avec conversion opt-in : <c>?format=png</c> sur un chemin du sous-arbre
    /// menu (<c>dx11/menu/**.png</c>) décode la (sous-)texture G4TX correspondante en PNG LOSSLESS
    /// (mip 0, pleine résolution) — c'est le contrat azalee. Tout autre cas retombe sur
    /// <see cref="ReadAsync"/> qui sert les octets NATIFS bruts (défaut). Renvoie null si introuvable.
    ///
    /// INVARIANT QUALITÉ : par défaut le CDN sert le binaire natif ; <c>format=png</c> est une
    /// conversion sans perte et sans downscale, jamais activée implicitement.
    /// </summary>
    public async Task<CdnFile?> ReadConvertedAsync(string path, string? format, CancellationToken ct = default)
    {
        if (string.Equals(format, "png", StringComparison.OrdinalIgnoreCase)
            && path.Replace('\\', '/').Contains("dx11/menu/", StringComparison.OrdinalIgnoreCase)
            && path.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
        {
            var rendered = await MenuPng.RenderAsync(path, ct).ConfigureAwait(false);
            if (rendered is not { } m)
                return null;
            return new CdnFile(m.AzaleePath, m.Bytes, m.Bytes.LongLength, m.ETag, "image/png");
        }

        return await ReadAsync(path, ct).ConfigureAwait(false);
    }

    public void Dispose()
    {
        if (_ownsPool) _pool.Dispose();
    }
}

/// <summary>
/// Cache L1 mémoire LRU borné par octets, des petits fichiers chauds. Un gros fichier (movie,
/// audio) n'est pas caché (évite qu'il évince tout le reste). Thread-safe. Tailles via env :
/// <c>IECODE_CDN_CACHE</c> (Mio total, défaut 256), <c>IECODE_CDN_CACHE_MAX_ITEM</c> (Kio/fichier, défaut 8192).
/// </summary>
internal sealed class MemoryCache
{
    private readonly long _budgetBytes;
    private readonly long _maxItemBytes;
    private readonly LinkedList<(string Key, byte[] Data)> _lru = new();
    private readonly Dictionary<string, LinkedListNode<(string Key, byte[] Data)>> _map = new(StringComparer.Ordinal);
    private readonly object _lock = new();
    private long _used;

    public MemoryCache()
    {
        _budgetBytes = ResolveMib("IECODE_CDN_CACHE", 256) * 1024 * 1024;
        _maxItemBytes = ResolveMib("IECODE_CDN_CACHE_MAX_ITEM", 8) * 1024 * 1024; // défaut 8 Mio
    }

    private static long ResolveMib(string env, long defMib)
    {
        var v = Environment.GetEnvironmentVariable(env);
        return long.TryParse(v, out var m) && m >= 0 ? m : defMib;
    }

    public bool TryGet(string key, out byte[] data)
    {
        lock (_lock)
        {
            if (_map.TryGetValue(key, out var node))
            {
                _lru.Remove(node);
                _lru.AddFirst(node);
                data = node.Value.Data;
                return true;
            }
        }
        data = [];
        return false;
    }

    public void TryStore(string key, byte[] data)
    {
        if (_budgetBytes <= 0 || data.LongLength > _maxItemBytes || data.LongLength > _budgetBytes)
            return;

        lock (_lock)
        {
            if (_map.ContainsKey(key)) return;
            while (_used + data.LongLength > _budgetBytes && _lru.Last is { } last)
            {
                _used -= last.Value.Data.LongLength;
                _map.Remove(last.Value.Key);
                _lru.RemoveLast();
            }
            var node = _lru.AddFirst((key, data));
            _map[key] = node;
            _used += data.LongLength;
        }
    }
}

/// <summary>
/// Mapping extension → media-type (clé d'unification du registry, cf. axe standardisation).
/// Vendor trees <c>application/vnd.level5.*</c> / <c>application/vnd.criware.*</c> pour les
/// formats propriétaires ; types IANA standard sinon. Informatif (le CDN sert les octets bruts).
/// </summary>
public static class CdnMediaTypes
{
    private static readonly Dictionary<string, string> ByExt = new(StringComparer.OrdinalIgnoreCase)
    {
        // Level-5
        [".g4tx"] = "application/vnd.level5.g4tx",
        [".g4mg"] = "application/vnd.level5.g4mg",
        [".g4md"] = "application/vnd.level5.g4md",
        [".g4pk"] = "application/vnd.level5.g4pk",
        [".g4pkm"] = "application/vnd.level5.g4pkm",
        [".cfg.bin"] = "application/vnd.level5.cfgbin",
        [".xpck"] = "application/vnd.level5.xpck",
        [".xfsa"] = "application/vnd.level5.xfsa",
        // CRIWARE
        [".cpk"] = "application/vnd.criware.cpk",
        [".usm"] = "application/vnd.criware.usm",
        [".acb"] = "application/vnd.criware.acb",
        [".awb"] = "application/vnd.criware.awb",
        [".adx"] = "application/vnd.criware.adx",
        [".hca"] = "application/vnd.criware.hca",
        // Standard
        [".png"] = "image/png",
        [".dds"] = "image/vnd.ms-dds",
        [".json"] = "application/json",
        [".txt"] = "text/plain; charset=utf-8",
        [".xml"] = "application/xml",
        [".bin"] = "application/octet-stream",
    };

    /// <summary>Media-type d'un chemin (gère le double-suffixe <c>.cfg.bin</c>). Octet-stream par défaut.</summary>
    public static string ForPath(string path)
    {
        if (path.EndsWith(".cfg.bin", StringComparison.OrdinalIgnoreCase))
            return ByExt[".cfg.bin"];
        var ext = System.IO.Path.GetExtension(path);
        return !string.IsNullOrEmpty(ext) && ByExt.TryGetValue(ext, out var mt) ? mt : "application/octet-stream";
    }
}
