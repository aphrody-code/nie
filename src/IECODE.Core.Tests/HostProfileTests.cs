using IECODE.Core.Runtime;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Logique pure du profil hôte : parallélisme ajusté à la charge (VPS partagé) et
/// taille de buffer I/O, avec overrides par variable d'environnement.
/// </summary>
public class HostProfileTests
{
    // ── Parallélisme ──────────────────────────────────────────────────────────

    [Fact]
    public void Parallelism_EnvOverride_HonoredVerbatim()
    {
        // Override explicite gagne, même au-dessus du nombre de cœurs (sur-souscription voulue).
        Assert.Equal(16, HostProfile.ComputeParallelism(cores: 12, load1: 6.5, envOverride: "16"));
        Assert.Equal(3, HostProfile.ComputeParallelism(cores: 12, load1: 0.0, envOverride: "3"));
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-4")]
    [InlineData("abc")]
    [InlineData("")]
    [InlineData(null)]
    public void Parallelism_InvalidOverride_Ignored(string? env)
    {
        // Override invalide ⇒ on retombe sur le calcul (ici sans charge → tous les cœurs).
        Assert.Equal(12, HostProfile.ComputeParallelism(cores: 12, load1: 0.0, envOverride: env));
    }

    [Fact]
    public void Parallelism_NoLoad_UsesAllCores()
    {
        // Pas de loadavg (non-Linux, load1 <= 0) ⇒ tous les cœurs.
        Assert.Equal(12, HostProfile.ComputeParallelism(cores: 12, load1: -1, envOverride: null));
        Assert.Equal(8, HostProfile.ComputeParallelism(cores: 8, load1: 0, envOverride: null));
    }

    [Fact]
    public void Parallelism_SharedBox_LeavesHeadroom()
    {
        // VPS partagé : load voisin 6.5/12 ⇒ ~5 cœurs libres (floor(12 - 6.5) = 5).
        Assert.Equal(5, HostProfile.ComputeParallelism(cores: 12, load1: 6.5, envOverride: null));
        // load 3.2/12 ⇒ floor(8.8) = 8.
        Assert.Equal(8, HostProfile.ComputeParallelism(cores: 12, load1: 3.2, envOverride: null));
    }

    [Fact]
    public void Parallelism_Saturated_ClampedToFloorTwo()
    {
        // Machine saturée (load ≥ cores) : plancher 2 pour garantir le progrès.
        Assert.Equal(2, HostProfile.ComputeParallelism(cores: 12, load1: 12.0, envOverride: null));
        Assert.Equal(2, HostProfile.ComputeParallelism(cores: 12, load1: 20.0, envOverride: null));
    }

    [Fact]
    public void Parallelism_NeverExceedsCores_WhenLoadAware()
    {
        // Sans override, on ne dépasse jamais le nombre de cœurs même si load négatif aberrant.
        Assert.Equal(4, HostProfile.ComputeParallelism(cores: 4, load1: -100, envOverride: null));
    }

    // ── Buffer I/O ────────────────────────────────────────────────────────────

    [Fact]
    public void IoBuffer_Default_OneMegabyte()
    {
        Assert.Equal(1024 * 1024, HostProfile.ComputeIoBuffer(null));
        Assert.Equal(1024 * 1024, HostProfile.ComputeIoBuffer(""));
        Assert.Equal(1024 * 1024, HostProfile.ComputeIoBuffer("0"));
        Assert.Equal(1024 * 1024, HostProfile.ComputeIoBuffer("nope"));
    }

    [Theory]
    [InlineData("64", 64 * 1024)]
    [InlineData("256", 256 * 1024)]
    [InlineData("4096", 4096 * 1024)]
    public void IoBuffer_EnvOverride_InKilobytes(string env, int expected)
    {
        Assert.Equal(expected, HostProfile.ComputeIoBuffer(env));
    }
}
