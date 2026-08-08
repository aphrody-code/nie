using System.Runtime.CompilerServices;
using System.Runtime.Versioning;
using System.Text.Json;
using IECODE.Core.Serialization;

namespace IECODE.Core.Search;

/// <summary>
/// Implémentation de IAssetIndexProvider utilisant Windows Search.
/// Note: Nécessite le package System.Data.OleDb pour fonctionner pleinement sur Windows.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class WindowsIndexAssetProvider : IAssetIndexProvider
{
    public string Name => "Windows Index";

    public bool IsAvailable => OperatingSystem.IsWindows();

    public async IAsyncEnumerable<IndexedAsset> GetAssetsAsync(
        AssetIndexQuery query,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        // Stub implementation for now as System.Data.OleDb is missing
        await Task.CompletedTask;
        yield break;
    }

    public int CountAssets(AssetIndexQuery query)
    {
        return 0;
    }

    public async Task<AssetExportData> PrepareExportAsync(
        AssetIndexQuery query,
        CancellationToken cancellationToken = default)
    {
        var assets = new List<IndexedAsset>();
        await foreach (var asset in GetAssetsAsync(query, cancellationToken))
        {
            assets.Add(asset);
        }

        return new AssetExportData
        {
            Assets = assets,
            ExportDate = DateTime.UtcNow,
            TotalCount = assets.Count,
            TotalSize = assets.Sum(a => a.Size),
            Version = "1.0"
        };
    }

    public async Task ExportToJsonAsync(AssetExportData exportData, string outputPath)
    {
        await using var stream = File.Create(outputPath);
        await JsonSerializer.SerializeAsync(stream, exportData, AppJsonContext.Default.AssetExportData);
    }

    public bool IsScopeIndexed(string path)
    {
        return false;
    }

    public bool AddToIndexScope(string path)
    {
        return false;
    }

    public void Dispose()
    {
        // Nothing to dispose in stub
    }
}
