using System.Collections.Concurrent;
using IECODE.Core.Archives;
using IECODE.Core.Formats.Criware.CriFs;
using IECODE.Core.Formats.Criware.CriFs.Definitions;
using IECODE.Core.Formats.Criware.CriFs.Definitions.Structs;
using IECODE.Core.Formats.Criware.CriFs.Definitions.Utilities;

namespace IECODE.Core.Cdn;

/// <summary>
/// Un CPK ouvert et gardé chaud : reader déchiffrant + TOC parsé une seule fois en index
/// O(1) <c>chemin interne → CpkFile</c>. Le reader CriFs partage un stream seekable unique
/// (déchiffrement positionnel) → NON thread-safe : un <see cref="SemaphoreSlim"/>(1) sérialise
/// les extractions du même CPK (des CPK différents s'extraient en parallèle).
/// Équivalent du <c>cpk_cache_</c> + mutex du portage C++.
/// </summary>
internal sealed class PooledCpkReader : IDisposable
{
    private readonly ICpkReader _reader;
    private readonly Dictionary<string, CpkFile> _byPath;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private bool _disposed;

    /// <summary>Chemin disque du CPK (clé de pool).</summary>
    public string CpkPath { get; }

    /// <summary>Nombre de fichiers indexés dans ce CPK.</summary>
    public int Count => _byPath.Count;

    private PooledCpkReader(string cpkPath, ICpkReader reader, Dictionary<string, CpkFile> byPath)
    {
        CpkPath = cpkPath;
        _reader = reader;
        _byPath = byPath;
    }

    /// <summary>
    /// Ouvre un CPK (déchiffré à la volée), parse son TOC et construit l'index interne.
    /// </summary>
    public static PooledCpkReader Open(string cpkPath)
    {
        var stream = CpkService.OpenCpkStream(cpkPath, decrypt: true);
        var reader = CriFsLib.Instance.CreateCpkReader(stream, ownsStream: true);

        var files = reader.GetFiles();
        var byPath = new Dictionary<string, CpkFile>(files.Length, StringComparer.Ordinal);
        foreach (var f in files)
        {
            var full = string.IsNullOrEmpty(f.Directory) ? f.FileName : $"{f.Directory}/{f.FileName}";
            byPath[CpkFileIndex.Normalize(full)] = f;
        }

        return new PooledCpkReader(cpkPath, reader, byPath);
    }

    /// <summary>Résout un chemin interne (normalisé) vers son entrée CpkFile.</summary>
    public bool TryGet(string normalizedPath, out CpkFile file) => _byPath.TryGetValue(normalizedPath, out file);

    /// <summary>
    /// Extrait UN fichier en mémoire (déchiffré + décompressé CRILAYLA si besoin). L'accès au
    /// reader est sérialisé (stream partagé). Renvoie une copie possédée par l'appelant : le
    /// buffer poolé interne est rendu immédiatement, donc rien à libérer côté CDN.
    /// </summary>
    public async Task<byte[]> ExtractAsync(CpkFile file, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            using ArrayRental rental = _reader.ExtractFile(file);
            return rental.RawArray.AsSpan(0, rental.Count).ToArray();
        }
        finally
        {
            _gate.Release();
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        // Attendre la fin d'une extraction en cours avant de fermer le stream sous-jacent.
        _gate.Wait();
        try { _reader.Dispose(); }
        finally { _gate.Release(); _gate.Dispose(); }
    }
}

/// <summary>
/// Cache LRU borné de <see cref="PooledCpkReader"/>. Le jeu compte ~900 CPK ; en garder
/// quelques dizaines ouverts évite de re-parser le TOC à chaque requête CDN. Éviction par
/// récence d'accès quand la capacité est dépassée. Thread-safe.
/// </summary>
public sealed class CpkReaderPool : IDisposable
{
    private readonly ConcurrentDictionary<string, Lazy<PooledCpkReader>> _open = new(StringComparer.Ordinal);
    private readonly LinkedList<string> _lru = new();          // tête = plus récent
    private readonly Dictionary<string, LinkedListNode<string>> _nodes = new(StringComparer.Ordinal);
    private readonly object _lruLock = new();
    private readonly int _capacity;
    private bool _disposed;

    /// <summary>Nombre de CPK actuellement ouverts.</summary>
    public int OpenCount => _open.Count;

    /// <summary>Capacité effective (nb max de CPK gardés ouverts).</summary>
    public int Capacity => _capacity;

    /// <param name="capacity">
    /// Nb max de readers chauds. Défaut 48 (override <c>IECODE_CDN_POOL</c>). Borné [1, 512].
    /// </param>
    public CpkReaderPool(int capacity = 0)
    {
        if (capacity <= 0)
        {
            var env = Environment.GetEnvironmentVariable("IECODE_CDN_POOL");
            capacity = int.TryParse(env, out var c) && c > 0 ? c : 48;
        }
        _capacity = Math.Clamp(capacity, 1, 512);
    }

    /// <summary>
    /// Récupère (ou ouvre) le reader chaud d'un CPK. L'ouverture concurrente du même CPK est
    /// dédupliquée via <see cref="Lazy{T}"/>. Met à jour la récence et évince le plus ancien
    /// au-delà de la capacité.
    /// </summary>
    internal PooledCpkReader Rent(string cpkPath)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        var lazy = _open.GetOrAdd(cpkPath,
            p => new Lazy<PooledCpkReader>(() => PooledCpkReader.Open(p), LazyThreadSafetyMode.ExecutionAndPublication));

        PooledCpkReader reader;
        try
        {
            reader = lazy.Value;
        }
        catch
        {
            // Ouverture échouée : ne pas laisser un Lazy fautif en cache.
            _open.TryRemove(new KeyValuePair<string, Lazy<PooledCpkReader>>(cpkPath, lazy));
            throw;
        }

        Touch(cpkPath);
        EvictIfNeeded();
        return reader;
    }

    private void Touch(string cpkPath)
    {
        lock (_lruLock)
        {
            if (_nodes.TryGetValue(cpkPath, out var node))
            {
                _lru.Remove(node);
                _lru.AddFirst(node);
            }
            else
            {
                _nodes[cpkPath] = _lru.AddFirst(cpkPath);
            }
        }
    }

    private void EvictIfNeeded()
    {
        while (true)
        {
            string? victim = null;
            lock (_lruLock)
            {
                if (_nodes.Count <= _capacity) return;
                var last = _lru.Last;
                if (last is null) return;
                victim = last.Value;
                _lru.RemoveLast();
                _nodes.Remove(victim);
            }
            if (victim is not null && _open.TryRemove(victim, out var lazy) && lazy.IsValueCreated)
                lazy.Value.Dispose();
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var lazy in _open.Values)
            if (lazy.IsValueCreated) lazy.Value.Dispose();
        _open.Clear();
        lock (_lruLock) { _lru.Clear(); _nodes.Clear(); }
    }
}
