using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Encodings.Web;
using Viola.Core.Settings.Logic;
using IECODE.Core.Search;
using IECODE.Core.GameData;
using IECODE.Core.Config;
using IECODE.Core.Dump;
using IECODE.Core.Converters;

namespace IECODE.Core.Serialization;

/// <summary>
/// Centralized JSON Serialization Context for IECODE.
/// Provides Source Generation for Native AOT compatibility across the entire application.
/// </summary>
#pragma warning disable SYSLIB1225 // Type includes ref struct
[JsonSourceGenerationOptions(
    WriteIndented = true,
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    UseStringEnumConverter = true)]
// Config
[JsonSerializable(typeof(CfgBinData))]
[JsonSerializable(typeof(CpkListData))]
// Dump
[JsonSerializable(typeof(DumpManifest))]
[JsonSerializable(typeof(DumpResult))]
[JsonSerializable(typeof(HashSet<string>))]
[JsonSerializable(typeof(Dictionary<string, ExtractedFileInfo>))]
[JsonSerializable(typeof(ExtractedFileInfo))]
// Game Info
[JsonSerializable(typeof(GameInfo))]
// Search & Cloud
[JsonSerializable(typeof(IndexedAsset))]
[JsonSerializable(typeof(IndexedAsset[]))]
[JsonSerializable(typeof(List<IndexedAsset>))]
[JsonSerializable(typeof(AssetExportData))]
[JsonSerializable(typeof(FileSearchResult))]
[JsonSerializable(typeof(FileSearchResult[]))]
[JsonSerializable(typeof(List<FileSearchResult>))]
[JsonSerializable(typeof(CloudSyncManifest))]
[JsonSerializable(typeof(CloudAssetEntry))]
[JsonSerializable(typeof(CloudAssetEntry[]))]
[JsonSerializable(typeof(List<CloudAssetEntry>))]
// Viola Settings
[JsonSerializable(typeof(CSettings))]
// Game Data
[JsonSerializable(typeof(List<CharacterBaseInfo>))]
[JsonSerializable(typeof(List<ItemConfig>))]
[JsonSerializable(typeof(List<AuraSkillConfig>))]
[JsonSerializable(typeof(List<SubtitleData>))]
[JsonSerializable(typeof(List<NounInfo>))]
[JsonSerializable(typeof(List<CharacterParam>))]
// Converters
[JsonSerializable(typeof(PackageInfo))]
[JsonSerializable(typeof(SkeletonData))]
[JsonSerializable(typeof(BoneData))]
[JsonSerializable(typeof(MaterialData))]
[JsonSerializable(typeof(MaterialBlockData))]
[JsonSerializable(typeof(BinaryFileInfo))]
[JsonSerializable(typeof(List<BoneData>))]
[JsonSerializable(typeof(List<MaterialBlockData>))]
#pragma warning disable SYSLIB1225 // Type includes ref struct
public partial class AppJsonContext : JsonSerializerContext
{
#pragma warning restore SYSLIB1225
    private static JsonSerializerOptions? _options;

    /// <summary>
    /// Configured JsonSerializerOptions with UnsafeRelaxedJsonEscaping for UTF-8 support.
    /// Use this instead of default options when serializing to preserve non-ASCII characters.
    /// </summary>
    public new static JsonSerializerOptions Options
    {
        get
        {
            if (_options == null)
            {
                _options = new JsonSerializerOptions
                {
                    WriteIndented = true,
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
                    Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
                    TypeInfoResolver = Default,
                    MaxDepth = 1024 // Deep cfg.bin hierarchies like NPC settings can be very deep
                };
            }
            return _options;
        }
    }

    /// <summary>
    /// Serialize PackageInfo to JSON string (AOT-safe).
    /// </summary>
    public static string SerializePackageInfo(PackageInfo value)
        => JsonSerializer.Serialize(value, Default.PackageInfo);

    /// <summary>
    /// Serialize SkeletonData to JSON string (AOT-safe).
    /// </summary>
    public static string SerializeSkeletonData(SkeletonData value)
        => JsonSerializer.Serialize(value, Default.SkeletonData);

    /// <summary>
    /// Serialize MaterialData to JSON string (AOT-safe).
    /// </summary>
    public static string SerializeMaterialData(MaterialData value)
        => JsonSerializer.Serialize(value, Default.MaterialData);

    /// <summary>
    /// Serialize BinaryFileInfo to JSON string (AOT-safe).
    /// </summary>
    public static string SerializeBinaryFileInfo(BinaryFileInfo value)
        => JsonSerializer.Serialize(value, Default.BinaryFileInfo);
}