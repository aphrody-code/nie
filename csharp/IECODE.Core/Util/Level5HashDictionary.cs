using System.Text.Json;

namespace IECODE.Core.Util;

/// <summary>
/// Dictionnaire hash→nom pour les identifiants LEVEL-5 (cfg.bin / objbin / RDBN).
///
/// Construit depuis <c>re/menu/hash-dictionary.json</c> (généré par
/// <see cref="Level5HashDictionaryBuilder"/>).
/// Permet de résoudre un hash 32-bit en son nom d'origine (nom de champ cfg.bin,
/// composant objbin, clé texte MenuTextSetting, nom d'objet Lua, etc.).
/// </summary>
public sealed class Level5HashDictionary
{
    private readonly Dictionary<uint, string> _entries;

    /// <summary>Nombre d'entrées dans le dictionnaire.</summary>
    public int Count => _entries.Count;

    private Level5HashDictionary(Dictionary<uint, string> entries)
    {
        _entries = entries;
    }

    /// <summary>
    /// Charge le dictionnaire depuis un fichier JSON produit par
    /// <see cref="Level5HashDictionaryBuilder.Build"/>.
    /// </summary>
    public static Level5HashDictionary Load(string jsonPath)
    {
        var json = File.ReadAllText(jsonPath);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        // Support both flat {"0xXXXXXXXX": "name"} and {"entries": {...}} formats
        var entriesEl = root.ValueKind == JsonValueKind.Object &&
                        root.TryGetProperty("entries", out var e)
            ? e
            : root;

        var dict = new Dictionary<uint, string>();
        foreach (var prop in entriesEl.EnumerateObject())
        {
            if (Level5Hash.TryParseHex(prop.Name, out uint hash))
            {
                var name = prop.Value.GetString();
                if (name is not null)
                    dict[hash] = name;
            }
        }

        return new Level5HashDictionary(dict);
    }

    /// <summary>
    /// Tente de résoudre un hash en son nom d'origine.
    /// </summary>
    public bool TryResolve(uint hash, out string name)
        => _entries.TryGetValue(hash, out name!);

    /// <summary>
    /// Résout un hash, ou retourne <c>null</c> si inconnu.
    /// </summary>
    public string? Resolve(uint hash)
        => _entries.TryGetValue(hash, out var name) ? name : null;

    /// <summary>
    /// Résout un hash, ou retourne la représentation hex si inconnu.
    /// </summary>
    public string ResolveOrHex(uint hash)
        => _entries.TryGetValue(hash, out var name) ? name : $"UNKNOWN_{hash:X8}";

    /// <summary>
    /// Toutes les entrées (hash → nom).
    /// </summary>
    public IReadOnlyDictionary<uint, string> Entries => _entries;
}

/// <summary>
/// Construit un dictionnaire hash→nom depuis les fichiers cfg.bin et objbin du jeu.
///
/// Sources exploitées :
///   1. Tables de clés cfg.bin/objbin (paires (uint crc32, string name) stockées
///      en clair dans le fichier, vérifiées par CRC32(name) == crc32).
///   2. Hashes calculés des valeurs de la string table des fichiers objbin du dossier
///      menu (noms de composants, clés texte, noms d'objets UI).
/// </summary>
public static class Level5HashDictionaryBuilder
{
    private const int FooterByte0 = 0x01;
    private const int FooterByte1 = 0x74;
    private const int FooterByte2 = 0x32;
    private const int FooterByte3 = 0x62;

    /// <summary>
    /// Parcourt <paramref name="dataRoot"/> récursivement, extrait toutes les paires
    /// hash→nom des fichiers *.cfg.bin et *.objbin, et retourne le dictionnaire.
    /// </summary>
    public static Dictionary<uint, string> Build(string dataRoot)
    {
        var dict = new Dictionary<uint, string>();

        foreach (var file in Directory.EnumerateFiles(dataRoot, "*.cfg.bin", SearchOption.AllDirectories))
            ExtractKeyTable(file, dict);

        foreach (var file in Directory.EnumerateFiles(dataRoot, "*.objbin", SearchOption.AllDirectories))
            ExtractKeyTable(file, dict);

        return dict;
    }

    /// <summary>
    /// Extrait les paires hash→nom depuis la table de clés d'un fichier cfg.bin ou objbin.
    /// Toutes les paires retournées sont VÉRIFIÉES : Level5Hash.Hash(name) == storedHash.
    /// </summary>
    public static void ExtractKeyTable(string filePath, Dictionary<uint, string> dict)
    {
        try
        {
            var data = File.ReadAllBytes(filePath);
            if (!HasValidFooter(data))
                return;

            if (data.Length < 0x10)
                return;

            var entries_count = ReadInt32(data, 0);
            var strTableOff = ReadInt32(data, 4);
            var strTableLen = ReadInt32(data, 8);

            if (strTableOff <= 0 || strTableOff >= data.Length)
                return;

            long keyTableOff = RoundUp((long)strTableOff + strTableLen, 16);
            if (keyTableOff >= data.Length - 4)
                return;

            // KeyHeader: KeyLength(int), KeyCount(int), KeyStringOffset(int), KeyStringLength(int)
            var keyLen = ReadInt32(data, (int)keyTableOff);
            var keyCount = ReadInt32(data, (int)keyTableOff + 4);
            var keyStrOff = ReadInt32(data, (int)keyTableOff + 8);

            if (keyCount <= 0 || keyCount > 10_000)
                return;

            int entriesStart = (int)keyTableOff + 0x10;
            int keyStrBlobStart = (int)keyTableOff + keyStrOff;

            if (keyStrBlobStart >= data.Length)
                return;

            for (int i = 0; i < keyCount; i++)
            {
                int pos = entriesStart + i * 8;
                if (pos + 8 > data.Length)
                    break;

                uint crcVal = ReadUInt32(data, pos);
                int strOff = ReadInt32(data, pos + 4);
                int namePos = keyStrBlobStart + strOff;

                if (namePos >= data.Length)
                    continue;

                int nameEnd = Array.IndexOf(data, (byte)0, namePos);
                if (nameEnd < 0)
                    nameEnd = Math.Min(namePos + 100, data.Length);

                var name = System.Text.Encoding.UTF8.GetString(data, namePos, nameEnd - namePos);

                // Verify: only add if CRC32(name) matches stored hash
                if (Level5Hash.Hash(name) == crcVal)
                    dict[crcVal] = name;
            }
        }
        catch
        {
            // Skip unreadable or malformed files
        }
    }

    private static bool HasValidFooter(byte[] data)
    {
        int searchStart = Math.Max(0, data.Length - 32);
        for (int i = searchStart; i < data.Length - 3; i++)
        {
            if (data[i] == FooterByte0 && data[i + 1] == FooterByte1 &&
                data[i + 2] == FooterByte2 && data[i + 3] == FooterByte3)
                return true;
        }
        return false;
    }

    private static int ReadInt32(byte[] data, int offset)
        => data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);

    private static uint ReadUInt32(byte[] data, int offset)
        => (uint)(data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24));

    private static long RoundUp(long n, int exp)
        => ((n + exp - 1) / exp) * exp;
}
