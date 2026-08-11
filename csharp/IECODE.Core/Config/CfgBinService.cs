using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using IECODE.Core.Formats.Level5.CfgBin.Encryption;
using IECODE.Core.Formats.Level5.CfgBin;
using IECODE.Core.Formats.Level5.CfgBin.Logic;
using IECODE.Core.Formats.Level5.CfgBin.Rdbn;
using IECODE.Core.Serialization;

namespace IECODE.Core.Config;

/// <summary>
/// Service de lecture/écriture des fichiers cfg.bin de Level-5.
/// Wrapper autour de IECODE.Core.Formats.Level5.CfgBin.
/// </summary>
public sealed class CfgBinService
{
    private readonly IEVRGame _game;

    public CfgBinService(IEVRGame game)
    {
        _game = game;
    }

    /// <summary>
    /// Lit un fichier cfg.bin et retourne sa structure.
    /// </summary>
    /// <param name="filePath">Chemin vers le fichier cfg.bin</param>
    /// <param name="autoDecrypt">Décrypter automatiquement si nécessaire (utilise le nom du fichier comme clé)</param>
    public CfgBinData ReadFile(string filePath, bool autoDecrypt = true)
    {
        byte[] data = File.ReadAllBytes(filePath);
        string fileName = Path.GetFileName(filePath);

        // Check if encrypted using CfgBin footer detection
        if (autoDecrypt && !CfgBin.HasValidFooter(data))
        {
            data = CriwareCrypt.Decrypt(data, fileName);
        }

        var cfgBin = new CfgBin();
#pragma warning disable IL2026
        cfgBin.Open(data);
#pragma warning restore IL2026

        return ConvertToData(cfgBin);
    }

    /// <summary>
    /// Lit un fichier cfg.bin et retourne l'objet CfgBin natif.
    /// </summary>
    public CfgBin ReadCfgBin(string filePath, bool autoDecrypt = true)
    {
        byte[] data = File.ReadAllBytes(filePath);
        string fileName = Path.GetFileName(filePath);

        if (autoDecrypt && !CfgBin.HasValidFooter(data))
        {
            data = CriwareCrypt.Decrypt(data, fileName);
        }

        var cfgBin = new CfgBin();
#pragma warning disable IL2026
        cfgBin.Open(data);
#pragma warning restore IL2026
        return cfgBin;
    }

    /// <summary>
    /// Décrypte un fichier cfg.bin.
    /// </summary>
    public byte[] DecryptFile(string filePath)
    {
        byte[] data = File.ReadAllBytes(filePath);
        string fileName = Path.GetFileName(filePath);
        return CriwareCrypt.Decrypt(data, fileName);
    }

    /// <summary>
    /// Chiffre un fichier cfg.bin.
    /// </summary>
    public byte[] EncryptFile(byte[] data, string keyName)
    {
        return CriwareCrypt.Encrypt(data, keyName);
    }

    /// <summary>
    /// Lit le fichier cpk_list.cfg.bin du jeu.
    /// </summary>
    public CpkListData ReadCpkList()
    {
        if (!File.Exists(_game.CpkListPath))
        {
            throw new FileNotFoundException($"cpk_list.cfg.bin not found: {_game.CpkListPath}");
        }

        var cfgBin = ReadCfgBin(_game.CpkListPath, autoDecrypt: true);
        return ParseCpkList(cfgBin);
    }

    /// <summary>
    /// Liste tous les fichiers cfg.bin du jeu.
    /// </summary>
    public IEnumerable<string> GetAllCfgBinFiles()
    {
        if (!Directory.Exists(_game.DataPath))
            yield break;

        foreach (var file in Directory.EnumerateFiles(_game.DataPath, "*.cfg.bin", SearchOption.AllDirectories))
        {
            yield return file;
        }
    }

    /// <summary>
    /// Recherche des entrées dans un cfg.bin.
    /// </summary>
    public List<Entry> FindEntries(string filePath, string pattern, bool autoDecrypt = true)
    {
        var cfgBin = ReadCfgBin(filePath, autoDecrypt);
        return cfgBin.FindEntry(pattern);
    }

    /// <summary>
    /// Sauvegarde un fichier cfg.bin.
    /// </summary>
    /// <param name="cfgBin">Instance CfgBin à sauvegarder</param>
    /// <param name="outputPath">Chemin de sortie</param>
    /// <param name="encrypt">Chiffrer le fichier</param>
    public void WriteFile(CfgBin cfgBin, string outputPath, bool encrypt = false)
    {
        byte[] savedData = cfgBin.Save();

        if (encrypt)
        {
            _game.Crypto.DecryptCfgBinInPlace(savedData); // XOR encryption is symmetric
        }

        var dir = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrEmpty(dir))
        {
            Directory.CreateDirectory(dir);
        }

        File.WriteAllBytes(outputPath, savedData);
    }

    /// <summary>
    /// Exporte un cfg.bin vers JSON (supporte T2B et RDBN).
    /// Uses streaming writer to handle extremely deep structures.
    /// </summary>
    public string ExportToJson(string filePath, bool decrypt = true)
    {
        byte[] rawData = File.ReadAllBytes(filePath);
        string fileName = Path.GetFileName(filePath);

        // Try decrypt if needed
        byte[] data = rawData;
        if (decrypt && !CfgBin.HasValidFooter(rawData) && !RdbnReader.IsRdbn(rawData))
        {
            data = CriwareCrypt.Decrypt(rawData, fileName);
        }

        // Detect format
        if (RdbnReader.IsRdbn(data))
        {
            return RdbnReader.ToJson(data, indented: true);
        }
        else
        {
            var cfgData = ReadFile(filePath, decrypt);
            return SerializeCfgBinDataStreaming(cfgData);
        }
    }

    /// <summary>
    /// Exporte un cfg.bin vers un fichier JSON (pour les très gros fichiers).
    /// </summary>
    public void ExportToJsonFile(string filePath, string outputPath, bool decrypt = true)
    {
        byte[] rawData = File.ReadAllBytes(filePath);
        string fileName = Path.GetFileName(filePath);

        // Try decrypt if needed
        byte[] data = rawData;
        if (decrypt && !CfgBin.HasValidFooter(rawData) && !RdbnReader.IsRdbn(rawData))
        {
            data = CriwareCrypt.Decrypt(rawData, fileName);
        }

        // Detect format
        if (RdbnReader.IsRdbn(data))
        {
            File.WriteAllText(outputPath, RdbnReader.ToJson(data, indented: true));
        }
        else
        {
            var cfgData = ReadFile(filePath, decrypt);
            SerializeCfgBinDataToFile(cfgData, outputPath);
        }
    }

    /// <summary>
    /// Serialize CfgBinData using Utf8JsonWriter with no depth limit.
    /// </summary>
    private static string SerializeCfgBinDataStreaming(CfgBinData data)
    {
        using var stream = new MemoryStream();
        using var writer = new Utf8JsonWriter(stream, new JsonWriterOptions
        {
            Indented = true,
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            MaxDepth = int.MaxValue
        });

        writer.WriteStartObject();
        writer.WritePropertyName("entries");
        WriteEntryList(writer, data.Entries);
        writer.WriteEndObject();
        writer.Flush();

        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    /// <summary>
    /// Serialize CfgBinData directly to file to avoid memory issues.
    /// </summary>
    private static void SerializeCfgBinDataToFile(CfgBinData data, string outputPath)
    {
        using var stream = File.Create(outputPath);
        using var writer = new Utf8JsonWriter(stream, new JsonWriterOptions
        {
            Indented = true,
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            MaxDepth = int.MaxValue
        });

        writer.WriteStartObject();
        writer.WritePropertyName("entries");
        WriteEntryList(writer, data.Entries);
        writer.WriteEndObject();
    }

    private static void WriteEntryList(Utf8JsonWriter writer, List<CfgBinEntry> entries)
    {
        writer.WriteStartArray();
        foreach (var entry in entries)
        {
            WriteEntry(writer, entry);
        }
        writer.WriteEndArray();
    }

    private static void WriteEntry(Utf8JsonWriter writer, CfgBinEntry entry)
    {
        writer.WriteStartObject();
        writer.WriteString("name", entry.Name);

        writer.WritePropertyName("variables");
        writer.WriteStartArray();
        foreach (var v in entry.Variables)
        {
            writer.WriteStartObject();
            writer.WriteString("type", v.Type);
            writer.WriteString("value", v.Value);
            writer.WriteEndObject();
        }
        writer.WriteEndArray();

        writer.WritePropertyName("children");
        WriteEntryList(writer, entry.Children);

        writer.WriteEndObject();
    }

    /// <summary>
    /// Détecte le format d'un fichier cfg.bin.
    /// </summary>
    public CfgBinFormat DetectFormat(string filePath)
    {
        byte[] data = File.ReadAllBytes(filePath);
        string fileName = Path.GetFileName(filePath);

        // Check if encrypted
        bool isEncrypted = !CfgBin.HasValidFooter(data) && !RdbnReader.IsRdbn(data);

        if (isEncrypted)
        {
            data = CriwareCrypt.Decrypt(data, fileName);
        }

        if (RdbnReader.IsRdbn(data))
            return new CfgBinFormat("RDBN", isEncrypted, data.Length);

        if (CfgBin.HasValidFooter(data))
            return new CfgBinFormat("T2B", isEncrypted, data.Length);

        return new CfgBinFormat("Unknown", isEncrypted, data.Length);
    }

    /// <summary>
    /// Convertit CfgBin vers CfgBinData.
    /// </summary>
    private static CfgBinData ConvertToData(CfgBin cfgBin)
    {
        var data = new CfgBinData
        {
            Entries = new List<CfgBinEntry>()
        };

        foreach (var entry in cfgBin.Entries)
        {
            data.Entries.Add(ConvertEntry(entry));
        }

        return data;
    }

    private static CfgBinEntry ConvertEntry(Entry entry)
    {
        var result = new CfgBinEntry
        {
            Name = entry.Name,
            Variables = new List<CfgBinVariable>(),
            Children = new List<CfgBinEntry>()
        };

        if (entry.Variables != null)
        {
            foreach (var v in entry.Variables)
            {
                result.Variables.Add(new CfgBinVariable
                {
                    Type = v.Type.ToString(),
                    Value = v.Value?.ToString() ?? string.Empty
                });
            }
        }

        if (entry.Children != null)
        {
            foreach (var child in entry.Children)
            {
                result.Children.Add(ConvertEntry(child));
            }
        }

        return result;
    }

    /// <summary>
    /// Parse le cpk_list.cfg.bin vers une structure typée.
    /// </summary>
    private static CpkListData ParseCpkList(CfgBin cfgBin)
    {
        var result = new CpkListData
        {
            Files = new List<CpkListEntry>()
        };

        if (cfgBin.Entries.Count == 0 || cfgBin.Entries[0].Children == null)
        {
            return result;
        }

        foreach (var item in cfgBin.Entries[0].Children)
        {
            if (item.Variables == null || item.Variables.Count < 5) continue;

            result.Files.Add(new CpkListEntry
            {
                Directory = item.Variables[0].Value?.ToString() ?? string.Empty,
                FileName = item.Variables[1].Value?.ToString() ?? string.Empty,
                CpkDirectory = item.Variables[2].Value?.ToString() ?? string.Empty,
                CpkName = item.Variables[3].Value?.ToString() ?? string.Empty,
                FileSize = Convert.ToInt64(item.Variables[4].Value ?? 0)
            });
        }

        return result;
    }
}

#region Data Models

/// <summary>
/// Représentation d'un fichier cfg.bin complet.
/// </summary>
public sealed class CfgBinData
{
    public List<CfgBinEntry> Entries { get; set; } = new();
}

/// <summary>
/// Entrée dans un cfg.bin.
/// </summary>
public sealed class CfgBinEntry
{
    public string Name { get; set; } = string.Empty;
    public List<CfgBinVariable> Variables { get; set; } = new();
    public List<CfgBinEntry> Children { get; set; } = new();
}

/// <summary>
/// Variable dans une entrée cfg.bin.
/// </summary>
public sealed class CfgBinVariable
{
    public string Type { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
}

/// <summary>
/// Données du cpk_list.cfg.bin.
/// </summary>
public sealed class CpkListData
{
    public List<CpkListEntry> Files { get; set; } = new();
}

/// <summary>
/// Entrée dans cpk_list.cfg.bin.
/// </summary>
public sealed class CpkListEntry
{
    public string Directory { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string CpkDirectory { get; set; } = string.Empty;
    public string CpkName { get; set; } = string.Empty;
    public long FileSize { get; set; }

    [JsonIgnore]
    public string FullPath => Directory + FileName;

    [JsonIgnore]
    public bool IsLoose => string.IsNullOrEmpty(CpkName);
}

/// <summary>
/// Informations sur le format d'un fichier cfg.bin.
/// </summary>
public sealed record CfgBinFormat(string Type, bool IsEncrypted, long Size);

#endregion

