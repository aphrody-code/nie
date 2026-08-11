using IECODE.Core.Steam.Content;
using SteamKit2;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests de la logique pure de résolution des depots (SteamDepotResolver),
/// sur des arbres KeyValue fabriqués (aucun I/O réseau).
/// </summary>
public class SteamDepotResolverTests
{
    private static KeyValue Kv(string name, string? value = null, params KeyValue[] children)
    {
        var kv = new KeyValue(name, value);
        foreach (var c in children) kv.Children.Add(c);
        return kv;
    }

    private static KeyValue Config(string? oslist = null, string? osarch = null, string? language = null, bool lowviolence = false)
    {
        var config = Kv("config");
        if (oslist != null) config.Children.Add(Kv("oslist", oslist));
        if (osarch != null) config.Children.Add(Kv("osarch", osarch));
        if (language != null) config.Children.Add(Kv("language", language));
        if (lowviolence) config.Children.Add(Kv("lowviolence", "1"));
        return config;
    }

    /// <summary>Section depots réaliste : depots Windows/Linux, sans config, et entrées non-depot.</summary>
    private static KeyValue SampleDepots() => Kv("depots", null,
        Kv("1001", null, Config(oslist: "windows")),
        Kv("1002", null, Config(oslist: "linux")),
        Kv("1003", null, Kv("name", "sans config")), // a des enfants mais pas de config → éligible partout
        Kv("1004", null, Config(oslist: "windows,macos")),
        Kv("branches", null, Kv("public", "1")), // non-numérique → ignoré
        Kv("baselanguages", "english")); // pas d'enfants → ignoré

    [Fact]
    public void ExplicitDepots_AreReturnedDeduped()
    {
        var ids = SteamDepotResolver.SelectDepotIds(SampleDepots(), [42u, 42u, 7u], false, "windows", null, "english");
        Assert.Equal([42u, 7u], ids);
    }

    [Fact]
    public void Windows_FiltersOutLinuxDepots()
    {
        var ids = SteamDepotResolver.SelectDepotIds(SampleDepots(), [], false, "windows", null, "english");
        Assert.Contains(1001u, ids); // windows
        Assert.DoesNotContain(1002u, ids); // linux
        Assert.Contains(1003u, ids); // pas de config
        Assert.Contains(1004u, ids); // windows,macos
    }

    [Fact]
    public void Linux_FiltersOutWindowsDepots()
    {
        var ids = SteamDepotResolver.SelectDepotIds(SampleDepots(), [], false, "linux", null, "english");
        Assert.Contains(1002u, ids);
        Assert.DoesNotContain(1001u, ids);
        Assert.DoesNotContain(1004u, ids);
    }

    [Fact]
    public void AllPlatforms_IncludesEveryNumericDepot()
    {
        var ids = SteamDepotResolver.SelectDepotIds(SampleDepots(), [], true, "windows", null, "english");
        Assert.Equal([1001u, 1002u, 1003u, 1004u], ids);
    }

    [Fact]
    public void NonNumericAndChildlessEntries_AreIgnored()
    {
        var ids = SteamDepotResolver.SelectDepotIds(SampleDepots(), [], true, "windows", null, "english");
        Assert.DoesNotContain(ids, id => id == 0); // "branches"/"baselanguages" jamais comptés
        Assert.Equal(4, ids.Count);
    }

    [Theory]
    [InlineData("64", "64", true)]
    [InlineData("64", "32", false)]
    public void Arch_IsFilteredWhenSpecified(string depotArch, string wantedArch, bool eligible)
    {
        var depot = Kv("9", null, Config(oslist: "windows", osarch: depotArch));
        Assert.Equal(eligible, SteamDepotResolver.IsDepotEligible(depot, "windows", wantedArch, "english"));
    }

    [Fact]
    public void Language_IsFilteredWhenSpecified()
    {
        var fr = Kv("9", null, Config(language: "french"));
        Assert.False(SteamDepotResolver.IsDepotEligible(fr, "windows", null, "english"));
        Assert.True(SteamDepotResolver.IsDepotEligible(fr, "windows", null, "french"));
    }

    [Fact]
    public void LowViolenceDepots_AreExcluded()
    {
        var lv = Kv("9", null, Config(oslist: "windows", lowviolence: true));
        Assert.False(SteamDepotResolver.IsDepotEligible(lv, "windows", null, "english"));
    }

    [Fact]
    public void ReadManifestGid_ReadsBranchGid()
    {
        var depot = Kv("1001", null, Kv("manifests", null, Kv("public", null, Kv("gid", "5612541580377302256"))));
        Assert.Equal(5612541580377302256ul, SteamDepotResolver.ReadManifestGid(depot, "public"));
    }

    [Fact]
    public void ReadManifestGid_MissingBranch_IsInvalid()
    {
        var depot = Kv("1001", null, Kv("manifests", null, Kv("public", null, Kv("gid", "999"))));
        Assert.Equal(SteamDepotResolver.InvalidManifest, SteamDepotResolver.ReadManifestGid(depot, "beta"));
    }

    [Fact]
    public void ReadManifestGid_InvalidDepot_IsInvalid()
    {
        Assert.Equal(SteamDepotResolver.InvalidManifest, SteamDepotResolver.ReadManifestGid(KeyValue.Invalid, "public"));
    }

    [Fact]
    public void ProxiedFromApp_DetectsDepotFromApp()
    {
        var proxied = Kv("1042", null, Kv("depotfromapp", "228980"));
        Assert.Equal(228980u, SteamDepotResolver.ProxiedFromApp(proxied));
    }

    [Fact]
    public void ProxiedFromApp_ZeroWhenManifestsPresent()
    {
        var direct = Kv("1001", null,
            Kv("depotfromapp", "228980"),
            Kv("manifests", null, Kv("public", null, Kv("gid", "1"))));
        Assert.Equal(0u, SteamDepotResolver.ProxiedFromApp(direct));
    }

    [Fact]
    public void ReadBranchBuildId_ReadsPublicBuildId()
    {
        var depots = Kv("depots", null,
            Kv("branches", null,
                Kv("public", null, Kv("buildid", "18293746")),
                Kv("beta", null, Kv("buildid", "18300000"))));
        Assert.Equal(18293746u, SteamDepotResolver.ReadBranchBuildId(depots, "public"));
        Assert.Equal(18300000u, SteamDepotResolver.ReadBranchBuildId(depots, "beta"));
    }

    [Fact]
    public void ReadBranchBuildId_ZeroWhenMissing()
    {
        var depots = Kv("depots", null, Kv("branches", null, Kv("public", null, Kv("buildid", "1"))));
        Assert.Equal(0u, SteamDepotResolver.ReadBranchBuildId(depots, "nonexistent"));
    }
}
