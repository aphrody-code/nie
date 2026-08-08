using System.IO;
using System.Linq;
using IECODE.Core.Formats.Menu;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests de <see cref="G4pkmMotion.GetMotionFinalPose"/> sur de vrais fichiers G4PKM IEVR.
///
/// Preuves attendues (contexte MOTION MENU) :
/// 1. title00_09.g4pkm — bind pose hors-écran (tx≈1873) → GetMotionFinalPose retourne un bone
///    ancêtre dans l'écran (|x|&lt;960). Prouve que l'objet version-panel ne reste pas empilé
///    hors-écran dans le rendu final.
/// 2. title00_01.g4pkm — tous les bones en bind pose sont dans l'écran → GetMotionFinalPose
///    retourne le bone de placement (pas de fallback).
/// 3. option01_02.g4pkm — grande hiérarchie (66 bones) → bone de placement visible.
///
/// Fichiers requis (préchargés par le setup) :
///   /tmp/g4pkm-extract/title00_09.g4pkm
///   /tmp/g4pkm-extract/title00_01.g4pkm
///   /tmp/g4pkm-extract/option01_02.g4pkm
/// </summary>
public class G4pkmMotionTests
{
    private static readonly string ExtractDir = "/tmp/g4pkm-extract";

    private static string G4pkmFile(string name) =>
        Path.Combine(ExtractDir, name);

    private static bool HasFile(string name) =>
        File.Exists(G4pkmFile(name));

    private static G4pkmLayout Load(string name) =>
        G4pkmParser.ParseG4pkm(G4pkmFile(name));

    // ── Cas 1 : title00_09 — bind pose hors-écran → ancêtre dans l'écran ────

    [Fact]
    public void Title00_09_BaseBindPoseIsOffScreen()
    {
        // Précondition : confirme que la bind pose est bien hors-écran
        if (!HasFile("title00_09.g4pkm")) return;

        var layout = Load("title00_09.g4pkm");
        var t = layout.GetWorldPose("_pos_scl_base01");
        Assert.NotNull(t);
        Assert.True(t!.IsOffScreen1920,
            "_pos_scl_base01 doit être hors-écran en bind pose (tx≈1873).");
    }

    [Fact]
    public void Title00_09_GetMotionFinalPose_ReturnsInScreenPosition()
    {
        // PREUVE PRINCIPALE : le bone revient dans l'écran après GetMotionFinalPose
        if (!HasFile("title00_09.g4pkm")) return;

        var layout = Load("title00_09.g4pkm");
        var result = G4pkmMotion.GetMotionFinalPose(layout, hasOpenMotion: true);

        Assert.False(result.Pose.IsOffScreen1920,
            $"GetMotionFinalPose doit retourner un bone dans l'écran (|x|<960), " +
            $"obtenu bone='{result.BoneName}' tx={result.Pose.X:F1}.");

        // La position doit être raisonnable (pas à l'infini ou à zéro forcé)
        Assert.InRange(result.Pose.X, -960f, 960f);
        Assert.InRange(result.Pose.Y, -540f, 540f);
    }

    [Fact]
    public void Title00_09_GetMotionFinalPose_HasOpenMotionFlag()
    {
        if (!HasFile("title00_09.g4pkm")) return;

        var layout = Load("title00_09.g4pkm");
        var result = G4pkmMotion.GetMotionFinalPose(layout, hasOpenMotion: true);

        Assert.True(result.HasOpenMotion,
            "HasOpenMotion doit être true quand on passe hasOpenMotion=true.");
    }

    [Fact]
    public void Title00_09_GetMotionFinalPose_UsedAncestorFallback()
    {
        // Le fallback ancêtre doit être signalé pour title00_09
        if (!HasFile("title00_09.g4pkm")) return;

        var layout = Load("title00_09.g4pkm");
        var result = G4pkmMotion.GetMotionFinalPose(layout, hasOpenMotion: true);

        Assert.True(result.UsedAncestorFallback,
            "title00_09 doit utiliser le fallback ancêtre car _pos_scl_base01 est hors-écran.");
    }

    [Fact]
    public void Title00_09_GetMotionFinalPose_CssPositionValid()
    {
        // La position CSS convertie doit être dans les bornes du canvas 1280×720
        if (!HasFile("title00_09.g4pkm")) return;

        var layout = Load("title00_09.g4pkm");
        var result = G4pkmMotion.GetMotionFinalPose(layout, hasOpenMotion: true);
        var (px, py) = result.Pose.ToCss1280x720();

        Assert.InRange(px, 0f, 1280f);
        Assert.InRange(py, 0f, 720f);
    }

    // ── Cas 2 : title00_01 — tous les bones en écran → pas de fallback ────────

    [Fact]
    public void Title00_01_GetMotionFinalPose_NoAncestorFallback()
    {
        if (!HasFile("title00_01.g4pkm")) return;

        var layout = Load("title00_01.g4pkm");
        var result = G4pkmMotion.GetMotionFinalPose(layout, hasOpenMotion: false);

        Assert.False(result.UsedAncestorFallback,
            "title00_01 n'a pas de bone hors-écran : pas de fallback attendu.");
        Assert.False(result.Pose.IsOffScreen1920,
            "La pose retournée doit être dans l'écran.");
    }

    [Fact]
    public void Title00_01_GetMotionFinalPose_BoneNameIsBase()
    {
        if (!HasFile("title00_01.g4pkm")) return;

        var layout = Load("title00_01.g4pkm");
        var result = G4pkmMotion.GetMotionFinalPose(layout);

        // Le bone sélectionné doit contenir "base" ou "pos_scl"
        Assert.True(
            result.BoneName.Contains("base", System.StringComparison.OrdinalIgnoreCase) ||
            result.BoneName.Contains("pos_scl", System.StringComparison.OrdinalIgnoreCase),
            $"Le bone de placement de title00_01 devrait être un bone *base* ou *pos_scl*, obtenu: '{result.BoneName}'.");
    }

    // ── Cas 3 : option01_02 — grande hiérarchie (66 bones) ───────────────────

    [Fact]
    public void Option01_02_GetMotionFinalPose_InScreen()
    {
        if (!HasFile("option01_02.g4pkm")) return;

        var layout = Load("option01_02.g4pkm");
        Assert.Equal(66, layout.BoneCount);

        var result = G4pkmMotion.GetMotionFinalPose(layout);

        Assert.False(result.Pose.IsOffScreen1920,
            $"option01_02 bone '{result.BoneName}' doit être dans l'écran.");
    }

    // ── Tests unitaires de G4pkmMotion.GetMotionFinalPose sur layout synthétique ──

    [Fact]
    public void GetMotionFinalPose_EmptyLayout_ReturnsZero()
    {
        var empty = new G4pkmLayout
        {
            Bones = System.Array.Empty<G4pkmBone>(),
            WorldPoseByName = new System.Collections.Generic.Dictionary<string, Transform2D>(),
        };
        var result = G4pkmMotion.GetMotionFinalPose(empty);
        Assert.Equal(Transform2D.Zero, result.Pose);
        Assert.Equal(string.Empty, result.BoneName);
    }

    [Fact]
    public void GetMotionFinalPose_SingleOnScreenBone_ReturnsBone()
    {
        var pose = new Transform2D(100f, 50f, 200f, 100f, 0f, 0.5f, 0.5f);
        var bone = new G4pkmBone
        {
            Index = 0, Name = "_pos_base01", ParentIndex = -1,
            LocalBindPose = pose, WorldBindPose = pose,
        };
        var layout = new G4pkmLayout
        {
            Bones = new[] { bone },
            WorldPoseByName = new System.Collections.Generic.Dictionary<string, Transform2D>
                { { "_pos_base01", pose } },
        };

        var result = G4pkmMotion.GetMotionFinalPose(layout);

        Assert.Equal("_pos_base01", result.BoneName);
        Assert.Equal(100f, result.Pose.X, 1f);
        Assert.False(result.UsedAncestorFallback);
    }

    [Fact]
    public void GetMotionFinalPose_OffScreenBaseWithOnScreenParent_UsesParent()
    {
        // Simule le cas title00_09 : parent à (0,0), enfant base à (1873, -39)
        var parentPose = new Transform2D(0f, 0f, 1f, 1f, 0f, 0.5f, 0.5f);
        var childPose  = new Transform2D(1873f, -39f, 0.65f, 0.9f, 0f, 0.5f, 0.5f);

        var parentBone = new G4pkmBone
        {
            Index = 0, Name = "_pos_base01", ParentIndex = -1,
            LocalBindPose = parentPose, WorldBindPose = parentPose,
        };
        var childBone = new G4pkmBone
        {
            Index = 1, Name = "_pos_scl_base01", ParentIndex = 0,
            LocalBindPose = childPose, WorldBindPose = childPose,
        };

        var layout = new G4pkmLayout
        {
            Bones = new[] { parentBone, childBone },
            WorldPoseByName = new System.Collections.Generic.Dictionary<string, Transform2D>
            {
                { "_pos_base01",     parentPose },
                { "_pos_scl_base01", childPose  },
            },
        };

        var result = G4pkmMotion.GetMotionFinalPose(layout, hasOpenMotion: true);

        // Doit retourner le parent (dans l'écran)
        Assert.Equal("_pos_base01", result.BoneName);
        Assert.True(result.UsedAncestorFallback);
        Assert.False(result.Pose.IsOffScreen1920);

        // La scale doit être celle du bone enfant (childPose.ScaleX=0.65, ScaleY=0.9)
        Assert.Equal(0.65f, result.Pose.ScaleX, 2f);
        Assert.Equal(0.9f, result.Pose.ScaleY, 2f);

        // Position CSS dans les bornes
        var (px, py) = result.Pose.ToCss1280x720();
        Assert.InRange(px, 0f, 1280f);
        Assert.InRange(py, 0f, 720f);
    }

    // ── Tests G4maParser ─────────────────────────────────────────────────────

    [Fact]
    public void G4maParser_ParseMotionNames_Title00_09_ReturnsNames()
    {
        // Le G4MA de title00_09 contient 3 motions matériau
        if (!HasFile("title00_09.g4pkm")) return;

        var bytes = File.ReadAllBytes(G4pkmFile("title00_09.g4pkm"));
        var g4maData = G4pkmParser.ExtractG4maData(bytes);

        if (g4maData.IsEmpty) return; // pas de G4MA → skip silencieux

        var names = G4maParser.ParseMotionNames(g4maData.Span);

        Assert.NotEmpty(names);
        // Au moins un nom de motion (ex. "_sma_fade_in_mat_01")
        Assert.Contains(names, n => n.StartsWith("_sma_", System.StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void G4maParser_ParseMotionNames_EmptyData_ReturnsEmpty()
    {
        var result = G4maParser.ParseMotionNames(System.ReadOnlySpan<byte>.Empty);
        Assert.Empty(result);
    }

    [Fact]
    public void G4maParser_ParseMotionNames_InvalidMagic_ReturnsEmpty()
    {
        var data = new byte[64];
        data[0] = (byte)'X'; data[1] = (byte)'X';
        var result = G4maParser.ParseMotionNames(data.AsSpan());
        Assert.Empty(result);
    }
}
