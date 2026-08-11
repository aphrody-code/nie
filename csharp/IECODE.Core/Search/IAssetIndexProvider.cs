// IECODE - Asset Index Provider Interface
// Windows Index SQL pour PNG/MP4 extraits - Préparation sync cloud/database

namespace IECODE.Core.Search;

/// <summary>
/// Métadonnées d'un asset exporté (PNG, MP4, etc.)
/// Utilisé pour le catalogage et sync cloud
/// </summary>
public readonly record struct IndexedAsset
{
    /// <summary>Chemin complet du fichier</summary>
    public required string FullPath { get; init; }

    /// <summary>Nom du fichier avec extension</summary>
    public required string FileName { get; init; }

    /// <summary>Extension du fichier (.png, .mp4, etc.)</summary>
    public required string Extension { get; init; }

    /// <summary>Taille en octets</summary>
    public required long Size { get; init; }

    /// <summary>Date de création</summary>
    public required DateTime DateCreated { get; init; }

    /// <summary>Date de modification</summary>
    public required DateTime DateModified { get; init; }

    // ===== Métadonnées Images =====

    /// <summary>Largeur en pixels (images uniquement)</summary>
    public int? Width { get; init; }

    /// <summary>Hauteur en pixels (images uniquement)</summary>
    public int? Height { get; init; }

    /// <summary>Profondeur de bits (images)</summary>
    public int? BitDepth { get; init; }

    // ===== Métadonnées Vidéo =====

    /// <summary>Durée en secondes (vidéos)</summary>
    public double? DurationSeconds { get; init; }

    /// <summary>Codec vidéo</summary>
    public string? VideoCodec { get; init; }

    /// <summary>Framerate</summary>
    public double? FrameRate { get; init; }

    // ===== Métadonnées IECODE =====

    /// <summary>Fichier source original (g4tx, cpk, etc.)</summary>
    public string? SourceFile { get; init; }

    /// <summary>Hash du fichier source</summary>
    public string? SourceHash { get; init; }

    /// <summary>Catégorie d'asset (chr, map, effect, etc.)</summary>
    public string? Category { get; init; }
}

/// <summary>
/// Type d'asset pour filtrage
/// </summary>
public enum AssetType
{
    All,
    Image,      // PNG, JPG, BMP, TGA
    Video,      // MP4, MOV, AVI
    Audio,      // WAV, OGG, MP3
    Model,      // GLTF, GLB, FBX
    Data        // JSON, XML
}

/// <summary>
/// Options pour la requête d'indexation
/// </summary>
public readonly record struct AssetIndexQuery
{
    /// <summary>
    /// Constructeur par défaut
    /// </summary>
    public AssetIndexQuery() { }

    /// <summary>Chemin scope pour la recherche</summary>
    public required string Scope { get; init; }

    /// <summary>Type d'asset à rechercher</summary>
    public AssetType AssetType { get; init; } = AssetType.All;

    /// <summary>Extensions spécifiques (override AssetType)</summary>
    public string[]? Extensions { get; init; }

    /// <summary>Filtre sur le nom de fichier (wildcard)</summary>
    public string? FileNameFilter { get; init; }

    /// <summary>Taille minimum en octets</summary>
    public long? MinSize { get; init; }

    /// <summary>Taille maximum en octets</summary>
    public long? MaxSize { get; init; }

    /// <summary>Date de modification minimum</summary>
    public DateTime? ModifiedAfter { get; init; }

    /// <summary>Date de modification maximum</summary>
    public DateTime? ModifiedBefore { get; init; }

    /// <summary>Catégorie IECODE (chr, map, etc.)</summary>
    public string? Category { get; init; }

    /// <summary>Nombre max de résultats</summary>
    public int MaxResults { get; init; } = 1000;

    /// <summary>Colonne de tri</summary>
    public string SortBy { get; init; } = "System.DateModified";

    /// <summary>Tri ascendant</summary>
    public bool Ascending { get; init; } = false;
}

/// <summary>
/// Données pour export vers cloud/database
/// </summary>
public readonly record struct AssetExportData
{
    /// <summary>
    /// Constructeur par défaut
    /// </summary>
    public AssetExportData() { }

    /// <summary>Assets à exporter</summary>
    public required IReadOnlyList<IndexedAsset> Assets { get; init; }

    /// <summary>Date de l'export</summary>
    public required DateTime ExportDate { get; init; }

    /// <summary>Nombre total d'assets</summary>
    public required int TotalCount { get; init; }

    /// <summary>Taille totale en octets</summary>
    public required long TotalSize { get; init; }

    /// <summary>Version du format d'export</summary>
    public string Version { get; init; } = "1.0";
}

/// <summary>
/// Interface pour l'indexation des assets exportés.
/// Utilisé pour le catalogage et la synchronisation cloud/database.
/// </summary>
/// <remarks>
/// Implémentation: WindowsIndexAssetProvider
/// - Utilise Windows Search Index via SQL OLEDB
/// - Récupère les métadonnées riches (dimensions, durée, etc.)
/// - Prépare les données pour export vers cloud (S3, etc.)
/// </remarks>
public interface IAssetIndexProvider : IDisposable
{
    /// <summary>
    /// Nom du provider
    /// </summary>
    string Name { get; }

    /// <summary>
    /// Vérifie si le provider est disponible
    /// </summary>
    bool IsAvailable { get; }

    /// <summary>
    /// Récupère les assets indexés correspondant à la requête
    /// </summary>
    /// <param name="query">Requête d'indexation</param>
    /// <param name="cancellationToken">Token d'annulation</param>
    /// <returns>Stream d'assets indexés</returns>
    IAsyncEnumerable<IndexedAsset> GetAssetsAsync(
        AssetIndexQuery query,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Compte les assets correspondant à la requête
    /// </summary>
    int CountAssets(AssetIndexQuery query);

    /// <summary>
    /// Prépare un export de données pour sync cloud
    /// </summary>
    /// <param name="query">Requête pour sélectionner les assets</param>
    /// <param name="cancellationToken">Token d'annulation</param>
    /// <returns>Données prêtes pour export</returns>
    Task<AssetExportData> PrepareExportAsync(
        AssetIndexQuery query,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Exporte les métadonnées en JSON pour upload cloud
    /// </summary>
    /// <param name="exportData">Données à exporter</param>
    /// <param name="outputPath">Chemin du fichier JSON de sortie</param>
    Task ExportToJsonAsync(AssetExportData exportData, string outputPath);

    /// <summary>
    /// Vérifie que le scope est indexé par Windows
    /// </summary>
    /// <param name="path">Chemin à vérifier</param>
    /// <returns>True si le chemin est dans le scope d'indexation</returns>
    bool IsScopeIndexed(string path);

    /// <summary>
    /// Ajoute un chemin au scope d'indexation Windows (nécessite admin)
    /// </summary>
    /// <param name="path">Chemin à ajouter</param>
    /// <returns>True si ajouté avec succès</returns>
    bool AddToIndexScope(string path);
}
