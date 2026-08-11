using SteamKit2;

namespace IECODE.Core.Steam.Content;

/// <summary>
/// Logique pure de résolution des depots à partir de la section <c>depots</c> de
/// l'app info Steam (KeyValue). Sans I/O — testable unitairement.
/// </summary>
public static class SteamDepotResolver
{
    /// <summary>Manifest absent / introuvable.</summary>
    public const ulong InvalidManifest = 0;

    /// <summary>
    /// Sélectionne les depot IDs éligibles. Si <paramref name="explicitDepots"/> est
    /// non vide, le renvoie tel quel (dédupliqué). Sinon parcourt la section et filtre
    /// par OS/arch/langue/lowviolence (sauf <paramref name="allPlatforms"/>).
    /// </summary>
    public static List<uint> SelectDepotIds(
        KeyValue depots,
        IReadOnlyList<uint> explicitDepots,
        bool allPlatforms,
        string os,
        string? arch,
        string language)
    {
        if (explicitDepots.Count > 0)
        {
            return explicitDepots.Distinct().ToList();
        }

        var found = new List<uint>();
        foreach (var depot in depots.Children)
        {
            if (depot.Children.Count == 0) continue;
            if (!uint.TryParse(depot.Name, out var id)) continue;

            if (!allPlatforms && !IsDepotEligible(depot, os, arch, language)) continue;

            found.Add(id);
        }
        return found;
    }

    /// <summary>Teste l'éligibilité d'un depot vis-à-vis des filtres OS/arch/langue/lowviolence.</summary>
    public static bool IsDepotEligible(KeyValue depot, string os, string? arch, string language)
    {
        var config = depot["config"];
        if (config == KeyValue.Invalid) return true;

        var oslist = config["oslist"].Value;
        if (!string.IsNullOrWhiteSpace(oslist) && Array.IndexOf(oslist.Split(','), os) == -1)
            return false;

        var osarch = config["osarch"].Value;
        if (arch != null && !string.IsNullOrWhiteSpace(osarch) && osarch != arch)
            return false;

        var lang = config["language"].Value;
        if (!string.IsNullOrWhiteSpace(lang) && lang != language)
            return false;

        if (config["lowviolence"] != KeyValue.Invalid && config["lowviolence"].AsBoolean())
            return false;

        return true;
    }

    /// <summary>
    /// Lit le GID du manifest d'un depot pour une branche. Renvoie <see cref="InvalidManifest"/>
    /// si absent. Ne gère PAS la proxy <c>depotfromapp</c> (résolue à part, requiert l'app info distante).
    /// </summary>
    public static ulong ReadManifestGid(KeyValue depotChild, string branch)
    {
        if (depotChild == KeyValue.Invalid) return InvalidManifest;

        var gid = depotChild["manifests"][branch]["gid"].Value;
        return gid != null && ulong.TryParse(gid, out var id) ? id : InvalidManifest;
    }

    /// <summary>
    /// Indique si le depot est proxié vers une autre app (pas de manifest local mais
    /// un <c>depotfromapp</c>) ; renvoie l'app id cible, ou 0 sinon.
    /// </summary>
    public static uint ProxiedFromApp(KeyValue depotChild)
    {
        if (depotChild["manifests"] != KeyValue.Invalid) return 0;
        var from = depotChild["depotfromapp"];
        return from != KeyValue.Invalid ? from.AsUnsignedInteger() : 0;
    }

    /// <summary>
    /// Lit le <c>buildid</c> d'une branche dans la section <c>depots</c> — l'identifiant
    /// de build canonique d'une app (change à chaque mise à jour). 0 si absent.
    /// Sert à détecter qu'une nouvelle version du jeu est disponible.
    /// </summary>
    public static uint ReadBranchBuildId(KeyValue depots, string branch)
    {
        var buildid = depots["branches"][branch]["buildid"].Value;
        return buildid != null && uint.TryParse(buildid, out var id) ? id : 0;
    }
}
