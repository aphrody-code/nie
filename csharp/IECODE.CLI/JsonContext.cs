using System.Text.Json.Serialization;
using IECODE.Core.Formats.Level5;

namespace IECODE.CLI;

/// <summary>
/// JsonSerializerContext pour AOT compatibility
/// </summary>
[JsonSerializable(typeof(GameAnalysisReport))]
[JsonSerializable(typeof(G4mdParser.G4mdHeader))]
[JsonSerializable(typeof(G4mdParser.G4mdInfo))]
[JsonSerializable(typeof(Commands.SearchCommand.Root))]
[JsonSerializable(typeof(CharacterSearchOutput[]))]
[JsonSerializable(typeof(FormatDetectionResult[]))]
[JsonSerializable(typeof(G4raResourceInfo[]))]
[JsonSerializable(typeof(G4pkEntryInfo[]))]
[JsonSerializable(typeof(P3lipJson))]
[JsonSourceGenerationOptions(
    WriteIndented = true,
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    IncludeFields = true)]
public partial class JsonContext : JsonSerializerContext
{
}

/// <summary>
/// Format detection result for JSON serialization
/// </summary>
public class FormatDetectionResult
{
    public string Path { get; set; } = "";
    public string Format { get; set; } = "";
    public string Extension { get; set; } = "";
    public string Description { get; set; } = "";
    public bool IsBigEndian { get; set; }
}

/// <summary>
/// Rapport d'analyse du jeu (pour JSON serialization)
/// </summary>
/// <summary>
/// Character search output for JSON serialization
/// </summary>
public class CharacterSearchOutput
{
    public string Name { get; set; } = "";
    public int Crc32 { get; set; }
    public string Crc32Hex { get; set; } = "";
    public string? ModelId { get; set; }
}

public class GameAnalysisReport
{
    public string? GamePath { get; set; }
    public string? PacksPath { get; set; }
    public int CpkCount { get; set; }
    public long TotalCpkSize { get; set; }
    public DateTime AnalyzedAt { get; set; }
    public Dictionary<string, int>? FileTypes { get; set; }
}

/// <summary>
/// G4PK sub-file entry info for JSON serialization (AOT-compatible)
/// </summary>
public class G4pkEntryInfo
{
    public string Name { get; set; } = "";
    public int Size { get; set; }
    public int Offset { get; set; }
    public string Hash { get; set; } = "";
    public string Format { get; set; } = "";
}

/// <summary>
/// G4RA resource info for JSON serialization (AOT-compatible)
/// </summary>
public class G4raResourceInfo
{
    public int Index { get; set; }
    public string Name { get; set; } = "";
    public uint Offset { get; set; }
    public uint Size { get; set; }
    public ushort RefCount { get; set; }
    public byte Flags { get; set; }
}

/// <summary>
/// P3lip (lives::CResLipSync) lip-sync track for JSON serialization (AOT-compatible).
/// </summary>
public class P3lipJson
{
    public float Duration { get; set; }
    public uint FileSize { get; set; }
    public int Count { get; set; }
    public P3lipFrameJson[] Frames { get; set; } = System.Array.Empty<P3lipFrameJson>();
}

public class P3lipFrameJson
{
    public float Time { get; set; }
    public byte Phoneme { get; set; }
    public byte Channel { get; set; }
    public ushort Weight { get; set; }
    public bool Sentinel { get; set; }
}
