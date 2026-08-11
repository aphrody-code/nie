using System;
using System.IO;
using System.Linq;
using IECODE.Core.Formats.Level5;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests du parseur/extracteur G4PK contre de VRAIS fichiers .g4pk d'IEVR.
///
/// Source canonique du sample : CPK 000540c46ad1a58289d6064396b85202.cpk
///   -> data/common/map/s/s28g001b/s28g001b.g4pk  (1 sous-fichier g4sk)
///
/// Les fixtures (sous-fichiers G4MT/G4TP/G4VS/G4MA extraits de packs réels) sont
/// déposées dans le dump Steam local :
///   /home/ubuntu/.local/share/Steam/iecode/inazuma/data/_g4pk_fixtures/
/// Les tests dépendant des fichiers réels sont skippés si ceux-ci sont absents.
/// </summary>
public class G4pkParserTests
{
    private static readonly string FixtureDir =
        "/home/ubuntu/.local/share/Steam/iecode/inazuma/data/_g4pk_fixtures";

    private static string Fixture(string name) => Path.Combine(FixtureDir, name);

    private static bool HasFixture(string name) =>
        Directory.Exists(FixtureDir) && File.Exists(Fixture(name));

    // ── Header synthétique ────────────────────────────────────────────────────

    [Fact]
    public void ParseHeader_ThrowsOnTooSmall()
    {
        Assert.Throws<InvalidDataException>(() => G4pkParser.ParseHeader(new byte[8]));
    }

    [Fact]
    public void ParseHeader_ThrowsOnBadMagic()
    {
        var data = new byte[64];
        // Magic invalide
        data[0] = 0x00; data[1] = 0x11; data[2] = 0x22; data[3] = 0x33;
        Assert.Throws<InvalidDataException>(() => G4pkParser.ParseHeader(data));
    }

    [Fact]
    public void Magic_IsG4pkAscii()
    {
        // "G4PK" little-endian lu sur x86 == 0x4B503447
        Assert.Equal(0x4B503447u, G4pkParser.MAGIC);
        Assert.Equal((byte)'G', (byte)(G4pkParser.MAGIC & 0xFF));
    }

    // ── DetectSubFormat ───────────────────────────────────────────────────────

    [Fact]
    public void DetectSubFormat_ReadsContainerMagic()
    {
        var g4mt = "G4MT"u8.ToArray();
        Assert.Equal("G4MT", G4pkParser.DetectSubFormat("x.g4mt", g4mt));
    }

    [Fact]
    public void DetectSubFormat_FallsBackToExtension()
    {
        // Pas de magic "G4??" -> classification par extension
        var raw = new byte[] { 0x01, 0x02, 0x03, 0x04, 0x05, 0x06 };
        Assert.Equal("objbin", G4pkParser.DetectSubFormat("model.objbin", raw));
    }

    [Fact]
    public void DetectSubFormat_FallsBackToRaw()
    {
        var raw = new byte[] { 0x00, 0x00, 0x00, 0x00 };
        Assert.Equal("raw", G4pkParser.DetectSubFormat("noext", raw));
    }

    // ── s28g001b.g4pk (sample canonique du CPK) ───────────────────────────────

    [Fact]
    public void Parse_S28g001b_HasSingleG4skSubFile()
    {
        if (!HasFixture("s28g001b.g4pk")) return;

        var files = G4pkParser.ParseFile(Fixture("s28g001b.g4pk"));
        Assert.Single(files);

        var f = files[0];
        Assert.Equal("s28g001b.g4sk", f.Name);
        Assert.Equal(3344, f.Size);
        Assert.Equal(0x940E596Du, f.Hash);
        // L'octet d'offset (header + offset<<2) doit pointer sur le magic G4SK
        Assert.Equal("G4SK", G4pkParser.DetectSubFormat(f.Name, f.Data.Span));
    }

    // ── ev61100200.g4pk (4 sous-fichiers, formats variés) ─────────────────────

    [Fact]
    public void Parse_Ev61100200_HasFourSubFiles()
    {
        if (!HasFixture("ev61100200.g4pk")) return;

        var files = G4pkParser.ParseFile(Fixture("ev61100200.g4pk"));
        Assert.Equal(4, files.Count);

        var names = files.Select(f => f.Name).ToArray();
        Assert.Contains("ev61100200.g4mt", names);
        Assert.Contains("ev61100200.g4vs", names);
        Assert.Contains("ev61100200.g4ma", names);
        Assert.Contains("ev61100200.g4tp", names);

        // Chaque sous-fichier doit porter le bon magic une fois extrait
        foreach (var f in files)
        {
            string expected = Path.GetExtension(f.Name).TrimStart('.').ToUpperInvariant();
            Assert.Equal(expected, G4pkParser.DetectSubFormat(f.Name, f.Data.Span));
        }
    }

    [Fact]
    public void Parse_Ev61100200_OffsetsAreMonotonicAndInBounds()
    {
        if (!HasFixture("ev61100200.g4pk")) return;

        long total = new FileInfo(Fixture("ev61100200.g4pk")).Length;
        var files = G4pkParser.ParseFile(Fixture("ev61100200.g4pk"));

        int prev = 0;
        foreach (var f in files)
        {
            Assert.True(f.Offset >= prev, "Offsets doivent être croissants.");
            Assert.True(f.Offset + f.Size <= total, "Sous-fichier hors limites.");
            Assert.True(f.Size > 0);
            prev = f.Offset;
        }
    }

    // ── k002030_p010.g4pk (2 sous-fichiers : g4mt + g4tp) ─────────────────────

    [Fact]
    public void Parse_Keshin_HasMaterialAndTexturePack()
    {
        if (!HasFixture("k002030_p010.g4pk")) return;

        var files = G4pkParser.ParseFile(Fixture("k002030_p010.g4pk"));
        Assert.Equal(2, files.Count);
        Assert.Equal("G4MT", G4pkParser.DetectSubFormat(files[0].Name, files[0].Data.Span));
        Assert.Equal("G4TP", G4pkParser.DetectSubFormat(files[1].Name, files[1].Data.Span));
    }

    // ── Extraction sur disque ─────────────────────────────────────────────────

    [Fact]
    public void ExtractFiles_WritesSubFilesWithValidMagics()
    {
        if (!HasFixture("ev61100200.g4pk")) return;

        string outDir = Path.Combine(Path.GetTempPath(),
            "iecode_g4pk_test_" + Guid.NewGuid().ToString("N"));
        try
        {
            G4pkParser.ExtractFiles(Fixture("ev61100200.g4pk"), outDir);

            var written = Directory.GetFiles(outDir, "*", SearchOption.AllDirectories);
            Assert.Equal(4, written.Length);

            foreach (var path in written)
            {
                var head = File.ReadAllBytes(path).Take(4).ToArray();
                // Tous les sous-fichiers de ce pack sont des conteneurs "G4??"
                Assert.Equal((byte)'G', head[0]);
                Assert.Equal((byte)'4', head[1]);
            }
        }
        finally
        {
            if (Directory.Exists(outDir)) Directory.Delete(outDir, recursive: true);
        }
    }
}
