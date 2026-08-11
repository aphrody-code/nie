namespace IECODE.Core.Steam.Content;

/// <summary>
/// Type de second facteur Steam Guard demandé pendant l'authentification.
/// </summary>
public enum SteamGuardKind
{
    /// <summary>Code à 5 caractères de l'application mobile Steam (authenticator).</summary>
    Device,

    /// <summary>Code envoyé par e-mail.</summary>
    Email,
}

/// <summary>
/// Fournit les codes Steam Guard lors d'un login interactif/automatisé.
/// Implémenté côté appelant (CLI : console/env ; Bun : callback JS).
/// </summary>
public interface ISteamGuardProvider
{
    /// <param name="kind">Device (app mobile) ou Email.</param>
    /// <param name="email">Adresse e-mail masquée (si <see cref="SteamGuardKind.Email"/>).</param>
    /// <param name="previousIncorrect">true si le code précédent a été rejeté.</param>
    Task<string> GetCodeAsync(SteamGuardKind kind, string? email, bool previousIncorrect, CancellationToken ct);
}

/// <summary>
/// Adaptateur <see cref="ISteamGuardProvider"/> à partir d'un délégué
/// (pratique pour le pont Bun ou un test).
/// </summary>
public sealed class DelegateSteamGuardProvider(
    Func<SteamGuardKind, string?, bool, CancellationToken, Task<string>> getCode) : ISteamGuardProvider
{
    public Task<string> GetCodeAsync(SteamGuardKind kind, string? email, bool previousIncorrect, CancellationToken ct)
        => getCode(kind, email, previousIncorrect, ct);
}

/// <summary>
/// Options du téléchargement natif d'une app Steam (depots → disque), au format
/// d'install Steam (<c>InstallDir/&lt;chemin manifest&gt;</c>, ex. <c>data/packs/*.cpk</c>).
/// </summary>
public sealed class SteamDownloadOptions
{
    /// <summary>App ID Steam (ex. 2799860 pour IEVR).</summary>
    public required uint AppId { get; init; }

    /// <summary>Répertoire d'installation cible (sera créé). Reçoit l'arborescence du jeu.</summary>
    public required string InstallDir { get; init; }

    /// <summary>Compte Steam possédant l'app. <c>null</c> ⇒ login anonyme (jeux gratuits only).</summary>
    public string? Username { get; init; }

    /// <summary>Mot de passe. Ignoré si un refresh token est en cache pour ce compte.</summary>
    public string? Password { get; init; }

    /// <summary>Branche (défaut <c>public</c>).</summary>
    public string Branch { get; init; } = "public";

    /// <summary>Mot de passe de branche bêta (optionnel).</summary>
    public string? BetaPassword { get; init; }

    /// <summary>OS ciblé pour le filtrage des depots (<c>windows</c>/<c>macos</c>/<c>linux</c>). Défaut : windows.</summary>
    public string Os { get; init; } = "windows";

    /// <summary>Architecture ciblée (<c>64</c>/<c>32</c>). <c>null</c> ⇒ pas de filtre arch.</summary>
    public string? Arch { get; init; }

    /// <summary>Langue ciblée pour les depots localisés (défaut <c>english</c>).</summary>
    public string Language { get; init; } = "english";

    /// <summary>Ne pas filtrer par OS/arch/langue : télécharge tous les depots.</summary>
    public bool AllPlatforms { get; init; }

    /// <summary>Restreint à ces depot IDs (vide ⇒ tous les depots éligibles de l'app).</summary>
    public IReadOnlyList<uint> DepotIds { get; init; } = [];

    /// <summary>Nombre de chunks téléchargés en parallèle (défaut : <see cref="Runtime.HostProfile.Parallelism"/>, ajusté à la charge du VPS).</summary>
    public int MaxDownloads { get; init; } = Runtime.HostProfile.Parallelism;

    /// <summary>
    /// Fichier JSON de cache des jetons (refresh token + guard data) par compte.
    /// Permet aux runs suivants d'être non-interactifs (équivalent de la session cachée steamcmd).
    /// <c>null</c> ⇒ pas de persistance (2FA redemandé à chaque run).
    /// </summary>
    public string? TokenStorePath { get; init; }

    /// <summary>Fournisseur de codes Steam Guard (2FA). <c>null</c> ⇒ aucun (échoue si 2FA requis).</summary>
    public ISteamGuardProvider? GuardProvider { get; init; }
}

/// <summary>Phase courante du téléchargement.</summary>
public enum SteamDownloadPhase
{
    Connecting,
    LoggingIn,
    FetchingAppInfo,
    FetchingManifests,
    Downloading,
    Completed,
    Error,
}

/// <summary>Progression du téléchargement (poussée via <see cref="IProgress{T}"/>).</summary>
public readonly record struct SteamDownloadProgress(
    SteamDownloadPhase Phase,
    string Message,
    long DownloadedBytes,
    long TotalBytes)
{
    public double PercentComplete => TotalBytes > 0 ? DownloadedBytes * 100.0 / TotalBytes : 0;
}

/// <summary>Résumé d'un depot (mode inspection <c>ListDepotsAsync</c>).</summary>
public sealed class SteamDepotInfo
{
    public uint DepotId { get; init; }
    public ulong ManifestId { get; init; }
    public string? Name { get; init; }
    public int FileCount { get; init; }
    public long TotalBytes { get; init; }
}

/// <summary>Résultat agrégé d'un téléchargement d'app.</summary>
public sealed class SteamDownloadResult
{
    public bool Success { get; init; }
    public string? Error { get; init; }
    public uint AppId { get; init; }
    public string InstallDir { get; init; } = "";
    public IReadOnlyList<uint> Depots { get; init; } = [];
    public long DownloadedBytes { get; init; }
    public int FileCount { get; init; }
    public TimeSpan Duration { get; init; }
}
