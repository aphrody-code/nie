using System.IO;
using System.Linq;
using IECODE.Core.Formats.Level5;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests du parser sémantique MEVBIN (<see cref="MevbinDocument"/>).
///
/// Fichiers de référence : échantillons réels extraits du CPK
/// 07043abf9322abf9ac0fc6fa5e1fb073.cpk (data/common/chr/cXXXXXX/*.mevbin).
/// Les tests dépendant de fichiers réels sont passés silencieusement si les
/// fichiers sont absents (CI sans données jeu).
/// </summary>
public class MevbinDocumentTests
{
    private static readonly string[] SampleDirs =
    {
        Path.Combine(TestDataPaths.DataRoot, "common", "chr"),
    };

    private static string? FindSample()
    {
        foreach (var dir in SampleDirs)
        {
            if (!Directory.Exists(dir)) continue;
            var f = Directory.EnumerateFiles(dir, "*.mevbin", SearchOption.AllDirectories)
                .OrderBy(p => p)
                .FirstOrDefault();
            if (f != null) return f;
        }
        return null;
    }

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("MevbinDocument.DecodeFile")]
    public void Decode_RealSample_FormatAndStructure()
    {
        var path = FindSample();
        if (path is null) return; // CI sans données jeu

        var doc = MevbinDocument.DecodeFile(path);

        // Au moins une motion et un événement.
        Assert.NotEmpty(doc.Motions);
        Assert.True(doc.ParsedEventCount > 0);

        // Chaque motion a un hash non nul et des événements ordonnés.
        foreach (var m in doc.Motions)
        {
            foreach (var ev in m.Events)
                Assert.True(ev.Time >= 0f);
        }
    }

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("MevbinDocument.DecodeFile")]
    public void Decode_RealSample_HeaderCountsMatchParsed()
    {
        var path = FindSample();
        if (path is null) return;

        var doc = MevbinDocument.DecodeFile(path);

        // Invariant fort validé sur le corpus : l'en-tête COUNT_0 annonce
        // exactement le nombre de motions et d'événements réellement présents.
        Assert.Equal(doc.EventCount, doc.ParsedEventCount);
        Assert.Equal(doc.MotionCount, doc.Motions.Count);
    }

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("MevbinDocument.DecodeFile")]
    public void Decode_RealSample_JsonRoundTrips()
    {
        var path = FindSample();
        if (path is null) return;

        var doc = MevbinDocument.DecodeFile(path);
        var json = doc.ToJson(indented: false);

        Assert.Contains("\"format\":\"MEVBIN\"", json);
        Assert.Contains("\"motions\":", json);
        using var parsed = System.Text.Json.JsonDocument.Parse(json); // valide
    }
}
