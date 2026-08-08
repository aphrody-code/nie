using System.Text.Json;

namespace IECODE.Core.Scripting.Lua;

/// <summary>
/// Table sémantique des commandes <c>funcLua*</c> reversées depuis nie.exe
/// (<c>re/lua/funclua-cmdids.json</c>).
///
/// IMPORTANT : <c>cmdId = CRC32(nom C++ interne)</c> mais le forward-lookup n'est pas confirmé —
/// les noms sont <b>inférés</b> des patterns d'arguments. On ne les injecte donc PAS dans le dico
/// CRC (<see cref="Util.Level5HashDictionary"/>, qui mappe hash→préimage réel) ; cette table est une
/// couche sémantique séparée : <c>cmdId → nom inféré</c> par famille de dispatch.
/// </summary>
public sealed class FuncLuaCommands
{
    private readonly Dictionary<string, Dictionary<uint, string>> _byFamily;

    private FuncLuaCommands(Dictionary<string, Dictionary<uint, string>> byFamily)
        => _byFamily = byFamily;

    /// <summary>Nom inféré d'une commande <c>funcLuaMenuCommand</c>, ou null si non reversée.</summary>
    public string? MenuCommandName(uint cmdId) => Name("funcLuaMenuCommand", cmdId);

    /// <summary>Nom inféré dans une famille de dispatch donnée, ou null.</summary>
    public string? Name(string family, uint cmdId)
        => _byFamily.TryGetValue(family, out var m) && m.TryGetValue(cmdId, out var n) ? n : null;

    /// <summary>Nombre de commandes reversées dans une famille.</summary>
    public int Count(string family)
        => _byFamily.TryGetValue(family, out var m) ? m.Count : 0;

    /// <summary>
    /// Charge <c>funclua-cmdids.json</c>. Retourne une table vide si le fichier est absent
    /// (le host retombe alors sur la trace brute).
    /// </summary>
    public static FuncLuaCommands Load(string jsonPath)
    {
        var byFamily = new Dictionary<string, Dictionary<uint, string>>(StringComparer.Ordinal);
        if (!File.Exists(jsonPath)) return new FuncLuaCommands(byFamily);

        using var doc = JsonDocument.Parse(File.ReadAllText(jsonPath));
        foreach (var famProp in doc.RootElement.EnumerateObject())
        {
            if (famProp.Name == "_meta" || famProp.Value.ValueKind != JsonValueKind.Object) continue;
            if (!famProp.Value.TryGetProperty("commands", out var cmds) ||
                cmds.ValueKind != JsonValueKind.Object)
                continue;

            var map = new Dictionary<uint, string>();
            foreach (var cmd in cmds.EnumerateObject())
            {
                // Clé hex "0x2A64B198".
                if (!TryParseHash(cmd.Name, out uint hash)) continue;
                string? name = cmd.Value.TryGetProperty("inferred_name", out var n)
                    ? n.GetString()
                    : null;
                if (!string.IsNullOrEmpty(name)) map[hash] = name!;
            }
            byFamily[famProp.Name] = map;
        }
        return new FuncLuaCommands(byFamily);
    }

    /// <summary>
    /// Cherche <c>re/lua/funclua-cmdids.json</c> en remontant depuis le répertoire courant.
    /// </summary>
    public static FuncLuaCommands LoadDefault()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            string candidate = Path.Combine(dir.FullName, "re", "lua", "funclua-cmdids.json");
            if (File.Exists(candidate)) return Load(candidate);
            dir = dir.Parent;
        }
        return new FuncLuaCommands(new());
    }

    private static bool TryParseHash(string s, out uint hash)
    {
        s = s.Trim();
        if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            return uint.TryParse(s.AsSpan(2), System.Globalization.NumberStyles.HexNumber, null, out hash);
        return uint.TryParse(s, out hash);
    }
}
