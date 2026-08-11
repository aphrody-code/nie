using IECODE.Core.Formats.Level5.CfgBin.Encryption;
using IECODE.Core.Formats.Level5.CfgBin;
using IECODE.Core.Formats.Level5.CfgBin.Logic;

namespace IECODE.Core.GameData;

public class GameDataMapper
{
    private readonly string _dumpPath;
    private readonly string _language;

    public GameDataMapper(string dumpPath, string language = "fr")
    {
        _dumpPath = dumpPath;
        _language = language;
    }

    public List<T> LoadEntries<T>(string relativePath, string entryPrefix, Func<Entry, T> factory, string? filePattern = null) where T : GameDataEntry
    {
        var cfgBin = LoadCfgBin(relativePath, filePattern);
        if (cfgBin == null)
        {
            Console.WriteLine($"[DEBUG] CfgBin is null for {relativePath}");
            return new List<T>();
        }

        Console.WriteLine($"[DEBUG] Loaded CfgBin with {cfgBin.Entries.Count} root entries");
        foreach (var entry in cfgBin.Entries)
        {
            Console.WriteLine($"  - Root Entry: {entry.Name}");
        }

        var results = new List<T>();
        var entries = FindEntriesByPrefix(cfgBin, entryPrefix);

        Console.WriteLine($"[DEBUG] Found {entries.Count} entries with prefix {entryPrefix}");

        foreach (var entry in entries)
        {
            var instance = factory(entry);
            if (instance != null)
            {
                results.Add(instance);
            }
        }

        return results;
    }

    /// <summary>
    /// Parmi <paramref name="files"/>, retient ceux dont le nom est « &lt;base&gt;_&lt;version&gt;.cfg.bin[.json] »
    /// (où base = <paramref name="filePattern"/> sans le « * » final) et renvoie la version la plus
    /// haute (tri numérique des segments X.Y.Z.W). Renvoie null si aucun match versionné — ce qui
    /// écarte les collisions de préfixe (« chara_param » vs « chara_param_table_config »).
    /// </summary>
    private static string? SelectVersionedFile(string[] files, string? filePattern)
    {
        if (files.Length == 0 || string.IsNullOrEmpty(filePattern)) return null;
        // Base = portion AVANT le premier « * » (gère « chara_param*.cfg.bin », « chara_param* »…).
        int star = filePattern.IndexOf('*');
        var bas = Path.GetFileName(star >= 0 ? filePattern[..star] : filePattern);
        if (string.IsNullOrEmpty(bas)) return null;

        var rx = new System.Text.RegularExpressions.Regex(
            "^" + System.Text.RegularExpressions.Regex.Escape(bas) + @"_(\d+(?:\.\d+)*)\.cfg\.bin(?:\.json)?$",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);

        string? best = null;
        int[]? bestVer = null;
        bool bestJson = false;
        foreach (var f in files)
        {
            var m = rx.Match(Path.GetFileName(f));
            if (!m.Success) continue;
            var ver = m.Groups[1].Value.Split('.').Select(s => int.TryParse(s, out var n) ? n : 0).ToArray();
            bool isJson = f.EndsWith(".json", StringComparison.OrdinalIgnoreCase);
            int cmp = bestVer is null ? 1 : CompareVersion(ver, bestVer);
            // Version la plus haute ; à version égale, préférer la forme parsée .cfg.bin.json
            // (le binaire .cfg.bin brut de ce dump échoue au parseur — « footer magic »).
            if (cmp > 0 || (cmp == 0 && isJson && !bestJson)) { best = f; bestVer = ver; bestJson = isJson; }
        }
        return best;
    }

    private static int CompareVersion(int[] a, int[] b)
    {
        int n = Math.Max(a.Length, b.Length);
        for (int i = 0; i < n; i++)
        {
            int av = i < a.Length ? a[i] : 0, bv = i < b.Length ? b[i] : 0;
            if (av != bv) return av.CompareTo(bv);
        }
        return 0;
    }

    private CfgBin? LoadCfgBin(string relativePath, string? filePattern = null)
    {
        // Normalise les séparateurs Windows (« \ ») des chemins relatifs codés en dur
        // (ex. « data\common\gamedata\character ») pour rester portable hors Windows.
        relativePath = relativePath.Replace('\\', Path.DirectorySeparatorChar);
        string fullPath = Path.Combine(_dumpPath, relativePath);

        if (!File.Exists(fullPath))
        {
            if (Directory.Exists(fullPath))
            {
                var pattern = filePattern ?? "*.cfg.bin";
                // Inclut le binaire .cfg.bin ET la forme parsée .cfg.bin.json (ce dump ne
                // contient que les .json ; le binaire brut échoue au parseur de footer).
                var files = Directory.GetFiles(fullPath, pattern)
                    .Concat(Directory.GetFiles(fullPath, pattern + ".json"))
                    .ToArray();

                // Sélectionne le fichier versionné correct (ex. « chara_param_1.03.66.00 ») :
                // évite la collision de préfixe (« chara_param » matchait aussi le plus long
                // « chara_param_table_config_* ») et prend la version la plus haute.
                // Repli sur le plus long si aucun match versionné (motifs non versionnés).
                fullPath = SelectVersionedFile(files, filePattern)
                    ?? files.OrderByDescending(f => f.Length).FirstOrDefault() ?? "";
            }
            else
            {
                // Try adding .cfg.bin
                if (File.Exists(fullPath + ".cfg.bin")) fullPath += ".cfg.bin";
                else if (File.Exists(fullPath + ".cfg.bin.json")) fullPath += ".cfg.bin.json";
            }
        }

        if (!File.Exists(fullPath)) return null;

        var cfgBin = new CfgBin();
        if (fullPath.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
        {
            cfgBin.ImportJson(fullPath);
        }
        else
        {
            byte[] data = File.ReadAllBytes(fullPath);
            if (!CfgBin.HasValidFooter(data))
            {
                data = CriwareCrypt.Decrypt(data, Path.GetFileName(fullPath));
            }

#pragma warning disable IL2026
            cfgBin.Open(data);
#pragma warning restore IL2026
        }

        return cfgBin;
    }

    private List<Entry> FindEntriesByPrefix(CfgBin cfgBin, string prefix)
    {
        var items = new List<Entry>();
        foreach (var entry in cfgBin.Entries)
        {
            FindEntriesRecursive(entry, prefix, items);
        }
        return items;
    }

    private void FindEntriesRecursive(Entry entry, string prefix, List<Entry> items)
    {
        // On exclut les nœuds de structure (_LIST_, _REF_, _BEG/BEGIN), comme tous les
        // parsers inagle : ces nœuds partagent le préfixe mais ne portent pas de données
        // d'entrée (ex. AURA_CMD_INFO_REF_*, PASSIVE_SKILL_INFO_LIST_BEG_*, NOUN_INFO_BEGIN_*).
        if (entry.Name.StartsWith(prefix, StringComparison.Ordinal) &&
            !entry.Name.Contains("_LIST_") &&
            !entry.Name.Contains("_REF_") &&
            !entry.Name.Contains("_BEG") &&
            !entry.Name.Contains("BEGIN"))
        {
            items.Add(entry);
        }

        foreach (var child in entry.Children)
        {
            FindEntriesRecursive(child, prefix, items);
        }
    }
}
