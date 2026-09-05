// IECODE - Everything Search Provider
// P/Invoke AOT-compatible pour Everything API
// Usage: CLI + UI pour recherche instantanée de game assets

using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace IECODE.Core.Search;

/// <summary>
/// Provider de recherche utilisant Everything API.
/// Permet une recherche ultra-rapide (~50ms sur millions de fichiers).
/// </summary>
/// <remarks>
/// Prérequis: Everything doit être installé et en cours d'exécution.
/// Download: https://www.voidtools.com/
/// </remarks>
public sealed partial class EverythingSearchProvider : IFileSearchProvider
{
    #region P/Invoke - AOT Compatible avec LibraryImport

    private const string EverythingDll = "Everything64.dll";

    // ===== Requête =====

    [LibraryImport(EverythingDll, EntryPoint = "Everything_SetSearchW", StringMarshalling = StringMarshalling.Utf16)]
    private static partial void Everything_SetSearch(string query);

    [LibraryImport(EverythingDll, EntryPoint = "Everything_SetMatchPath")]
    private static partial void Everything_SetMatchPath([MarshalAs(UnmanagedType.Bool)] bool enable);

    [LibraryImport(EverythingDll, EntryPoint = "Everything_SetMatchCase")]
    private static partial void Everything_SetMatchCase([MarshalAs(UnmanagedType.Bool)] bool enable);

    [LibraryImport(EverythingDll, EntryPoint = "Everything_SetMatchWholeWord")]
    private static partial void Everything_SetMatchWholeWord([MarshalAs(UnmanagedType.Bool)] bool enable);

    [LibraryImport(EverythingDll, EntryPoint = "Everything_SetRegex")]
    private static partial void Everything_SetRegex([MarshalAs(UnmanagedType.Bool)] bool enable);

    [LibraryImport(EverythingDll, EntryPoint = "Everything_SetMax")]
    private static partial void Everything_SetMax(uint maxResults);

    [LibraryImport(EverythingDll, EntryPoint = "Everything_SetOffset")]
    private static partial void Everything_SetOffset(uint offset);

    [LibraryImport(EverythingDll, EntryPoint = "Everything_SetSort")]
    private static partial void Everything_SetSort(uint sortType);

    [LibraryImport(EverythingDll, EntryPoint = "Everything_SetRequestFlags")]
    private static partial void Everything_SetRequestFlags(uint flags);

    // ===== Exécution =====

    [LibraryImport(EverythingDll, EntryPoint = "Everything_QueryW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool Everything_Query([MarshalAs(UnmanagedType.Bool)] bool wait);

    // ===== Résultats =====

    [LibraryImport(EverythingDll, EntryPoint = "Everything_GetNumResults")]
    private static partial uint Everything_GetNumResults();

    [LibraryImport(EverythingDll, EntryPoint = "Everything_GetTotResults")]
    private static partial uint Everything_GetTotResults();

    [LibraryImport(EverythingDll, EntryPoint = "Everything_GetResultFullPathNameW", StringMarshalling = StringMarshalling.Utf16)]
    private static partial void Everything_GetResultFullPathName(uint index, nint buffer, uint bufferSize);

    [LibraryImport(EverythingDll, EntryPoint = "Everything_GetResultFileNameW")]
    private static partial nint Everything_GetResultFileName(uint index);

    [LibraryImport(EverythingDll, EntryPoint = "Everything_GetResultSize")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool Everything_GetResultSize(uint index, out long size);

    [LibraryImport(EverythingDll, EntryPoint = "Everything_GetResultDateModified")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool Everything_GetResultDateModified(uint index, out long fileTime);

    [LibraryImport(EverythingDll, EntryPoint = "Everything_IsResultFolder")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool Everything_IsResultFolder(uint index);

    // ===== État =====

    [LibraryImport(EverythingDll, EntryPoint = "Everything_GetLastError")]
    private static partial uint Everything_GetLastError();

    [LibraryImport(EverythingDll, EntryPoint = "Everything_Reset")]
    private static partial void Everything_Reset();

    [LibraryImport(EverythingDll, EntryPoint = "Everything_CleanUp")]
    private static partial void Everything_CleanUp();

    [LibraryImport(EverythingDll, EntryPoint = "Everything_GetMajorVersion")]
    private static partial uint Everything_GetMajorVersion();

    [LibraryImport(EverythingDll, EntryPoint = "Everything_GetMinorVersion")]
    private static partial uint Everything_GetMinorVersion();

    #endregion

    #region Constants

    // Request flags
    private const uint EVERYTHING_REQUEST_FILE_NAME = 0x00000001;
    private const uint EVERYTHING_REQUEST_PATH = 0x00000002;
    private const uint EVERYTHING_REQUEST_FULL_PATH_AND_FILE_NAME = 0x00000004;
    private const uint EVERYTHING_REQUEST_SIZE = 0x00000010;
    private const uint EVERYTHING_REQUEST_DATE_MODIFIED = 0x00000040;

    // Sort types
    private const uint EVERYTHING_SORT_NAME_ASCENDING = 1;
    private const uint EVERYTHING_SORT_NAME_DESCENDING = 2;
    private const uint EVERYTHING_SORT_PATH_ASCENDING = 3;
    private const uint EVERYTHING_SORT_PATH_DESCENDING = 4;
    private const uint EVERYTHING_SORT_SIZE_ASCENDING = 5;
    private const uint EVERYTHING_SORT_SIZE_DESCENDING = 6;
    private const uint EVERYTHING_SORT_DATE_MODIFIED_ASCENDING = 13;
    private const uint EVERYTHING_SORT_DATE_MODIFIED_DESCENDING = 14;

    // Errors
    private const uint EVERYTHING_OK = 0;
    private const uint EVERYTHING_ERROR_MEMORY = 1;
    private const uint EVERYTHING_ERROR_IPC = 2;
    private const uint EVERYTHING_ERROR_REGISTERCLASSEX = 3;
    private const uint EVERYTHING_ERROR_CREATEWINDOW = 4;
    private const uint EVERYTHING_ERROR_CREATETHREAD = 5;
    private const uint EVERYTHING_ERROR_INVALIDINDEX = 6;
    private const uint EVERYTHING_ERROR_INVALIDCALL = 7;

    #endregion

    #region Fields

    private readonly object _lock = new();
    private bool _disposed;
    private readonly bool _isAvailable;

    #endregion

    #region Constructor

    public EverythingSearchProvider()
    {
        _isAvailable = CheckAvailability();
    }

    private static bool CheckAvailability()
    {
        try
        {
            // Tenter d'appeler la version pour vérifier si Everything est accessible
            var major = Everything_GetMajorVersion();
            return major > 0;
        }
        catch (DllNotFoundException)
        {
            return false;
        }
        catch (EntryPointNotFoundException)
        {
            return false;
        }
    }

    #endregion

    #region IFileSearchProvider

    public string Name => "Everything";

    public bool IsAvailable => _isAvailable;

    public async IAsyncEnumerable<FileSearchResult> SearchAsync(
        string query,
        FileSearchOptions options = default,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        if (!_isAvailable)
            throw new InvalidOperationException("Everything n'est pas disponible. Installez-le depuis https://www.voidtools.com/");

        // Exécution de la recherche sur un thread background pour ne pas bloquer
        var results = await Task.Run(() => SearchInternal(query, options), cancellationToken);

        foreach (var result in results)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return result;
        }
    }

    public List<FileSearchResult> Search(string query, FileSearchOptions options = default)
    {
        if (!_isAvailable)
            throw new InvalidOperationException("Everything n'est pas disponible. Installez-le depuis https://www.voidtools.com/");

        return SearchInternal(query, options);
    }

    public int Count(string query, FileSearchOptions options = default)
    {
        if (!_isAvailable)
            return 0;

        lock (_lock)
        {
            try
            {
                // Construire la requête
                var searchQuery = BuildQuery(query, options);
                Everything_SetSearch(searchQuery);
                Everything_SetMax(0); // Juste compter

                if (!Everything_Query(wait: true))
                    return 0;

                return (int)Everything_GetTotResults();
            }
            finally
            {
                Everything_Reset();
            }
        }
    }

    #endregion

    #region Internal Search

    private List<FileSearchResult> SearchInternal(string query, FileSearchOptions options)
    {
        var results = new List<FileSearchResult>();

        lock (_lock)
        {
            try
            {
                // Construire la requête avec le scope si spécifié
                var searchQuery = BuildQuery(query, options);

                // Configurer Everything
                Everything_SetSearch(searchQuery);
                Everything_SetRequestFlags(
                    EVERYTHING_REQUEST_FULL_PATH_AND_FILE_NAME |
                    EVERYTHING_REQUEST_SIZE |
                    EVERYTHING_REQUEST_DATE_MODIFIED);
                Everything_SetSort(GetSortType(options.SortBy, options.Ascending));

                if (options.MaxResults > 0)
                    Everything_SetMax((uint)options.MaxResults);

                // Exécuter la requête
                if (!Everything_Query(wait: true))
                {
                    var error = Everything_GetLastError();
                    throw new InvalidOperationException($"Everything query failed with error: {error}");
                }

                var count = Everything_GetNumResults();

                // Buffer pour le chemin (MAX_PATH = 260, on prend plus large)
                const int bufferSize = 520;
                nint buffer = Marshal.AllocHGlobal(bufferSize * sizeof(char));

                try
                {
                    for (uint i = 0; i < count; i++)
                    {
                        bool isFolder = Everything_IsResultFolder(i);

                        // Filtrer les dossiers si non demandés
                        if (isFolder && !options.IncludeDirectories)
                            continue;

                        // Récupérer le chemin complet
                        Everything_GetResultFullPathName(i, buffer, bufferSize);
                        string fullPath = Marshal.PtrToStringUni(buffer) ?? string.Empty;

                        // Récupérer les métadonnées
                        Everything_GetResultSize(i, out long size);
                        Everything_GetResultDateModified(i, out long fileTime);

                        var dateModified = fileTime > 0
                            ? DateTime.FromFileTime(fileTime)
                            : DateTime.MinValue;

                        results.Add(new FileSearchResult
                        {
                            FullPath = fullPath,
                            FileName = Path.GetFileName(fullPath),
                            Size = size,
                            DateModified = dateModified,
                            IsDirectory = isFolder
                        });
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            finally
            {
                Everything_Reset();
            }
        }

        return results;
    }

    private static string BuildQuery(string query, FileSearchOptions options)
    {
        var parts = new List<string>();

        // Scope de recherche (path:)
        if (!string.IsNullOrEmpty(options.BasePath))
        {
            parts.Add($"path:\"{options.BasePath}\"");
        }

        // Filtres d'extensions
        if (options.Extensions is { Length: > 0 })
        {
            var extFilters = string.Join("|", options.Extensions.Select(e =>
                e.StartsWith('.') ? $"*{e}" : $"*.{e}"));
            parts.Add($"({extFilters})");
        }

        // Query principale
        if (!string.IsNullOrWhiteSpace(query))
        {
            parts.Add(query);
        }

        return string.Join(" ", parts);
    }

    private static uint GetSortType(FileSearchSort sort, bool ascending)
    {
        return sort switch
        {
            FileSearchSort.Name => ascending ? EVERYTHING_SORT_NAME_ASCENDING : EVERYTHING_SORT_NAME_DESCENDING,
            FileSearchSort.Path => ascending ? EVERYTHING_SORT_PATH_ASCENDING : EVERYTHING_SORT_PATH_DESCENDING,
            FileSearchSort.Size => ascending ? EVERYTHING_SORT_SIZE_ASCENDING : EVERYTHING_SORT_SIZE_DESCENDING,
            FileSearchSort.DateModified => ascending ? EVERYTHING_SORT_DATE_MODIFIED_ASCENDING : EVERYTHING_SORT_DATE_MODIFIED_DESCENDING,
            _ => EVERYTHING_SORT_PATH_ASCENDING
        };
    }

    #endregion

    #region IDisposable

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        lock (_lock)
        {
            if (_isAvailable)
            {
                Everything_CleanUp();
            }
        }
    }

    #endregion
}

/// <summary>
/// Extensions pour faciliter les recherches IECODE
/// </summary>
public static class EverythingSearchExtensions
{
    /// <summary>
    /// Recherche tous les fichiers cfg.bin
    /// </summary>
    public static IAsyncEnumerable<FileSearchResult> SearchCfgBinAsync(
        this IFileSearchProvider provider,
        string? basePath = null,
        CancellationToken ct = default)
    {
        return provider.SearchAsync("*.cfg.bin", new FileSearchOptions
        {
            BasePath = basePath
        }, ct);
    }

    /// <summary>
    /// Recherche tous les fichiers CPK
    /// </summary>
    public static IAsyncEnumerable<FileSearchResult> SearchCpkAsync(
        this IFileSearchProvider provider,
        string? basePath = null,
        CancellationToken ct = default)
    {
        return provider.SearchAsync("*.cpk", new FileSearchOptions
        {
            BasePath = basePath
        }, ct);
    }

    /// <summary>
    /// Recherche les assets d'un personnage par ID
    /// </summary>
    public static IAsyncEnumerable<FileSearchResult> SearchCharacterAssetsAsync(
        this IFileSearchProvider provider,
        string characterId,
        string? basePath = null,
        CancellationToken ct = default)
    {
        return provider.SearchAsync(characterId, new FileSearchOptions
        {
            BasePath = basePath ?? Path.Combine(
                Environment.GetEnvironmentVariable("NIE_GAME_DIR") ?? Environment.CurrentDirectory,
                "data", "common", "chr")
        }, ct);
    }

    /// <summary>
    /// Recherche les textures G4TX
    /// </summary>
    public static IAsyncEnumerable<FileSearchResult> SearchTexturesAsync(
        this IFileSearchProvider provider,
        string? basePath = null,
        CancellationToken ct = default)
    {
        return provider.SearchAsync("*.g4tx", new FileSearchOptions
        {
            BasePath = basePath
        }, ct);
    }
}
