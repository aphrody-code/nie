using System.Diagnostics.CodeAnalysis;
using System.IO;
using System.Linq;
using IECODE.Core.Formats.Level5;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests du générateur de manifestes typés (<see cref="CfgBinTypesGenerator"/>) :
/// un cfg.bin réel doit être décodé et produire un manifeste cohérent.
///
/// <para>Les tests qui dépendent de fichiers réels sont passés silencieusement si
/// les fichiers sont absents (CI sans données jeu), à l'image de
/// <see cref="LuaTypesGeneratorTests"/>.</para>
/// </summary>
public class CfgBinTypesGeneratorTests
{
    private const string DataRoot = "/home/ubuntu/niers/data";

    // Fichier RDBN de référence — courant dans le dump IEVR.
    private const string RdbnFile =
        DataRoot + "/common/gamedata/event/event_movie_config_0.00.00.cfg.bin";

    // Fichier T2B de référence — event_cmnd_config utilisé dans CfgBinGenericTests.
    private const string T2bFile =
        DataRoot + "/common/gamedata/event/event_cmnd_config_0.00.00.cfg.bin";

    private static bool HasFile(string path) => File.Exists(path);

    // ── Fichier absent → skip propre ─────────────────────────────────────────

    [Fact]
    [RequiresUnreferencedCode("CfgBinTypesGenerator.Generate")]
    public void Generate_RdbnFile_ManifestHasTablesAndFields()
    {
        if (!HasFile(RdbnFile)) return;

        var gen = new CfgBinTypesGenerator();
        var manifest = gen.Generate(RdbnFile);

        Assert.Equal("RDBN", manifest.Format);
        Assert.NotEmpty(manifest.Tables);
        // Chaque table doit avoir au moins un champ inféré.
        Assert.All(manifest.Tables, t => Assert.NotEmpty(t.Fields));
    }

    [Fact]
    [RequiresUnreferencedCode("CfgBinTypesGenerator.Generate")]
    public void Generate_RdbnFile_ConfigNameStripsVersionSuffix()
    {
        if (!HasFile(RdbnFile)) return;

        var gen = new CfgBinTypesGenerator();
        var manifest = gen.Generate(RdbnFile);

        // Le nom logique ne doit pas contenir « .cfg.bin » ni de suffixe de version.
        Assert.DoesNotContain(".cfg.bin", manifest.Config);
        Assert.DoesNotContain(".00.00", manifest.Config);
    }

    [Fact]
    [RequiresUnreferencedCode("CfgBinTypesGenerator.Generate")]
    public void Generate_T2bFile_ManifestFormatIsT2B()
    {
        if (!HasFile(T2bFile)) return;

        var gen = new CfgBinTypesGenerator();
        var manifest = gen.Generate(T2bFile);

        Assert.Equal("T2B", manifest.Format);
        Assert.NotEmpty(manifest.Tables);
    }

    // ── GenerateAll sur un seul fichier ───────────────────────────────────────

    [Fact]
    [RequiresUnreferencedCode("CfgBinTypesGenerator.GenerateAll")]
    public void GenerateAll_SingleRdbnFile_ProducesDtsAndJson()
    {
        if (!HasFile(RdbnFile)) return;

        string outDir = Path.Combine(Path.GetTempPath(), "iecode-cfgtypes-test-" + Path.GetRandomFileName());
        Directory.CreateDirectory(outDir);
        try
        {
            var gen = new CfgBinTypesGenerator();
            var summary = gen.GenerateAll(RdbnFile, outDir);

            Assert.Equal(1, summary.Total);
            Assert.Equal(1, summary.Decoded);
            Assert.Equal(0, summary.Failed);

            // Vérifie les fichiers émis.
            var dtsFiles  = Directory.GetFiles(outDir, "*.d.ts");
            var jsonFiles = Directory.GetFiles(outDir, "*.json");

            // Au moins : <config>.d.ts + index.d.ts + <config>.json + index.json + verify.json.
            Assert.Contains(dtsFiles,  f => !Path.GetFileName(f).StartsWith("index"));
            Assert.True(File.Exists(Path.Combine(outDir, "index.d.ts")),  "index.d.ts absent");
            Assert.True(File.Exists(Path.Combine(outDir, "index.json")),  "index.json absent");
            Assert.True(File.Exists(Path.Combine(outDir, "verify.json")), "verify.json absent");
        }
        finally
        {
            Directory.Delete(outDir, recursive: true);
        }
    }

    [Fact]
    [RequiresUnreferencedCode("CfgBinTypesGenerator.GenerateAll")]
    public void GenerateAll_SingleRdbnFile_DtsContainsTsInterface()
    {
        if (!HasFile(RdbnFile)) return;

        string outDir = Path.Combine(Path.GetTempPath(), "iecode-cfgtypes-dts-" + Path.GetRandomFileName());
        Directory.CreateDirectory(outDir);
        try
        {
            var gen = new CfgBinTypesGenerator();
            gen.GenerateAll(RdbnFile, outDir);

            // Le .d.ts généré doit contenir au moins une déclaration d'interface.
            var dts = Directory.GetFiles(outDir, "*.d.ts")
                .Where(f => !Path.GetFileName(f).StartsWith("index"))
                .Select(File.ReadAllText)
                .FirstOrDefault();

            Assert.NotNull(dts);
            Assert.Contains("export interface ", dts);
            Assert.Contains("// AUTO-GÉNÉRÉ par `iecode cfg types`", dts);
        }
        finally
        {
            Directory.Delete(outDir, recursive: true);
        }
    }

    // ── ToJson : sérialisation de manifeste ───────────────────────────────────

    [Fact]
    [RequiresUnreferencedCode("CfgBinTypesGenerator.Generate")]
    public void ToJson_RdbnManifest_IsValidJson()
    {
        if (!HasFile(RdbnFile)) return;

        var gen      = new CfgBinTypesGenerator();
        var manifest = gen.Generate(RdbnFile);
        string json  = CfgBinTypesGenerator.ToJson(manifest);

        // Doit être du JSON valide parseable.
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        var root = doc.RootElement;
        Assert.Equal("RDBN", root.GetProperty("format").GetString());
        Assert.True(root.GetProperty("tables").GetArrayLength() > 0);
    }
}
