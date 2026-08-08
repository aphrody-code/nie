using IECODE.Core.Formats.Level5.CfgBin.Encryption;
using IECODE.Core.Formats.Level5.CfgBin;
using IECODE.Core.Formats.Level5.CfgBin.Logic;

namespace IECODE.Core.GameData;

/// <summary>
/// Pipeline for reading and searching character data from cfg.bin files.
/// Uses GameDataMapper and typed models.
/// </summary>
public class CharacterDataPipeline
{
    private static readonly string[] DumpPaths =
    [
        @"C:\iecode\dump",
        @"C:\iecode"
    ];

    private static readonly string CharaBasePath = @"data\common\gamedata\character";
    private static readonly string CharaTextPath = @"data\common\text";

    private GameDataMapper? _mapper;
    private List<CharacterBaseInfo>? _baseInfos;
    private List<NounInfo>? _nounInfos;
    private string? _language;

    public bool IsLoaded => _baseInfos != null && _nounInfos != null;
    public string? Language => _language;

    /// <summary>
    /// Load character data from cfg.bin files.
    /// </summary>
    /// <param name="dumpPath">Path to dump folder (optional, auto-detects)</param>
    /// <param name="language">Language code (fr, de, en, ja, etc.)</param>
    public void Load(string? dumpPath = null, string language = "fr")
    {
        _language = language;
        string basePath = ResolveDumpPath(dumpPath);
        _mapper = new GameDataMapper(basePath, language);

        // Load chara_base*.cfg.bin
        // We search for CHARA_BASE_INFO entries
        _baseInfos = _mapper.LoadEntries<CharacterBaseInfo>(
            CharaBasePath,
            "CHARA_BASE_INFO",
            e => new CharacterBaseInfo(e));

        if (_baseInfos.Count == 0)
            throw new FileNotFoundException("No character base info found in chara_base*.cfg.bin");

        // Load chara_text.cfg.bin for the specified language
        // We search for NOUN_INFO entries
        string textPath = Path.Combine(CharaTextPath, language);
        _nounInfos = _mapper.LoadEntries<NounInfo>(
            textPath,
            "NOUN_INFO",
            e => new NounInfo(e));

        if (_nounInfos.Count == 0)
            throw new FileNotFoundException($"No noun info found in chara_text.cfg.bin for language: {language}");
    }

    /// <summary>
    /// Search for characters by name or CRC32.
    /// </summary>
    public List<CharacterSearchResult> Search(string query)
    {
        if (!IsLoaded || _nounInfos == null || _baseInfos == null)
            throw new InvalidOperationException("Data not loaded. Call Load() first.");

        var results = new List<CharacterSearchResult>();

        foreach (var noun in _nounInfos)
        {
            bool match = false;
            if (!string.IsNullOrEmpty(noun.Name) && noun.Name.Contains(query, StringComparison.OrdinalIgnoreCase))
                match = true;
            if (noun.Crc32.ToString() == query)
                match = true;
            if (((uint)noun.Crc32).ToString("X").Equals(query.Replace("0x", ""), StringComparison.OrdinalIgnoreCase))
                match = true;

            if (match)
            {
                var result = new CharacterSearchResult
                {
                    Crc32 = noun.Crc32,
                    Name = noun.Name,
                    TextEntry = noun.OriginalEntry
                };

                // Try to find matching base info
                var baseInfo = _baseInfos.FirstOrDefault(b => b.NameId == noun.Crc32);
                if (baseInfo != null)
                {
                    result.BaseEntry = baseInfo.OriginalEntry;
                    result.ModelId = baseInfo.InternalCode;
                }

                results.Add(result);
            }
        }

        return results;
    }

    /// <summary>
    /// Get all characters.
    /// </summary>
    public List<CharacterSearchResult> GetAllCharacters()
    {
        if (!IsLoaded || _nounInfos == null || _baseInfos == null)
            throw new InvalidOperationException("Data not loaded. Call Load() first.");

        var results = new List<CharacterSearchResult>();

        foreach (var noun in _nounInfos)
        {
            if (string.IsNullOrEmpty(noun.Name)) continue;

            var result = new CharacterSearchResult
            {
                Crc32 = noun.Crc32,
                Name = noun.Name,
                TextEntry = noun.OriginalEntry
            };

            var baseInfo = _baseInfos.FirstOrDefault(b => b.NameId == noun.Crc32);
            if (baseInfo != null)
            {
                result.BaseEntry = baseInfo.OriginalEntry;
                result.ModelId = baseInfo.InternalCode;
            }

            results.Add(result);
        }

        return results;
    }

    private static string ResolveDumpPath(string? userPath)
    {
        if (!string.IsNullOrEmpty(userPath) && Directory.Exists(userPath))
            return userPath;

        foreach (var path in DumpPaths)
        {
            if (Directory.Exists(Path.Combine(path, "data")))
                return path;
        }

        throw new DirectoryNotFoundException("Dump folder not found. Specify path with --dump option.");
    }
}

public class CharacterSearchResult
{
    public int Crc32 { get; set; }
    public string Name { get; set; } = "";
    public string? ModelId { get; set; }
    public Entry? TextEntry { get; set; }
    public Entry? BaseEntry { get; set; }

    public string Crc32Hex => ((uint)Crc32).ToString("X8");
}
