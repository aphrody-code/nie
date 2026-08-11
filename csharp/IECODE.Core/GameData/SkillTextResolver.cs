using System.Text.Json;
using System.Text.Json.Serialization;
using IECODE.Core.Formats.Level5.CfgBin.Encryption;
using IECODE.Core.Formats.Level5.CfgBin;
using IECODE.Core.Formats.Level5.CfgBin.Logic;

namespace IECODE.Core.GameData;

/// <summary>
/// Résout les talents passifs (passive_skill_config) vers leurs noms/descriptions localisés.
/// </summary>
/// <remarks>
/// Layout et jointures vérifiés contre inagle
/// (packages/inagle/src/parsers/passive-skill-config.ts, collectSkills) et le dump :
/// - passive_skill_config.cfg.bin (PASSIVE_SKILL_INFO_*) :
///   [0] passiveId, [1] effectId, [2] nameId, [3] descId, [4] rareté.
/// - skill_text.cfg.bin (NOUN_INFO_*) : [0] hash, [5] texte localisé
///   (ex. fr « Trampoline du tonnerre »).
///   nameId/descId → ces tables NOUN_INFO localisées.
///
/// CE QUI A ÉTÉ RETIRÉ (fabriqué, sans aucune assise dans le dump ni inagle) :
/// - l'enum EffectTypes (KickBoost=1…TeamSynergy=20) et ses noms anglais inventés ;
/// - le type LocalizedTechnique (Type/TpCost/Power/Element) jamais renseigné ;
/// - PassiveSkillJsonEntry (BuildType/IconIndex…) et ExtractLevelFromName (regex « Lv.N »).
/// Le vrai effet d'un passif vit dans passive_skill_effect_config (8 effets, params float) ;
/// il n'est pas une table d'enum de boosts par stat.
/// </remarks>
public sealed class SkillTextResolver : IDisposable
{
    private readonly Dictionary<uint, LocalizedSkill> _skillCache = new();
    private bool _isLoaded;

    /// <summary>
    /// Talent passif localisé.
    /// </summary>
    public sealed record LocalizedSkill
    {
        /// <summary>Hash du passif (passive_skill_config [0]).</summary>
        public uint PassiveHash { get; init; }

        /// <summary>Hash de l'effet lié (passive_skill_config [1] → passive_skill_effect_config).</summary>
        public uint EffectHash { get; init; }

        /// <summary>Hash du nom (passive_skill_config [2] → skill_text NOUN_INFO).</summary>
        public uint NameHash { get; init; }

        /// <summary>Hash de la description (passive_skill_config [3]).</summary>
        public uint DescHash { get; init; }

        /// <summary>Rareté (passive_skill_config [4], ex. 6 ou 9 observés).</summary>
        public int Rarity { get; init; }

        public string PassiveHashHex => $"0x{PassiveHash:X8}";
        public LocalizedText Names { get; init; } = new();
        public LocalizedText Descriptions { get; init; } = new();
    }

    /// <summary>
    /// Conteneur de texte localisé.
    /// </summary>
    public sealed record LocalizedText
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

        public bool HasAny => !string.IsNullOrEmpty(Japanese) ||
                              !string.IsNullOrEmpty(English) ||
                              !string.IsNullOrEmpty(French);
    }

    /// <summary>Codes de langue supportés.</summary>
    public static readonly string[] SupportedLanguages = ["ja", "en", "fr", "de", "es", "it"];

    /// <summary>Indique si les données ont été chargées.</summary>
    public bool IsLoaded => _isLoaded;

    /// <summary>Nombre de passifs chargés.</summary>
    public int SkillCount => _skillCache.Count;

    /// <summary>
    /// Charge les talents passifs et résout leurs textes localisés depuis un dump.
    /// </summary>
    public async Task<int> LoadFromGameDataAsync(
        string gameDataPath,
        CancellationToken cancellationToken = default)
    {
        _skillCache.Clear();

        // Étape 1 : configuration des passifs (PASSIVE_SKILL_INFO).
        var skillConfigs = await LoadPassiveSkillConfigAsync(gameDataPath, cancellationToken);

        // Étape 2 : textes localisés (skill_text NOUN_INFO) par langue.
        var localizedTexts = new Dictionary<string, Dictionary<uint, string>>();
        foreach (var lang in SupportedLanguages)
        {
            cancellationToken.ThrowIfCancellationRequested();
            localizedTexts[lang] = await LoadSkillTextAsync(gameDataPath, lang, cancellationToken);
        }

        // Étape 3 : construction du cache (jointure nameId/descId → texte).
        foreach (var config in skillConfigs)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var nameHash = (uint)Convert.ToInt32(config.NameId.Replace("0x", ""), 16);
            var descHash = (uint)Convert.ToInt32(config.DescId.Replace("0x", ""), 16);
            var passiveHash = (uint)Convert.ToInt32(config.PassiveId.Replace("0x", ""), 16);
            var effectHash = (uint)Convert.ToInt32(config.EffectId.Replace("0x", ""), 16);

            var skill = new LocalizedSkill
            {
                PassiveHash = passiveHash,
                EffectHash = effectHash,
                NameHash = nameHash,
                DescHash = descHash,
                Rarity = config.Rarity,
                Names = BuildText(localizedTexts, nameHash),
                Descriptions = BuildText(localizedTexts, descHash),
            };

            _skillCache[passiveHash] = skill;
        }

        _isLoaded = true;
        return _skillCache.Count;
    }

    /// <summary>Récupère un passif par son hash.</summary>
    public LocalizedSkill? GetSkill(uint hash) => _skillCache.GetValueOrDefault(hash);

    /// <summary>Récupère le nom d'un passif pour une langue donnée (chaîne vide si inconnu).</summary>
    public string GetSkillName(uint hash, string language = "fr")
    {
        var skill = GetSkill(hash);
        return skill?.Names.GetByCode(language) ?? string.Empty;
    }

    /// <summary>Récupère la description d'un passif pour une langue donnée.</summary>
    public string GetSkillDescription(uint hash, string language = "fr")
    {
        var skill = GetSkill(hash);
        return skill?.Descriptions.GetByCode(language) ?? string.Empty;
    }

    /// <summary>Recherche par nom (correspondance partielle, insensible à la casse).</summary>
    public IEnumerable<LocalizedSkill> SearchSkills(string query, string language = "fr")
    {
        if (string.IsNullOrWhiteSpace(query))
            return _skillCache.Values;

        return _skillCache.Values.Where(s =>
        {
            var name = s.Names.GetByCode(language);
            if (!string.IsNullOrEmpty(name) && name.Contains(query, StringComparison.OrdinalIgnoreCase))
                return true;
            if (s.PassiveHashHex.Contains(query, StringComparison.OrdinalIgnoreCase))
                return true;
            return false;
        });
    }

    /// <summary>Tous les passifs.</summary>
    public IReadOnlyCollection<LocalizedSkill> GetAllSkills() => _skillCache.Values;

    /// <summary>Exporte le cache vers un fichier JSON.</summary>
    public async Task ExportToCacheAsync(string outputPath, CancellationToken cancellationToken = default)
    {
        var data = new SkillCacheData
        {
            Version = "1.0",
            GeneratedAt = DateTime.UtcNow,
            SkillCount = _skillCache.Count,
            Skills = _skillCache.Values.ToList(),
        };

        await using var stream = File.Create(outputPath);
        await JsonSerializer.SerializeAsync(
            stream,
            data,
            SkillTextResolverJsonContext.Default.SkillCacheData,
            cancellationToken);
    }

    /// <summary>Charge le cache depuis un fichier JSON.</summary>
    public async Task<int> LoadFromCacheAsync(string cachePath, CancellationToken cancellationToken = default)
    {
        if (!File.Exists(cachePath))
            return 0;

        await using var stream = File.OpenRead(cachePath);
        var data = await JsonSerializer.DeserializeAsync(
            stream,
            SkillTextResolverJsonContext.Default.SkillCacheData,
            cancellationToken);

        if (data == null)
            return 0;

        _skillCache.Clear();
        foreach (var skill in data.Skills ?? [])
        {
            _skillCache[skill.PassiveHash] = skill;
        }

        _isLoaded = true;
        return _skillCache.Count;
    }

    #region Private Methods

    private static LocalizedText BuildText(
        Dictionary<string, Dictionary<uint, string>> texts,
        uint hash)
    {
        if (hash == 0) return new LocalizedText();
        return new LocalizedText
        {
            Japanese = texts.GetValueOrDefault("ja")?.GetValueOrDefault(hash) ?? string.Empty,
            English = texts.GetValueOrDefault("en")?.GetValueOrDefault(hash) ?? string.Empty,
            French = texts.GetValueOrDefault("fr")?.GetValueOrDefault(hash) ?? string.Empty,
            German = texts.GetValueOrDefault("de")?.GetValueOrDefault(hash) ?? string.Empty,
            Spanish = texts.GetValueOrDefault("es")?.GetValueOrDefault(hash) ?? string.Empty,
            Italian = texts.GetValueOrDefault("it")?.GetValueOrDefault(hash) ?? string.Empty,
        };
    }

    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CFG.BIN parsing uses reflection.")]
    private static async Task<List<PassiveSkillConfig>> LoadPassiveSkillConfigAsync(
        string basePath,
        CancellationToken cancellationToken)
    {
        var result = new List<PassiveSkillConfig>();
        var configPath = Path.Combine(basePath, "common", "gamedata", "skill");
        if (!Directory.Exists(configPath))
            configPath = Path.Combine(basePath, "data", "common", "gamedata", "skill");
        if (!Directory.Exists(configPath))
            return result;

        var cfgBinFiles = Directory.GetFiles(configPath, "passive_skill_config*.cfg.bin");
        foreach (var file in cfgBinFiles)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var cfgBin = await LoadCfgBinAsync(file, cancellationToken);
            if (cfgBin == null) continue;

            // PASSIVE_SKILL_INFO_* (hors _LIST_ et _REF_), conforme à inagle.
            var entries = FindEntries(cfgBin, e =>
                e.Name.StartsWith("PASSIVE_SKILL_INFO_", StringComparison.Ordinal) &&
                !e.Name.Contains("_LIST_") &&
                !e.Name.Contains("_REF_"));

            foreach (var entry in entries)
            {
                if (entry.Variables.Count >= 5)
                {
                    result.Add(new PassiveSkillConfig(entry));
                }
            }
        }

        return result;
    }

    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CFG.BIN parsing uses reflection.")]
    private static async Task<Dictionary<uint, string>> LoadSkillTextAsync(
        string basePath,
        string language,
        CancellationToken cancellationToken)
    {
        var result = new Dictionary<uint, string>();
        var textPath = Path.Combine(basePath, "common", "text", language);
        if (!Directory.Exists(textPath))
            textPath = Path.Combine(basePath, "data", "common", "text", language);
        if (!Directory.Exists(textPath))
            return result;

        var file = Path.Combine(textPath, "skill_text.cfg.bin");
        if (!File.Exists(file)) return result;

        cancellationToken.ThrowIfCancellationRequested();

        var cfgBin = await LoadCfgBinAsync(file, cancellationToken);
        if (cfgBin == null) return result;

        // NOUN_INFO_* : [0] hash, [5] texte localisé.
        var entries = FindEntries(cfgBin, e =>
            e.Name.StartsWith("NOUN_INFO_", StringComparison.Ordinal) &&
            !e.Name.Contains("BEGIN") &&
            !e.Name.Contains("LIST"));

        foreach (var entry in entries)
        {
            var info = new NounInfo(entry);
            if (!string.IsNullOrEmpty(info.Name))
            {
                result.TryAdd((uint)info.Crc32, info.Name);
            }
        }

        return result;
    }

    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CFG.BIN parsing uses reflection.")]
    private static async Task<CfgBin?> LoadCfgBinAsync(string path, CancellationToken cancellationToken)
    {
        if (!File.Exists(path))
            return null;

        var data = await File.ReadAllBytesAsync(path, cancellationToken);

        if (!CfgBin.HasValidFooter(data))
        {
            data = CriwareCrypt.Decrypt(data, Path.GetFileName(path));
        }

        var cfgBin = new CfgBin();
        cfgBin.Open(data);
        return cfgBin;
    }

    private static List<Entry> FindEntries(CfgBin cfgBin, Func<Entry, bool> predicate)
    {
        var items = new List<Entry>();
        foreach (var entry in cfgBin.Entries)
        {
            FindEntriesRecursive(entry, predicate, items);
        }
        return items;
    }

    private static void FindEntriesRecursive(Entry entry, Func<Entry, bool> predicate, List<Entry> items)
    {
        if (predicate(entry))
        {
            items.Add(entry);
        }

        foreach (var child in entry.Children)
        {
            FindEntriesRecursive(child, predicate, items);
        }
    }

    #endregion

    public void Dispose()
    {
        _skillCache.Clear();
        _isLoaded = false;
    }
}

/// <summary>
/// Structure de cache pour la sérialisation.
/// </summary>
public sealed record SkillCacheData
{
    public string Version { get; init; } = "1.0";
    public DateTime GeneratedAt { get; init; }
    public int SkillCount { get; init; }
    public List<SkillTextResolver.LocalizedSkill>? Skills { get; init; }
}

/// <summary>
/// Contexte de sérialisation JSON (compatible Native AOT).
/// </summary>
[JsonSerializable(typeof(SkillCacheData))]
[JsonSerializable(typeof(SkillTextResolver.LocalizedSkill))]
[JsonSerializable(typeof(SkillTextResolver.LocalizedText))]
[JsonSerializable(typeof(List<SkillTextResolver.LocalizedSkill>))]
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
public partial class SkillTextResolverJsonContext : JsonSerializerContext
{
}
