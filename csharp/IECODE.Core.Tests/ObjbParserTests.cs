using System;
using System.IO;
using System.Linq;
using IECODE.Core.Formats.Menu;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests du parseur OBJB contre les vrais fichiers .objbin d'IEVR.
/// Fichiers de référence : /home/ubuntu/niers/data/common/gamedata/menu/obj/
/// Les tests qui dépendent des fichiers réels sont skippés si ceux-ci sont absents.
/// </summary>
public class ObjbParserTests
{
    private static readonly string ObjDir =
        "/home/ubuntu/niers/data/common/gamedata/menu/obj";

    private static string ObjFile(string name) => Path.Combine(ObjDir, name);

    private static bool HasObjFiles() =>
        Directory.Exists(ObjDir) &&
        File.Exists(ObjFile("title00_09_version.objbin"));

    // ── IsObjb ────────────────────────────────────────────────────────────────

    [Fact]
    public void IsObjb_ReturnsTrueForValidFooter()
    {
        // Footer cfg.bin: 01 74 32 62 + padding
        var data = new byte[64];
        data[60] = 0x01; data[61] = 0x74; data[62] = 0x32; data[63] = 0x62;
        Assert.True(ObjbParser.IsObjb(data));
    }

    [Fact]
    public void IsObjb_ReturnsFalseForEmpty()
    {
        Assert.False(ObjbParser.IsObjb(Array.Empty<byte>()));
    }

    [Fact]
    public void IsObjb_ReturnsFalseForInvalidData()
    {
        Assert.False(ObjbParser.IsObjb(new byte[] { 0x00, 0x00, 0x00, 0x00 }));
    }

    [Fact]
    public void Parse_ThrowsOnNull()
    {
        Assert.Throws<ArgumentNullException>(() => ObjbParser.Parse((byte[])null!));
    }

    [Fact]
    public void Parse_ThrowsOnTooSmall()
    {
        Assert.Throws<ObjbParseException>(() => ObjbParser.Parse(new byte[4]));
    }

    [Fact]
    public void Parse_ThrowsOnInvalidFooter()
    {
        var data = new byte[32];
        Assert.Throws<ObjbParseException>(() => ObjbParser.Parse(data));
    }

    // ── title00_09_version.objbin ─────────────────────────────────────────────

    [Fact]
    public void Parse_Title00_09_Version_HasCorrectName()
    {
        if (!HasObjFiles()) return;

        var obj = ObjbParser.Parse(File.ReadAllBytes(ObjFile("title00_09_version.objbin")));
        Assert.Equal("title00_09_version", obj.Name);
    }

    [Fact]
    public void Parse_Title00_09_Version_HasGmdMenuObjType()
    {
        if (!HasObjFiles()) return;

        var obj = ObjbParser.Parse(File.ReadAllBytes(ObjFile("title00_09_version.objbin")));
        Assert.Equal("gmdMenuObj", obj.EngineType);
    }

    [Fact]
    public void Parse_Title00_09_Version_HasG4pkmPath()
    {
        if (!HasObjFiles()) return;

        var obj = ObjbParser.Parse(File.ReadAllBytes(ObjFile("title00_09_version.objbin")));
        Assert.NotNull(obj.G4pkmPath);
        Assert.Contains("title00_09.g4pkm", obj.G4pkmPath!);
        Assert.Contains("50_title", obj.G4pkmPath!);
    }

    [Fact]
    public void Parse_Title00_09_Version_HasG4txPath()
    {
        if (!HasObjFiles()) return;

        var obj = ObjbParser.Parse(File.ReadAllBytes(ObjFile("title00_09_version.objbin")));
        Assert.NotNull(obj.G4txPath);
        // Le chemin "#/" doit être normalisé en "dx11/"
        Assert.StartsWith("dx11/", obj.G4txPath!);
        Assert.Contains("title00_09.g4tx", obj.G4txPath!);
        Assert.Contains("<LG>", obj.G4txPath!);
    }

    [Fact]
    public void Parse_Title00_09_Version_HasRenderComponent()
    {
        if (!HasObjFiles()) return;

        var obj    = ObjbParser.Parse(File.ReadAllBytes(ObjFile("title00_09_version.objbin")));
        var render = obj.Components.OfType<RenderComponent>().FirstOrDefault();

        Assert.NotNull(render);
        Assert.Equal("CMenuRenderComponent", render!.TypeName);
        Assert.True(render.DrawPriority > 0, "DrawPriority doit être positif.");
    }

    [Fact]
    public void Parse_Title00_09_Version_HasPrimitiveComponent()
    {
        if (!HasObjFiles()) return;

        var obj  = ObjbParser.Parse(File.ReadAllBytes(ObjFile("title00_09_version.objbin")));
        var prim = obj.Components.OfType<PrimitiveComponent>().FirstOrDefault();

        Assert.NotNull(prim);
        Assert.True(prim!.NumberSettingHashes.Count > 0, "DispMaxValues attendus.");
    }

    [Fact]
    public void Parse_Title00_09_Version_ComponentCount()
    {
        if (!HasObjFiles()) return;

        var obj = ObjbParser.Parse(File.ReadAllBytes(ObjFile("title00_09_version.objbin")));
        // Attend : CMenuRenderComponent, CMenuAnimation, CMenuCreatePrimitiveComponent
        Assert.True(obj.Components.Count >= 3,
            $"Attendu ≥3 composants, obtenu {obj.Components.Count}.");
    }

    // ── win01_21_select_button.objbin ─────────────────────────────────────────

    [Fact]
    public void Parse_Win01_21_SelectButton_HasCorrectName()
    {
        if (!HasObjFiles()) return;

        var obj = ObjbParser.Parse(File.ReadAllBytes(ObjFile("win01_21_select_button.objbin")));
        // Nom avec tabulation en préfixe dans le fichier réel
        Assert.Contains("cmn_button_s", obj.Name);
    }

    [Fact]
    public void Parse_Win01_21_SelectButton_HasG4pkmPath()
    {
        if (!HasObjFiles()) return;

        var obj = ObjbParser.Parse(File.ReadAllBytes(ObjFile("win01_21_select_button.objbin")));
        Assert.NotNull(obj.G4pkmPath);
        Assert.Contains("win01_21.g4pkm", obj.G4pkmPath!);
    }

    [Fact]
    public void Parse_Win01_21_SelectButton_HasAnimationComponent()
    {
        if (!HasObjFiles()) return;

        var obj  = ObjbParser.Parse(File.ReadAllBytes(ObjFile("win01_21_select_button.objbin")));
        var anim = obj.Components.OfType<AnimationComponent>().FirstOrDefault();

        Assert.NotNull(anim);
        Assert.NotEqual(0u, anim!.MotOpenHash);
    }

    [Fact]
    public void Parse_Win01_21_SelectButton_HasTextComponent()
    {
        if (!HasObjFiles()) return;

        var obj  = ObjbParser.Parse(File.ReadAllBytes(ObjFile("win01_21_select_button.objbin")));
        var text = obj.Components.OfType<TextComponent>().FirstOrDefault();

        Assert.NotNull(text);
        Assert.True(text!.Entries.Count >= 2, "Attendu ≥2 clés texte.");
        Assert.Contains(text.Entries, e => e.Key == "_text_choice01_on");
        Assert.Contains(text.Entries, e => e.Key == "_text_choice01_off");
    }

    [Fact]
    public void Parse_Win01_21_SelectButton_RenderHasDrawPriority300()
    {
        if (!HasObjFiles()) return;

        var obj    = ObjbParser.Parse(File.ReadAllBytes(ObjFile("win01_21_select_button.objbin")));
        var render = obj.Components.OfType<RenderComponent>().FirstOrDefault();

        Assert.NotNull(render);
        Assert.Equal(300, render!.DrawPriority);
    }

    // ── save01_04_savedata_detail_window.objbin ───────────────────────────────

    [Fact]
    public void Parse_Save01_04_DetailWindow_HasCorrectName()
    {
        if (!HasObjFiles()) return;

        var obj = ObjbParser.Parse(File.ReadAllBytes(ObjFile("save01_04_savedata_detail_window.objbin")));
        Assert.Equal("save01_04_savedata_detail_window", obj.Name);
    }

    [Fact]
    public void Parse_Save01_04_DetailWindow_HasG4pkmPath()
    {
        if (!HasObjFiles()) return;

        var obj = ObjbParser.Parse(File.ReadAllBytes(ObjFile("save01_04_savedata_detail_window.objbin")));
        Assert.NotNull(obj.G4pkmPath);
        Assert.Contains("save01_04.g4pkm", obj.G4pkmPath!);
    }

    [Fact]
    public void Parse_Save01_04_DetailWindow_HasManyTextKeys()
    {
        if (!HasObjFiles()) return;

        var obj  = ObjbParser.Parse(File.ReadAllBytes(ObjFile("save01_04_savedata_detail_window.objbin")));
        var text = obj.Components.OfType<TextComponent>().FirstOrDefault();

        Assert.NotNull(text);
        Assert.True(text!.Entries.Count >= 10,
            $"Attendu ≥10 clés texte, obtenu {text.Entries.Count}.");
        Assert.Contains(text.Entries, e => e.Key.StartsWith("_text_save_info_title"));
        Assert.Contains(text.Entries, e => e.Key.StartsWith("_text_category_title"));
    }

    [Fact]
    public void Parse_Save01_04_DetailWindow_HasMeshVisibleComponent()
    {
        if (!HasObjFiles()) return;

        var obj  = ObjbParser.Parse(File.ReadAllBytes(ObjFile("save01_04_savedata_detail_window.objbin")));
        var mesh = obj.Components.OfType<MeshVisibleComponent>().FirstOrDefault();

        Assert.NotNull(mesh);
        Assert.Equal(4, mesh!.Params.Count);
    }

    [Fact]
    public void Parse_Save01_04_DetailWindow_HasPrimitiveWithDispMax()
    {
        if (!HasObjFiles()) return;

        var obj  = ObjbParser.Parse(File.ReadAllBytes(ObjFile("save01_04_savedata_detail_window.objbin")));
        var prim = obj.Components.OfType<PrimitiveComponent>().FirstOrDefault();

        Assert.NotNull(prim);
        Assert.True(prim!.DispMaxValues.Count >= 10);
    }

    [Fact]
    public void Parse_Save01_04_DetailWindow_HasAtLeastFiveComponents()
    {
        if (!HasObjFiles()) return;

        var obj = ObjbParser.Parse(File.ReadAllBytes(ObjFile("save01_04_savedata_detail_window.objbin")));
        Assert.True(obj.Components.Count >= 5,
            $"Attendu ≥5 composants, obtenu {obj.Components.Count}.");
    }

    // ── Batch ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Parse_AllObjbinFiles_NoExceptions()
    {
        if (!HasObjFiles()) return;

        var files  = Directory.EnumerateFiles(ObjDir, "*.objbin").ToList();
        Assert.NotEmpty(files);

        var errors = new System.Collections.Generic.List<string>();
        foreach (var f in files)
        {
            try
            {
                var obj = ObjbParser.Parse(File.ReadAllBytes(f));
                // Vérifications minimales
                Assert.NotNull(obj.Name);
                Assert.Equal("gmdMenuObj", obj.EngineType);
            }
            catch (Exception ex)
            {
                errors.Add($"{Path.GetFileName(f)}: {ex.Message}");
            }
        }

        Assert.True(errors.Count == 0,
            $"{errors.Count}/{files.Count} fichiers en erreur :\n" +
            string.Join("\n", errors.Take(10)));
    }
}
