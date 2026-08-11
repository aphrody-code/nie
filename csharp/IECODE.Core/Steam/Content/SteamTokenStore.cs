using System.Text.Json;
using System.Text.Json.Serialization;

namespace IECODE.Core.Steam.Content;

/// <summary>
/// Jetons persistés par compte : refresh token (re-login sans mot de passe) et
/// guard data (machine "remembered", évite de redemander le 2FA). Stocké en JSON.
/// Équivalent de la session cachée de steamcmd, dont dépend l'automatisation iecode.
/// </summary>
internal sealed class SteamAccountTokens
{
    [JsonPropertyName("refreshToken")] public string? RefreshToken { get; set; }
    [JsonPropertyName("guardData")] public string? GuardData { get; set; }
}

[JsonSourceGenerationOptions(WriteIndented = true)]
[JsonSerializable(typeof(Dictionary<string, SteamAccountTokens>))]
internal sealed partial class SteamTokenStoreContext : JsonSerializerContext;

/// <summary>
/// Charge/sauvegarde <see cref="SteamAccountTokens"/> dans un fichier JSON (clé = nom de compte).
/// Thread-safe pour les écritures concurrentes (un seul writer par run en pratique).
/// </summary>
internal sealed class SteamTokenStore
{
    private readonly string? _path;
    private readonly Dictionary<string, SteamAccountTokens> _byAccount;
    private readonly Lock _lock = new();

    private SteamTokenStore(string? path, Dictionary<string, SteamAccountTokens> byAccount)
    {
        _path = path;
        _byAccount = byAccount;
    }

    public static SteamTokenStore Load(string? path)
    {
        if (string.IsNullOrEmpty(path) || !File.Exists(path))
        {
            return new SteamTokenStore(path, new(StringComparer.OrdinalIgnoreCase));
        }

        try
        {
            var json = File.ReadAllText(path);
            var data = JsonSerializer.Deserialize(json, SteamTokenStoreContext.Default.DictionaryStringSteamAccountTokens);
            return new SteamTokenStore(path, new(data ?? [], StringComparer.OrdinalIgnoreCase));
        }
        catch
        {
            return new SteamTokenStore(path, new(StringComparer.OrdinalIgnoreCase));
        }
    }

    public SteamAccountTokens Get(string account)
    {
        lock (_lock)
        {
            return _byAccount.TryGetValue(account, out var t) ? t : new SteamAccountTokens();
        }
    }

    public void Set(string account, string? refreshToken, string? guardData)
    {
        if (_path is null) return;

        lock (_lock)
        {
            if (!_byAccount.TryGetValue(account, out var t))
            {
                t = new SteamAccountTokens();
                _byAccount[account] = t;
            }
            if (refreshToken != null) t.RefreshToken = refreshToken;
            if (guardData != null) t.GuardData = guardData;
            Save();
        }
    }

    private void Save()
    {
        if (_path is null) return;
        try
        {
            var dir = Path.GetDirectoryName(Path.GetFullPath(_path));
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            var json = JsonSerializer.Serialize(_byAccount, SteamTokenStoreContext.Default.DictionaryStringSteamAccountTokens);
            File.WriteAllText(_path, json);
        }
        catch
        {
            // best-effort : l'échec de persistance ne doit pas casser le download
        }
    }
}
