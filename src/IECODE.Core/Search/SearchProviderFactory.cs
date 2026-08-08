// IECODE - Search Provider Factory
// Factory AOT-compatible pour instanciation des providers

namespace IECODE.Core.Search;

/// <summary>
/// Factory pour créer les providers de recherche appropriés.
/// AOT-compatible - pas de reflection.
/// </summary>
public static class SearchProviderFactory
{
    /// <summary>
    /// Crée le meilleur provider de recherche de fichiers disponible.
    /// </summary>
    /// <returns>Everything si disponible, sinon DirectorySearchProvider</returns>
    public static IFileSearchProvider CreateFileSearchProvider()
    {
        var everything = new EverythingSearchProvider();
        if (everything.IsAvailable)
            return everything;

        everything.Dispose();
        return new DirectorySearchProvider();
    }

    /// <summary>
    /// Vérifie si Everything est installé et accessible
    /// </summary>
    public static bool IsEverythingAvailable()
    {
        using var provider = new EverythingSearchProvider();
        return provider.IsAvailable;
    }
}

/// <summary>
/// Provider de recherche fallback utilisant DirectoryInfo.
/// Plus lent mais universel, ne nécessite aucune dépendance externe.
/// </summary>
public sealed class DirectorySearchProvider : IFileSearchProvider
{
    public string Name => "DirectoryInfo";

    public bool IsAvailable => true;

    public async IAsyncEnumerable<FileSearchResult> SearchAsync(
        string query,
        FileSearchOptions options = default,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var basePath = options.BasePath ?? Environment.CurrentDirectory;

        if (!Directory.Exists(basePath))
            yield break;

        var searchOption = options.Recursive
            ? SearchOption.AllDirectories
            : SearchOption.TopDirectoryOnly;

        // Convertir le query en pattern de recherche
        var pattern = string.IsNullOrWhiteSpace(query) ? "*" : query;

        IEnumerable<string> entries;
        try
        {
            entries = Directory.EnumerateFileSystemEntries(basePath, pattern, new EnumerationOptions
            {
                RecurseSubdirectories = options.Recursive,
                IgnoreInaccessible = true,
                MatchCasing = MatchCasing.CaseInsensitive
            });
        }
        catch (Exception)
        {
            yield break;
        }

        var count = 0;
        foreach (var path in entries)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (options.MaxResults > 0 && count >= options.MaxResults)
                yield break;

            FileSearchResult? result = null;
            try
            {
                var isDirectory = Directory.Exists(path);

                if (isDirectory && !options.IncludeDirectories)
                    continue;

                // Filtrer par extension si spécifié
                if (!isDirectory && options.Extensions is { Length: > 0 })
                {
                    var ext = Path.GetExtension(path);
                    if (!options.Extensions.Any(e =>
                        e.Equals(ext, StringComparison.OrdinalIgnoreCase) ||
                        $".{e}".Equals(ext, StringComparison.OrdinalIgnoreCase)))
                    {
                        continue;
                    }
                }

                var fileInfo = new FileInfo(path);
                result = new FileSearchResult
                {
                    FullPath = path,
                    FileName = Path.GetFileName(path),
                    Size = isDirectory ? 0 : fileInfo.Length,
                    DateModified = fileInfo.LastWriteTime,
                    IsDirectory = isDirectory
                };
            }
            catch
            {
                continue;
            }

            if (result.HasValue)
            {
                count++;
                yield return result.Value;
            }

            // Yield pour permettre l'async
            if (count % 100 == 0)
                await Task.Yield();
        }
    }

    public List<FileSearchResult> Search(string query, FileSearchOptions options = default)
    {
        var results = new List<FileSearchResult>();
        var basePath = options.BasePath ?? Environment.CurrentDirectory;

        if (!Directory.Exists(basePath))
            return results;

        var pattern = string.IsNullOrWhiteSpace(query) ? "*" : query;

        try
        {
            var entries = Directory.EnumerateFileSystemEntries(basePath, pattern, new EnumerationOptions
            {
                RecurseSubdirectories = options.Recursive,
                IgnoreInaccessible = true,
                MatchCasing = MatchCasing.CaseInsensitive
            });

            foreach (var path in entries)
            {
                if (options.MaxResults > 0 && results.Count >= options.MaxResults)
                    break;

                try
                {
                    var isDirectory = Directory.Exists(path);

                    if (isDirectory && !options.IncludeDirectories)
                        continue;

                    if (!isDirectory && options.Extensions is { Length: > 0 })
                    {
                        var ext = Path.GetExtension(path);
                        if (!options.Extensions.Any(e =>
                            e.Equals(ext, StringComparison.OrdinalIgnoreCase) ||
                            $".{e}".Equals(ext, StringComparison.OrdinalIgnoreCase)))
                        {
                            continue;
                        }
                    }

                    var fileInfo = new FileInfo(path);
                    results.Add(new FileSearchResult
                    {
                        FullPath = path,
                        FileName = Path.GetFileName(path),
                        Size = isDirectory ? 0 : fileInfo.Length,
                        DateModified = fileInfo.LastWriteTime,
                        IsDirectory = isDirectory
                    });
                }
                catch
                {
                    // Ignorer les fichiers inaccessibles
                }
            }
        }
        catch
        {
            // Ignorer les erreurs d'énumération
        }

        // Appliquer le tri
        results = options.SortBy switch
        {
            FileSearchSort.Name => options.Ascending
                ? results.OrderBy(r => r.FileName).ToList()
                : results.OrderByDescending(r => r.FileName).ToList(),
            FileSearchSort.Size => options.Ascending
                ? results.OrderBy(r => r.Size).ToList()
                : results.OrderByDescending(r => r.Size).ToList(),
            FileSearchSort.DateModified => options.Ascending
                ? results.OrderBy(r => r.DateModified).ToList()
                : results.OrderByDescending(r => r.DateModified).ToList(),
            _ => options.Ascending
                ? results.OrderBy(r => r.FullPath).ToList()
                : results.OrderByDescending(r => r.FullPath).ToList()
        };

        return results;
    }

    public int Count(string query, FileSearchOptions options = default)
    {
        var basePath = options.BasePath ?? Environment.CurrentDirectory;

        if (!Directory.Exists(basePath))
            return 0;

        var pattern = string.IsNullOrWhiteSpace(query) ? "*" : query;

        try
        {
            return Directory.EnumerateFileSystemEntries(basePath, pattern, new EnumerationOptions
            {
                RecurseSubdirectories = options.Recursive,
                IgnoreInaccessible = true,
                MatchCasing = MatchCasing.CaseInsensitive
            }).Count();
        }
        catch
        {
            return 0;
        }
    }

    public void Dispose()
    {
        // Pas de ressources à libérer
    }
}
