using System;
using System.IO;
using System.Linq;
using IECODE.Core.Formats.Level5;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests du décodeur générique cfg.bin (<see cref="CfgBinDocument"/>).
///
/// Fichiers de référence : dossier <c>data/</c> de <c>NIE_GAME_DIR</c> ou du dépôt.
/// Les tests qui dépendent de fichiers réels sont passés silencieusement si
/// les fichiers sont absents (CI sans données jeu).
/// </summary>
public class CfgBinGenericTests
{
    // ── Chemins des fichiers de test ──────────────────────────────────────────

    private static readonly string DataRoot = TestDataPaths.DataRoot;
    private static readonly string EventDir = Path.Combine(DataRoot, "common", "gamedata", "event");
    private static readonly string MenuCfgDir = Path.Combine(DataRoot, "common", "gamedata", "menu", "cfg");

    private static string EventFile(string name)  => Path.Combine(EventDir, name);
    private static string MenuFile(string name)    => Path.Combine(MenuCfgDir, name);

    private static bool HasFile(string path) => File.Exists(path);

    // ── Détection de format : T2B ─────────────────────────────────────────────

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void Decode_T2B_EventCmnd_FormatIsT2B()
    {
        string path = EventFile("event_cmnd_config_0.00.00.cfg.bin");
        if (!HasFile(path)) return;

        var doc = CfgBinDocument.DecodeFile(path);
        Assert.Equal("T2B", doc.Format);
    }

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void Decode_T2B_EventCmnd_HasAtLeastOneRecord()
    {
        string path = EventFile("event_cmnd_config_0.00.00.cfg.bin");
        if (!HasFile(path)) return;

        var doc = CfgBinDocument.DecodeFile(path);
        Assert.NotEmpty(doc.Records);
    }

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void Decode_T2B_EventCmnd_RootRecordHasChildren()
    {
        string path = EventFile("event_cmnd_config_0.00.00.cfg.bin");
        if (!HasFile(path)) return;

        var doc = CfgBinDocument.DecodeFile(path);
        var root = doc.Records[0];
        Assert.NotEmpty(root.Children);
    }

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void Decode_T2B_EventCmnd_FieldsHaveCorrectKinds()
    {
        string path = EventFile("event_cmnd_config_0.00.00.cfg.bin");
        if (!HasFile(path)) return;

        var doc = CfgBinDocument.DecodeFile(path);
        // Les champs du record racine : au moins un Int (compte d'items)
        Assert.Contains(doc.Records[0].Fields, f => f.Kind == CfgBinValueKind.Int);
    }

    // ── Détection de format : RDBN ────────────────────────────────────────────

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void Decode_RDBN_EventMovie_FormatIsRdbn()
    {
        string path = EventFile("event_movie_config_0.00.00.cfg.bin");
        if (!HasFile(path)) return;

        var doc = CfgBinDocument.DecodeFile(path);
        Assert.Equal("RDBN", doc.Format);
    }

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void Decode_RDBN_EventMovie_HasThreeTables()
    {
        string path = EventFile("event_movie_config_0.00.00.cfg.bin");
        if (!HasFile(path)) return;

        var doc = CfgBinDocument.DecodeFile(path);
        Assert.Equal(3, doc.Tables.Count);
    }

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void Decode_RDBN_EventMovie_TableNamesAreResolved()
    {
        string path = EventFile("event_movie_config_0.00.00.cfg.bin");
        if (!HasFile(path)) return;

        var doc = CfgBinDocument.DecodeFile(path);
        // Noms de tables issus du fichier RDBN
        Assert.Contains(doc.Tables, t => t.Name == "m_EventMovieInfoList");
        Assert.Contains(doc.Tables, t => t.Name == "m_EventSubtitleMenuDataList");
        Assert.Contains(doc.Tables, t => t.Name == "m_EventSongCaptionDataList");
    }

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void Decode_RDBN_EventMovie_TypeNamesAreResolved()
    {
        string path = EventFile("event_movie_config_0.00.00.cfg.bin");
        if (!HasFile(path)) return;

        var doc = CfgBinDocument.DecodeFile(path);
        Assert.Contains(doc.Tables, t => t.TypeName == "EVENT_MOVIE_INFO");
        Assert.Contains(doc.Tables, t => t.TypeName == "EVENT_SUBTITLE_MENU_DATA");
    }

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void Decode_RDBN_EventMovie_RowsHaveTypedFields()
    {
        string path = EventFile("event_movie_config_0.00.00.cfg.bin");
        if (!HasFile(path)) return;

        var doc = CfgBinDocument.DecodeFile(path);
        var movieTable = doc.Tables.First(t => t.Name == "m_EventMovieInfoList");

        Assert.NotEmpty(movieTable.Rows);
        var row = movieTable.Rows[0];
        Assert.NotEmpty(row.Fields);

        // Le champ captionName dans EVENT_SONG_CAPTION_DATA doit être String
        var captionTable = doc.Tables.First(t => t.Name == "m_EventSongCaptionDataList");
        var captionRow   = captionTable.Rows[0];
        var nameField    = captionRow.Fields.FirstOrDefault(f => f.Name == "captionName");
        Assert.NotNull(nameField);
        Assert.Equal(CfgBinValueKind.String, nameField!.Kind);
    }

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void Decode_RDBN_EventMovie_IntFieldsAreInts()
    {
        string path = EventFile("event_movie_config_0.00.00.cfg.bin");
        if (!HasFile(path)) return;

        var doc = CfgBinDocument.DecodeFile(path);
        var captionTable = doc.Tables.First(t => t.Name == "m_EventSongCaptionDataList");
        var captionRow   = captionTable.Rows[0];

        // startFrame et endFrame sont des scalaires numériques (Int ou Float selon le RdbnReader)
        var startField = captionRow.Fields.FirstOrDefault(f => f.Name == "startFrame");
        Assert.NotNull(startField);
        Assert.Contains(startField!.Kind,
            new[] { CfgBinValueKind.Int, CfgBinValueKind.Float, CfgBinValueKind.Short });
        Assert.Equal(220, Convert.ToInt32(startField.Value));
    }

    // ── T2B menu setting ──────────────────────────────────────────────────────

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void Decode_T2B_MenuSetting_HasStrings()
    {
        string path = MenuFile("ability_learning_board_menu_setting.cfg.bin");
        if (!HasFile(path)) return;

        var doc = CfgBinDocument.DecodeFile(path);
        Assert.Equal("T2B", doc.Format);

        // Cherche des champs String dans les enfants
        bool hasString = AllT2BRecords(doc.Records)
            .SelectMany(r => r.Fields)
            .Any(f => f.Kind == CfgBinValueKind.String);
        Assert.True(hasString, "Le menu setting doit contenir des champs String.");
    }

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void Decode_T2B_MenuSetting_HasMultipleTopRecords()
    {
        string path = MenuFile("ability_learning_board_menu_setting.cfg.bin");
        if (!HasFile(path)) return;

        var doc = CfgBinDocument.DecodeFile(path);
        Assert.True(doc.Records.Count >= 3,
            $"Attendu ≥3 records racines, obtenu {doc.Records.Count}.");
    }

    // ── Chiffrement : cpk_list ─────────────────────────────────────────────────

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void Decode_Encrypted_CpkList_DecodesSuccessfully()
    {
        string path = DataRoot + "/cpk_list.cfg.bin";
        if (!HasFile(path)) return;

        var doc = CfgBinDocument.DecodeFile(path);
        Assert.Equal("T2B", doc.Format);
        Assert.NotEmpty(doc.Records);
    }

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void Decode_Encrypted_CpkList_HasManyChildren()
    {
        string path = DataRoot + "/cpk_list.cfg.bin";
        if (!HasFile(path)) return;

        var doc = CfgBinDocument.DecodeFile(path);
        // Le cpk_list contient des centaines de milliers d'entrées
        var root = doc.Records[0];
        Assert.True(root.Children.Count > 1000,
            $"Attendu >1000 entrées CPK, obtenu {root.Children.Count}.");
    }

    // ── ToJson ────────────────────────────────────────────────────────────────

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void ToJson_T2B_ProducesValidJson()
    {
        string path = EventFile("event_cmnd_config_0.00.00.cfg.bin");
        if (!HasFile(path)) return;

        var doc  = CfgBinDocument.DecodeFile(path);
        var json = doc.ToJson();

        // Doit être du JSON valide
        using var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.Equal("T2B", parsed.RootElement.GetProperty("format").GetString());
        Assert.True(parsed.RootElement.GetProperty("records").GetArrayLength() > 0);
    }

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void ToJson_RDBN_ProducesValidJson()
    {
        string path = EventFile("event_movie_config_0.00.00.cfg.bin");
        if (!HasFile(path)) return;

        var doc  = CfgBinDocument.DecodeFile(path);
        var json = doc.ToJson();

        using var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.Equal("RDBN", parsed.RootElement.GetProperty("format").GetString());
        Assert.True(parsed.RootElement.GetProperty("tables").GetArrayLength() > 0);
    }

    // ── Erreurs ───────────────────────────────────────────────────────────────

    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void Decode_InvalidData_ThrowsInvalidDataException()
    {
        var random = new byte[128];
        new Random(42).NextBytes(random);
        // Garantit que ce n'est ni T2B ni RDBN
        random[0] = 0xDE; random[1] = 0xAD; random[2] = 0xBE; random[3] = 0xEF;

        Assert.Throws<InvalidDataException>(() => CfgBinDocument.Decode(random));
    }

    // ── Cohérence T2B vs OBJB ─────────────────────────────────────────────────

    /// <summary>
    /// Vérifie que le décodeur générique lit un fichier .objbin sans exception
    /// (le format binaire est identique au T2B cfg.bin).
    /// Cohérence avec ObjbParser.
    /// </summary>
    [Fact]
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("CfgBinDocument.Decode")]
    public void Decode_ObjbinFile_DecodesAst2B()
    {
        string path = DataRoot + "/common/gamedata/menu/obj/title00_09_version.objbin";
        if (!HasFile(path)) return;

        // Un .objbin est un T2B cfg.bin — le décodeur générique doit le lire
        var data = File.ReadAllBytes(path);
        var doc  = CfgBinDocument.Decode(data);
        Assert.Equal("T2B", doc.Format);
        Assert.NotEmpty(doc.Records);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static System.Collections.Generic.IEnumerable<CfgBinRecord> AllT2BRecords(
        System.Collections.Generic.IReadOnlyList<CfgBinRecord> records)
    {
        foreach (var r in records)
        {
            yield return r;
            foreach (var child in AllT2BRecords(r.Children))
                yield return child;
        }
    }
}
