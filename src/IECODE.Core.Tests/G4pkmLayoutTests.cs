using System;
using System.IO;
using System.Linq;
using IECODE.Core.Formats.Menu;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests du parseur G4PKM (squelette 2D de menu) contre de vrais fichiers IEVR.
///
/// Fichiers nécessaires (téléchargés via `iecode cdn get`) :
///   /tmp/g4pkm-extract/title00_09.g4pkm    — 20 bones, position hors-écran (bind = caché)
///   /tmp/g4pkm-extract/option02_02.g4pkm   — 4 bones, fullscreen, calibration 1920×1080
///   /tmp/g4pkm-extract/win00_04.g4pkm      — 5 bones, curseur à (-40, 40)
///
/// Tous les tests qui dépendent de vrais fichiers sont skippés si ceux-ci sont absents.
/// </summary>
public class G4pkmLayoutTests
{
    private static readonly string ExtractDir = "/tmp/g4pkm-extract";

    private static string G4pkmFile(string name) =>
        Path.Combine(ExtractDir, name);

    private static bool HasFile(string name) =>
        File.Exists(G4pkmFile(name));

    // ── Validation des arguments ─────────────────────────────────────────────

    [Fact]
    public void ParseG4pkm_ThrowsOnTooShort()
    {
        Assert.Throws<InvalidDataException>(() =>
            G4pkmParser.ParseG4pkm(new byte[4].AsSpan()));
    }

    [Fact]
    public void ParseG4pkm_ThrowsOnInvalidMagic()
    {
        var data = new byte[64];
        data[0] = (byte)'X'; data[1] = (byte)'X'; data[2] = (byte)'X'; data[3] = (byte)'X';
        Assert.Throws<InvalidDataException>(() =>
            G4pkmParser.ParseG4pkm(data.AsSpan()));
    }

    [Fact]
    public void ParseG4sk_ThrowsOnTooShort()
    {
        Assert.Throws<InvalidDataException>(() =>
            G4pkmParser.ParseG4sk(new byte[16].AsSpan()));
    }

    [Fact]
    public void ParseG4sk_ThrowsOnInvalidMagic()
    {
        var data = new byte[64];
        data[0] = (byte)'X'; data[1] = (byte)'X'; data[2] = (byte)'X'; data[3] = (byte)'X';
        Assert.Throws<InvalidDataException>(() =>
            G4pkmParser.ParseG4sk(data.AsSpan()));
    }

    // ── Transform2D.ToCss1280x720 ────────────────────────────────────────────

    [Fact]
    public void ToCss_CenterOriginMapsTo640x360()
    {
        var t = new Transform2D(0f, 0f, 100f, 100f, 0f, 0.5f, 0.5f);
        var (px, py) = t.ToCss1280x720();
        Assert.Equal(640f, px, 1f);
        Assert.Equal(360f, py, 1f);
    }

    [Fact]
    public void ToCss_RightEdge1920MapsTo1280()
    {
        // x=960 = bord droit du canvas 1920 (depuis centre)
        var t = new Transform2D(960f, 0f, 1f, 1f, 0f, 0.5f, 0.5f);
        var (px, _) = t.ToCss1280x720();
        Assert.Equal(1280f, px, 1f);
    }

    [Fact]
    public void ToCss_TopEdge1080MapsTo0()
    {
        // y=540 = bord haut du canvas 1080 (depuis centre, Y haut positif)
        var t = new Transform2D(0f, 540f, 1f, 1f, 0f, 0.5f, 0.5f);
        var (_, py) = t.ToCss1280x720();
        Assert.Equal(0f, py, 1f);
    }

    [Fact]
    public void ToCss_BottomEdge1080Maps720()
    {
        // y=-540 = bord bas du canvas 1080 (depuis centre, Y bas négatif)
        var t = new Transform2D(0f, -540f, 1f, 1f, 0f, 0.5f, 0.5f);
        var (_, py) = t.ToCss1280x720();
        Assert.Equal(720f, py, 1f);
    }

    [Fact]
    public void IsOffScreen_TrueWhenXExceeds960()
    {
        var t = new Transform2D(1873f, -39f, 0.65f, 0.9f, 0f, 0.5f, 0.5f);
        Assert.True(t.IsOffScreen1920);
    }

    [Fact]
    public void IsOffScreen_FalseWhenInsideScreen()
    {
        var t = new Transform2D(-40f, 40f, 80f, 80f, 0f, 0.5f, 0.5f);
        Assert.False(t.IsOffScreen1920);
    }

    // ── option02_02.g4pkm : calibration fullscreen ──────────────────────────

    [Fact]
    public void Parse_Option02_02_BoneCount4()
    {
        if (!HasFile("option02_02.g4pkm")) return;

        var layout = G4pkmParser.ParseG4pkm(G4pkmFile("option02_02.g4pkm"));
        Assert.Equal(4, layout.BoneCount);
    }

    [Fact]
    public void Parse_Option02_02_FullscreenBoneAtOriginWithScale1920x1080()
    {
        if (!HasFile("option02_02.g4pkm")) return;

        var layout = G4pkmParser.ParseG4pkm(G4pkmFile("option02_02.g4pkm"));

        // _license_nvidia_dmy01 : os fullscreen, position (0,0), échelle (1920,1080)
        var bone = layout.Bones.FirstOrDefault(b =>
            b.Name.Contains("nvidia") || b.Name.Contains("license"));

        Assert.NotNull(bone);
        var t = bone!.WorldBindPose;
        Assert.Equal(0f, t.X, 1f);
        Assert.Equal(0f, t.Y, 1f);
        Assert.Equal(1920f, t.ScaleX, 1f);
        Assert.Equal(1080f, t.ScaleY, 1f);
    }

    [Fact]
    public void Parse_Option02_02_RootChainIsIdentity()
    {
        if (!HasFile("option02_02.g4pkm")) return;

        var layout = G4pkmParser.ParseG4pkm(G4pkmFile("option02_02.g4pkm"));

        // Les 3 premiers bones (option02, option02_02_output, _pos_base01) sont identité
        foreach (var bone in layout.Bones.Take(3))
        {
            Assert.Equal(0f, bone.LocalBindPose.X, 1f);
            Assert.Equal(0f, bone.LocalBindPose.Y, 1f);
        }
    }

    [Fact]
    public void Parse_Option02_02_HasExpectedBoneNames()
    {
        if (!HasFile("option02_02.g4pkm")) return;

        var layout = G4pkmParser.ParseG4pkm(G4pkmFile("option02_02.g4pkm"));
        var names = layout.Bones.Select(b => b.Name).ToList();

        Assert.Contains(names, n => n.StartsWith("option02"));
        Assert.Contains(names, n => n.Contains("pos_base"));
    }

    // ── win00_04.g4pkm : curseur à position connue ───────────────────────────

    [Fact]
    public void Parse_Win00_04_BoneCount5()
    {
        if (!HasFile("win00_04.g4pkm")) return;

        var layout = G4pkmParser.ParseG4pkm(G4pkmFile("win00_04.g4pkm"));
        Assert.Equal(5, layout.BoneCount);
    }

    [Fact]
    public void Parse_Win00_04_CursorAt_Minus40_40_Size80x80()
    {
        if (!HasFile("win00_04.g4pkm")) return;

        var layout = G4pkmParser.ParseG4pkm(G4pkmFile("win00_04.g4pkm"));

        // _cursor01 : tx=-40, ty=40, sx=80, sy=80
        var cursor = layout.GetWorldPose("_cursor01");
        Assert.NotNull(cursor);

        Assert.Equal(-40f, cursor!.X, 1f);
        Assert.Equal(40f,  cursor!.Y, 1f);
        Assert.Equal(80f,  cursor!.ScaleX, 1f);
        Assert.Equal(80f,  cursor!.ScaleY, 1f);
    }

    [Fact]
    public void Parse_Win00_04_CursorCssPosition()
    {
        if (!HasFile("win00_04.g4pkm")) return;

        var layout = G4pkmParser.ParseG4pkm(G4pkmFile("win00_04.g4pkm"));
        var cursor = layout.GetWorldPose("_cursor01");
        Assert.NotNull(cursor);

        // pixel_x = 640 + (-40) * (1280/1920) = 640 - 26.67 ≈ 613
        // pixel_y = 360 - 40 * (720/1080) = 360 - 26.67 ≈ 333
        var (px, py) = cursor!.ToCss1280x720();
        Assert.InRange(px, 600f, 625f);
        Assert.InRange(py, 320f, 345f);
    }

    [Fact]
    public void Parse_Win00_04_CursorIsOnScreen()
    {
        if (!HasFile("win00_04.g4pkm")) return;

        var layout = G4pkmParser.ParseG4pkm(G4pkmFile("win00_04.g4pkm"));
        var cursor = layout.GetWorldPose("_cursor01");
        Assert.NotNull(cursor);
        Assert.False(cursor!.IsOffScreen1920);
    }

    [Fact]
    public void Parse_Win00_04_ParentHierarchyCorrect()
    {
        if (!HasFile("win00_04.g4pkm")) return;

        var layout = G4pkmParser.ParseG4pkm(G4pkmFile("win00_04.g4pkm"));

        // bone 0 (win00) → racine
        Assert.Equal(-1, layout.Bones[0].ParentIndex);
        // bone 1 (win00_04_output) → parent = 0
        Assert.Equal(0, layout.Bones[1].ParentIndex);
    }

    // ── title00_09.g4pkm : 20 bones, position cachée ─────────────────────────

    [Fact]
    public void Parse_Title00_09_BoneCount20()
    {
        if (!HasFile("title00_09.g4pkm")) return;

        var layout = G4pkmParser.ParseG4pkm(G4pkmFile("title00_09.g4pkm"));
        Assert.Equal(20, layout.BoneCount);
    }

    [Fact]
    public void Parse_Title00_09_HasExpectedBoneNames()
    {
        if (!HasFile("title00_09.g4pkm")) return;

        var layout = G4pkmParser.ParseG4pkm(G4pkmFile("title00_09.g4pkm"));
        var names = layout.Bones.Select(b => b.Name).ToList();

        // Bones attendus d'après la rétro-ingénierie
        Assert.Contains("title00", names);
        Assert.Contains("title00_09_output", names);
        Assert.Contains("_pos_base01", names);
        Assert.Contains("_pos_scl_base01", names);
        Assert.Contains("_gtxt_ver01", names);
        Assert.Contains("_gtxt_dot01", names);
        Assert.Contains("_num_ver01", names);
        Assert.Contains("_num_save01", names);
        Assert.Contains("_num_net01", names);
    }

    [Fact]
    public void Parse_Title00_09_RootBoneAtOrigin()
    {
        if (!HasFile("title00_09.g4pkm")) return;

        var layout = G4pkmParser.ParseG4pkm(G4pkmFile("title00_09.g4pkm"));

        // Les 3 premiers bones (title00, title00_09_output, _pos_base01) sont identité
        var root = layout.Bones.First(b => b.Name == "title00");
        Assert.Equal(0f, root.WorldBindPose.X, 1f);
        Assert.Equal(0f, root.WorldBindPose.Y, 1f);
        Assert.Equal(-1, root.ParentIndex);
    }

    [Fact]
    public void Parse_Title00_09_PosSclBase01_IsOffScreen()
    {
        if (!HasFile("title00_09.g4pkm")) return;

        var layout = G4pkmParser.ParseG4pkm(G4pkmFile("title00_09.g4pkm"));

        // _pos_scl_base01 : tx=1873 → hors-écran droite (pose bind = position cachée initiale)
        var t = layout.GetWorldPose("_pos_scl_base01");
        Assert.NotNull(t);
        Assert.True(t!.IsOffScreen1920,
            "_pos_scl_base01 doit être hors-écran dans la bind pose (tx ≈ 1873).");
        Assert.Equal(1873f, t!.X, 1f);
        Assert.Equal(-39f,  t!.Y, 1f);
    }

    [Fact]
    public void Parse_Title00_09_PosSclBase01_ScaleIsSubunit()
    {
        if (!HasFile("title00_09.g4pkm")) return;

        var layout = G4pkmParser.ParseG4pkm(G4pkmFile("title00_09.g4pkm"));
        var t = layout.GetWorldPose("_pos_scl_base01");
        Assert.NotNull(t);

        // sx=0.65, sy=0.9 (facteur d'échelle global du groupe)
        Assert.InRange(t!.ScaleX, 0.6f, 0.7f);
        Assert.InRange(t!.ScaleY, 0.85f, 0.95f);
    }

    [Fact]
    public void Parse_Title00_09_GtxtVer01_ScaleReasonable()
    {
        if (!HasFile("title00_09.g4pkm")) return;

        var layout = G4pkmParser.ParseG4pkm(G4pkmFile("title00_09.g4pkm"));
        var t = layout.GetWorldPose("_gtxt_ver01");
        Assert.NotNull(t);

        // ScaleX mondiale ≈ 0.65 * 104 ≈ 67.6, ScaleY ≈ 0.9 * 32.4 ≈ 29.16
        // Valeurs raisonnables pour un sprite de texte version
        Assert.InRange(t!.ScaleX, 50f, 90f);
        Assert.InRange(t!.ScaleY, 20f, 45f);
    }

    [Fact]
    public void Parse_Title00_09_Reproducible()
    {
        if (!HasFile("title00_09.g4pkm")) return;

        var layout1 = G4pkmParser.ParseG4pkm(G4pkmFile("title00_09.g4pkm"));
        var layout2 = G4pkmParser.ParseG4pkm(G4pkmFile("title00_09.g4pkm"));

        // Même nombre de bones
        Assert.Equal(layout1.BoneCount, layout2.BoneCount);

        // Mêmes transforms pour chaque bone
        for (int i = 0; i < layout1.BoneCount; i++)
        {
            var t1 = layout1.Bones[i].WorldBindPose;
            var t2 = layout2.Bones[i].WorldBindPose;
            Assert.Equal(t1.X, t2.X, 4f);
            Assert.Equal(t1.Y, t2.Y, 4f);
            Assert.Equal(t1.ScaleX, t2.ScaleX, 4f);
            Assert.Equal(t1.ScaleY, t2.ScaleY, 4f);
        }
    }

    [Fact]
    public void Parse_Title00_09_GetWorldPose_ReturnsNullForUnknownBone()
    {
        if (!HasFile("title00_09.g4pkm")) return;

        var layout = G4pkmParser.ParseG4pkm(G4pkmFile("title00_09.g4pkm"));
        Assert.Null(layout.GetWorldPose("_does_not_exist_bone_xyz"));
    }

    [Fact]
    public void Parse_Title00_09_AllBonesHaveNames()
    {
        if (!HasFile("title00_09.g4pkm")) return;

        var layout = G4pkmParser.ParseG4pkm(G4pkmFile("title00_09.g4pkm"));
        foreach (var bone in layout.Bones)
        {
            Assert.False(string.IsNullOrEmpty(bone.Name),
                $"Bone {bone.Index} n'a pas de nom.");
            Assert.DoesNotMatch(@"^Bone_\d+$", bone.Name);
        }
    }
}
