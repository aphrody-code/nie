// IECODE - File Search Provider Interface
// Everything API pour CLI/UI - Recherche instantanée de game assets

namespace IECODE.Core.Search;

/// <summary>
/// Résultat d'une recherche de fichier
/// </summary>
public readonly record struct FileSearchResult
{
    /// <summary>Chemin complet du fichier</summary>
    public required string FullPath { get; init; }

    /// <summary>Nom du fichier</summary>
    public required string FileName { get; init; }

    /// <summary>Taille en octets</summary>
    public required long Size { get; init; }

    /// <summary>Date de modification</summary>
    public required DateTime DateModified { get; init; }

    /// <summary>True si c'est un dossier</summary>
    public required bool IsDirectory { get; init; }
}

/// <summary>
/// Options de recherche
/// </summary>
public readonly record struct FileSearchOptions
{
    /// <summary>Recherche récursive dans les sous-dossiers</summary>
    public bool Recursive { get; init; } = true;

    /// <summary>Inclure les dossiers dans les résultats</summary>
    public bool IncludeDirectories { get; init; } = false;

    /// <summary>Nombre maximum de résultats (0 = illimité)</summary>
    public int MaxResults { get; init; } = 0;

    /// <summary>Chemin de base pour la recherche (scope)</summary>
    public string? BasePath { get; init; }

    /// <summary>Extensions à filtrer (ex: ".cfg.bin", ".cpk")</summary>
    public string[]? Extensions { get; init; }

    /// <summary>Tri des résultats</summary>
    public FileSearchSort SortBy { get; init; } = FileSearchSort.Path;

    /// <summary>Ordre de tri</summary>
    public bool Ascending { get; init; } = true;

    public FileSearchOptions() { }
}

/// <summary>
/// Options de tri pour les résultats
/// </summary>
public enum FileSearchSort
{
    Path,
    Name,
    Size,
    DateModified,
    Extension
}

/// <summary>
/// Interface pour les providers de recherche de fichiers.
/// Utilisé par CLI et UI pour la recherche instantanée de game assets.
/// </summary>
/// <remarks>
/// Implémentations:
/// - EverythingSearchProvider: P/Invoke Everything API (~50ms sur millions de fichiers)
/// - DirectorySearchProvider: Fallback .NET natif (plus lent mais universel)
/// </remarks>
public interface IFileSearchProvider : IDisposable
{
    /// <summary>
    /// Nom du provider (ex: "Everything", "DirectoryInfo")
    /// </summary>
    string Name { get; }

    /// <summary>
    /// Vérifie si le provider est disponible sur ce système
    /// </summary>
    bool IsAvailable { get; }

    /// <summary>
    /// Recherche des fichiers correspondant au pattern
    /// </summary>
    /// <param name="query">Pattern de recherche (ex: "*.cfg.bin", "chr*")</param>
    /// <param name="options">Options de recherche</param>
    /// <param name="cancellationToken">Token d'annulation</param>
    /// <returns>Stream de résultats (IAsyncEnumerable pour éviter allocations)</returns>
    IAsyncEnumerable<FileSearchResult> SearchAsync(
        string query,
        FileSearchOptions options = default,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Recherche synchrone avec résultats matérialisés
    /// </summary>
    /// <param name="query">Pattern de recherche</param>
    /// <param name="options">Options de recherche</param>
    /// <returns>Liste des résultats</returns>
    List<FileSearchResult> Search(string query, FileSearchOptions options = default);

    /// <summary>
    /// Compte le nombre de fichiers correspondant au pattern (rapide)
    /// </summary>
    int Count(string query, FileSearchOptions options = default);
}
