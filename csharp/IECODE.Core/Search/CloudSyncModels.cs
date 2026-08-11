// IECODE - Cloud Sync Models
// AOT-compatible JSON serialization pour export cloud

using IECODE.Core.Serialization;

namespace IECODE.Core.Search;

/// <summary>
/// Manifest pour synchronisation cloud
/// </summary>
public sealed class CloudSyncManifest
{
    /// <summary>Version du format</summary>
    public required string Version { get; init; }

    /// <summary>Date de génération UTC</summary>
    public required DateTime GeneratedAt { get; init; }

    /// <summary>Chemin source local</summary>
    public required string SourcePath { get; init; }

    /// <summary>Nombre total d'assets</summary>
    public required int TotalAssets { get; init; }

    /// <summary>Taille totale en octets</summary>
    public required long TotalSizeBytes { get; init; }

    /// <summary>Catégories présentes</summary>
    public required string[] Categories { get; init; }

    /// <summary>Liste des assets</summary>
    public required CloudAssetEntry[] Assets { get; init; }
}

/// <summary>
/// Entrée d'asset pour le cloud (version allégée)
/// </summary>
public readonly record struct CloudAssetEntry
{
    /// <summary>Chemin relatif depuis le dossier d'export</summary>
    public required string RelativePath { get; init; }

    /// <summary>Nom du fichier</summary>
    public required string FileName { get; init; }

    /// <summary>Extension</summary>
    public required string Extension { get; init; }

    /// <summary>Taille en octets</summary>
    public required long Size { get; init; }

    /// <summary>Hash MD5 pour vérification d'intégrité</summary>
    public string? Hash { get; init; }

    /// <summary>Date de modification ISO 8601</summary>
    public required string ModifiedAt { get; init; }

    /// <summary>Catégorie IECODE</summary>
    public string? Category { get; init; }

    /// <summary>Largeur (images)</summary>
    public int? Width { get; init; }

    /// <summary>Hauteur (images)</summary>
    public int? Height { get; init; }

    /// <summary>Durée en secondes (vidéos)</summary>
    public double? Duration { get; init; }

    /// <summary>Fichier source original</summary>
    public string? SourceFile { get; init; }
}

/// <summary>
/// Extensions pour export cloud AOT-compatible
/// </summary>
public static class CloudExportExtensions
{
    /// <summary>
    /// Convertit un IndexedAsset en CloudAssetEntry
    /// </summary>
    public static CloudAssetEntry ToCloudEntry(this IndexedAsset asset, string basePath)
    {
        var relativePath = asset.FullPath;
        if (relativePath.StartsWith(basePath, StringComparison.OrdinalIgnoreCase))
        {
            relativePath = relativePath[basePath.Length..].TrimStart(Path.DirectorySeparatorChar);
        }

        return new CloudAssetEntry
        {
            RelativePath = relativePath.Replace('\\', '/'),
            FileName = asset.FileName,
            Extension = asset.Extension,
            Size = asset.Size,
            ModifiedAt = asset.DateModified.ToString("O"),
            Category = asset.Category,
            Width = asset.Width,
            Height = asset.Height,
            Duration = asset.DurationSeconds,
            SourceFile = asset.SourceFile
        };
    }

    /// <summary>
    /// Crée un manifest cloud depuis les données d'export
    /// </summary>
    public static CloudSyncManifest ToCloudManifest(this AssetExportData exportData, string sourcePath)
    {
        var entries = exportData.Assets
            .Select(a => a.ToCloudEntry(sourcePath))
            .ToArray();

        var categories = exportData.Assets
            .Where(a => !string.IsNullOrEmpty(a.Category))
            .Select(a => a.Category!)
            .Distinct()
            .OrderBy(c => c)
            .ToArray();

        return new CloudSyncManifest
        {
            Version = exportData.Version,
            GeneratedAt = exportData.ExportDate,
            SourcePath = sourcePath,
            TotalAssets = exportData.TotalCount,
            TotalSizeBytes = exportData.TotalSize,
            Categories = categories,
            Assets = entries
        };
    }

    /// <summary>
    /// Exporte le manifest en JSON AOT-compatible
    /// </summary>
    public static async Task ExportManifestAsync(
        this CloudSyncManifest manifest,
        string outputPath,
        CancellationToken ct = default)
    {
        await using var stream = File.Create(outputPath);
        await System.Text.Json.JsonSerializer.SerializeAsync(
            stream,
            manifest,
            AppJsonContext.Default.CloudSyncManifest,
            ct);
    }
}
