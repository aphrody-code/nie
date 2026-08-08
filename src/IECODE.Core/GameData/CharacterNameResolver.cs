using System.Text.Json;
using System.Text.Json.Serialization;
using IECODE.Core.Formats.Level5.CfgBin.Encryption;
using IECODE.Core.Formats.Level5.CfgBin;
using IECODE.Core.Formats.Level5.CfgBin.Logic;

namespace IECODE.Core.GameData;

/// <summary>
/// Resolves character hashes (CRC32) to localized names from cfg.bin game files.
/// Supports all 7123 characters with multi-language localization.
/// </summary>
/// <remarks>
/// Uses the following game files:
/// - chara_base*.cfg.bin: Character ID → Name Hash mapping
/// - chara_text.cfg.bin: Name Hash → Localized text mapping (per language)
/// - noun_info.cfg.bin: Additional name mappings
/// 
/// Native AOT compatible - uses source-generated JSON serialization.
/// </remarks>
public sealed class CharacterNameResolver : IDisposable
{
    private readonly Dictionary<uint, LocalizedCharacter> _characterCache = new();
    private readonly Dictionary<uint, string> _hashToNameCache = new();
    private bool _isLoaded;
    private string? _basePath;

    /// <summary>
    /// Données localisées d'un personnage (noms dans toutes les langues supportées).
    /// </summary>
    /// <remarks>
    /// Ce résolveur ne couvre QUE la résolution de noms (chara_base → chara_text).
    /// Les champs position/élément/rareté/stats ont été retirés : ils n'étaient
    /// jamais renseignés (toujours 0) et ne sont PAS présents dans chara_base.
    /// La position et l'élément proviennent de chara_param (voir
    /// <see cref="CharacterParam"/>), la rareté de starSignCharaInfo, et les stats du
    /// growth_table — aucun de ces champs n'est résolu ici, donc ils ne sont pas exposés
    /// (l'ancien <c>CharacterStats</c> Kick/Body/Control/Guard/Speed/Stamina/Guts/Freedom
    ///  n'était même pas la bonne liste de stats IEVR :
    ///  kick/control/technique/physical/pressure/agility/intelligence).
    /// </remarks>
    public sealed record LocalizedCharacter
    {
        public uint Hash { get; init; }
        public string HashHex => $"0x{Hash:X8}";

        /// <summary>Code interne du personnage (chara_base [1], ex. « c01000100 », « npc0010 »).</summary>
        public string InternalId { get; init; } = string.Empty;

        /// <summary>Alias de <see cref="InternalId"/> (compatibilité ; ce n'est PAS un model 3D).</summary>
        public string ModelId { get; init; } = string.Empty;

        public LocalizedString Names { get; init; } = new();
    }

    /// <summary>
    /// Localized string container for all supported languages.
    /// </summary>
    public sealed record LocalizedString
    {
        public string Japanese { get; init; } = string.Empty;
        public string English { get; init; } = string.Empty;
        public string French { get; init; } = string.Empty;
        public string German { get; init; } = string.Empty;
        public string Spanish { get; init; } = string.Empty;
        public string Italian { get; init; } = string.Empty;

        public string GetByCode(string languageCode) => languageCode.ToLowerInvariant() switch
        {
            "ja" or "jp" => Japanese,
            "en" => English,
            "fr" => French,
            "de" => German,
            "es" => Spanish,
            "it" => Italian,
            _ => English
        };
    }

    /// <summary>
    /// Supported language codes.
    /// </summary>
    public static readonly string[] SupportedLanguages = ["ja", "en", "fr", "de", "es", "it"];

    /// <summary>
    /// Whether character data has been loaded.
    /// </summary>
    public bool IsLoaded => _isLoaded;

    /// <summary>
    /// Number of loaded characters.
    /// </summary>
    public int CharacterCount => _characterCache.Count;

    /// <summary>
    /// Loads character data from cfg.bin files in the game dump folder.
    /// </summary>
    /// <param name="gameDataPath">Path to the game data dump folder containing 'data/' subfolder.</param>
    /// <param name="cancellationToken">Cancellation token for async operation.</param>
    /// <returns>Number of characters loaded.</returns>
    public async Task<int> LoadFromGameDataAsync(string gameDataPath, CancellationToken cancellationToken = default)
    {
        _basePath = gameDataPath;
        _characterCache.Clear();
        _hashToNameCache.Clear();

        // Step 1: Load character base info (ID → Name Hash mapping)
        var baseInfos = await LoadCharacterBaseInfoAsync(gameDataPath, cancellationToken);

        // Step 2: Load localized names for each language
        var localizedNames = new Dictionary<string, Dictionary<uint, string>>();
        foreach (var lang in SupportedLanguages)
        {
            cancellationToken.ThrowIfCancellationRequested();
            localizedNames[lang] = await LoadNounInfoAsync(gameDataPath, lang, cancellationToken);
        }

        // Step 3: Build character cache
        foreach (var (hash, baseInfo) in baseInfos)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var names = new LocalizedString
            {
                Japanese = localizedNames.GetValueOrDefault("ja")?.GetValueOrDefault((uint)baseInfo.NameId) ?? string.Empty,
                English = localizedNames.GetValueOrDefault("en")?.GetValueOrDefault((uint)baseInfo.NameId) ?? string.Empty,
                French = localizedNames.GetValueOrDefault("fr")?.GetValueOrDefault((uint)baseInfo.NameId) ?? string.Empty,
                German = localizedNames.GetValueOrDefault("de")?.GetValueOrDefault((uint)baseInfo.NameId) ?? string.Empty,
                Spanish = localizedNames.GetValueOrDefault("es")?.GetValueOrDefault((uint)baseInfo.NameId) ?? string.Empty,
                Italian = localizedNames.GetValueOrDefault("it")?.GetValueOrDefault((uint)baseInfo.NameId) ?? string.Empty,
            };

            var character = new LocalizedCharacter
            {
                Hash = hash,
                InternalId = baseInfo.InternalCode ?? string.Empty,
                ModelId = baseInfo.InternalCode ?? string.Empty,
                Names = names,
            };

            _characterCache[hash] = character;

            // Also cache name hash → name for quick lookup
            if (!_hashToNameCache.ContainsKey((uint)baseInfo.NameId))
            {
                var bestName = !string.IsNullOrEmpty(names.English) ? names.English : names.Japanese;
                _hashToNameCache[(uint)baseInfo.NameId] = bestName;
            }
        }

        _isLoaded = true;
        return _characterCache.Count;
    }

    /// <summary>
    /// Gets a character by hash.
    /// </summary>
    public LocalizedCharacter? GetCharacter(uint hash)
    {
        return _characterCache.GetValueOrDefault(hash);
    }

    /// <summary>
    /// Gets character name by hash for a specific language.
    /// </summary>
    public string GetName(uint hash, string language = "en")
    {
        var character = GetCharacter(hash);
        if (character == null)
            return $"Unknown (0x{hash:X8})";

        var name = character.Names.GetByCode(language);
        return !string.IsNullOrEmpty(name) ? name : character.Names.English;
    }

    /// <summary>
    /// Gets character name by hash with fallback to any available language.
    /// </summary>
    public string GetNameAny(uint hash)
    {
        var character = GetCharacter(hash);
        if (character == null)
            return $"Unknown (0x{hash:X8})";

        // Priority: EN > JP > FR > any
        if (!string.IsNullOrEmpty(character.Names.English))
            return character.Names.English;
        if (!string.IsNullOrEmpty(character.Names.Japanese))
            return character.Names.Japanese;
        if (!string.IsNullOrEmpty(character.Names.French))
            return character.Names.French;

        return character.HashHex;
    }

    /// <summary>
    /// Searches characters by name (partial match, case-insensitive).
    /// </summary>
    public IEnumerable<LocalizedCharacter> Search(string query, string language = "en")
    {
        if (string.IsNullOrWhiteSpace(query))
            return _characterCache.Values;

        var lowerQuery = query.ToLowerInvariant();

        return _characterCache.Values.Where(c =>
        {
            var name = c.Names.GetByCode(language);
            if (!string.IsNullOrEmpty(name) && name.Contains(query, StringComparison.OrdinalIgnoreCase))
                return true;

            // Also search in internal ID
            if (c.InternalId.Contains(query, StringComparison.OrdinalIgnoreCase))
                return true;

            // Search by hex hash
            if (c.HashHex.Contains(query, StringComparison.OrdinalIgnoreCase))
                return true;

            return false;
        });
    }

    /// <summary>
    /// Gets all characters.
    /// </summary>
    public IReadOnlyCollection<LocalizedCharacter> GetAllCharacters() => _characterCache.Values;

    /// <summary>
    /// Exports character data to JSON file for caching.
    /// </summary>
    public async Task ExportToCacheAsync(string outputPath, CancellationToken cancellationToken = default)
    {
        var options = new JsonSerializerOptions
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            TypeInfoResolver = CharacterNameResolverJsonContext.Default
        };

        var data = new CharacterCacheData
        {
            Version = "1.0",
            GeneratedAt = DateTime.UtcNow,
            CharacterCount = _characterCache.Count,
            Characters = _characterCache.Values.ToList()
        };

        await using var stream = File.Create(outputPath);
        await JsonSerializer.SerializeAsync(stream, data, CharacterNameResolverJsonContext.Default.CharacterCacheData, cancellationToken);
    }

    /// <summary>
    /// Loads character data from cached JSON file.
    /// </summary>
    public async Task<int> LoadFromCacheAsync(string cachePath, CancellationToken cancellationToken = default)
    {
        if (!File.Exists(cachePath))
            return 0;

        await using var stream = File.OpenRead(cachePath);
        var data = await JsonSerializer.DeserializeAsync(
            stream,
            CharacterNameResolverJsonContext.Default.CharacterCacheData,
            cancellationToken);

        if (data?.Characters == null)
            return 0;

        _characterCache.Clear();
        foreach (var character in data.Characters)
        {
            _characterCache[character.Hash] = character;
        }

        _isLoaded = true;
        return _characterCache.Count;
    }

    #region Private Methods

    private async Task<Dictionary<uint, CharacterBaseInfo>> LoadCharacterBaseInfoAsync(
        string basePath,
        CancellationToken cancellationToken)
    {
        var result = new Dictionary<uint, CharacterBaseInfo>();
        var characterPath = Path.Combine(basePath, "data", "common", "gamedata", "character");

        if (!Directory.Exists(characterPath))
            return result;

        // Find all chara_base*.cfg.bin files
        var cfgBinFiles = Directory.GetFiles(characterPath, "chara_base*.cfg.bin");
        foreach (var file in cfgBinFiles)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var cfgBin = await LoadCfgBinAsync(file, cancellationToken);
            if (cfgBin == null) continue;

            var entries = FindEntriesByPrefix(cfgBin, "CHARA_BASE_INFO");
            foreach (var entry in entries)
            {
                var info = new CharacterBaseInfo(entry);
                var hash = (uint)info.CharacterId;
                result.TryAdd(hash, info);
            }
        }

        return result;
    }

    private async Task<Dictionary<uint, string>> LoadNounInfoAsync(
        string basePath,
        string language,
        CancellationToken cancellationToken)
    {
        var result = new Dictionary<uint, string>();
        var textPath = Path.Combine(basePath, "data", "common", "text", language);

        if (!Directory.Exists(textPath))
            return result;

        // Look for chara_text.cfg.bin or noun_info.cfg.bin
        string[] possibleFiles = [
            Path.Combine(textPath, "chara_text.cfg.bin"),
            Path.Combine(textPath, "noun_info.cfg.bin")
        ];

        foreach (var file in possibleFiles)
        {
            if (!File.Exists(file)) continue;

            cancellationToken.ThrowIfCancellationRequested();

            var cfgBin = await LoadCfgBinAsync(file, cancellationToken);
            if (cfgBin == null) continue;

            var entries = FindEntriesByPrefix(cfgBin, "NOUN_INFO");
            foreach (var entry in entries)
            {
                var info = new NounInfo(entry);
                if (!string.IsNullOrEmpty(info.Name))
                {
                    result.TryAdd((uint)info.Crc32, info.Name);
                }
            }
        }

        return result;
    }

    private static async Task<CfgBin?> LoadCfgBinAsync(string path, CancellationToken cancellationToken)
    {
        if (!File.Exists(path))
            return null;

        var data = await File.ReadAllBytesAsync(path, cancellationToken);

        // Decrypt if necessary (Criware encryption)
        if (!CfgBin.HasValidFooter(data))
        {
            data = CriwareCrypt.Decrypt(data, Path.GetFileName(path));
        }

        var cfgBin = new CfgBin();
#pragma warning disable IL2026
        cfgBin.Open(data);
#pragma warning restore IL2026
        return cfgBin;
    }

    private static List<Entry> FindEntriesByPrefix(CfgBin cfgBin, string prefix)
    {
        var items = new List<Entry>();
        foreach (var entry in cfgBin.Entries)
        {
            FindEntriesRecursive(entry, prefix, items);
        }
        return items;
    }

    private static void FindEntriesRecursive(Entry entry, string prefix, List<Entry> items)
    {
        if (entry.Name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            items.Add(entry);
        }

        foreach (var child in entry.Children)
        {
            FindEntriesRecursive(child, prefix, items);
        }
    }

    #endregion

    public void Dispose()
    {
        _characterCache.Clear();
        _hashToNameCache.Clear();
        _isLoaded = false;
    }
}

/// <summary>
/// Cache data structure for serialization.
/// </summary>
public sealed record CharacterCacheData
{
    public string Version { get; init; } = "1.0";
    public DateTime GeneratedAt { get; init; }
    public int CharacterCount { get; init; }
    public List<CharacterNameResolver.LocalizedCharacter> Characters { get; init; } = [];
}

/// <summary>
/// JSON serializer context for Native AOT compatibility.
/// </summary>
[JsonSerializable(typeof(CharacterCacheData))]
[JsonSerializable(typeof(CharacterNameResolver.LocalizedCharacter))]
[JsonSerializable(typeof(CharacterNameResolver.LocalizedString))]
[JsonSerializable(typeof(List<CharacterNameResolver.LocalizedCharacter>))]
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
public partial class CharacterNameResolverJsonContext : JsonSerializerContext
{
}
