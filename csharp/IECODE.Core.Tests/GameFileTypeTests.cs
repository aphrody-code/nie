using System;
using IECODE.Core.Formats;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests de détection des magics réels (<see cref="GameFileType"/>).
/// Tous les tests sur magic bytes sont purs (pas de fichiers disque requis).
/// Les tests sur fichiers réels sont passés silencieusement si les fichiers sont absents.
/// </summary>
public class GameFileTypeTests
{
    // ── Détection par magic bytes (purs, sans disque) ─────────────────────────

    [Theory]
    [InlineData(new byte[] { 0x47, 0x34, 0x54, 0x58 }, GameFileKind.G4Texture)]        // G4TX
    [InlineData(new byte[] { 0x47, 0x34, 0x50, 0x4B, 0x40, 0x00 }, GameFileKind.G4Package)]      // G4PK@
    [InlineData(new byte[] { 0x47, 0x34, 0x50, 0x4B, 0x4D, 0x00 }, GameFileKind.G4PackageMenu)]  // G4PKM
    [InlineData(new byte[] { 0x47, 0x34, 0x53, 0x4B, 0x40, 0x00 }, GameFileKind.G4Skeleton)]     // G4SK@
    [InlineData(new byte[] { 0x47, 0x34, 0x4D, 0x44 }, GameFileKind.G4ModelData)]     // G4MDP
    [InlineData(new byte[] { 0x47, 0x34, 0x4D, 0x47 }, GameFileKind.G4ModelGroup)]    // G4MG
    [InlineData(new byte[] { 0x47, 0x34, 0x4D, 0x54 }, GameFileKind.G4Material)]      // G4MT
    [InlineData(new byte[] { 0x47, 0x34, 0x4D, 0x41 }, GameFileKind.G4Motion)]        // G4MA
    [InlineData(new byte[] { 0x47, 0x34, 0x52, 0x41 }, GameFileKind.G4ResourceArchive)] // G4RA
    [InlineData(new byte[] { 0x52, 0x44, 0x42, 0x4E }, GameFileKind.CfgBin)]          // RDBN
    [InlineData(new byte[] { 0x43, 0x50, 0x4B, 0x20 }, GameFileKind.CpkArchive)]      // CPK
    [InlineData(new byte[] { 0x41, 0x46, 0x53, 0x32 }, GameFileKind.Afs2Archive)]     // AFS2
    [InlineData(new byte[] { 0x40, 0x55, 0x54, 0x46 }, GameFileKind.CriUtfTable)]     // @UTF
    [InlineData(new byte[] { 0x1B, 0x4C, 0x75, 0x61 }, GameFileKind.LuaBytecode)]     // \x1bLua
    [InlineData(new byte[] { 0x6F, 0x62, 0x6A, 0x62 }, GameFileKind.ObjBinary)]       // objb
    [InlineData(new byte[] { 0x50, 0x58, 0x43, 0x4C }, GameFileKind.PxclData)]        // PXCL
    [InlineData(new byte[] { 0x58, 0x46, 0x53, 0x41 }, GameFileKind.XfsaArchive)]     // XFSA
    [InlineData(new byte[] { 0x58, 0x50, 0x43, 0x4B }, GameFileKind.XpckPackage)]     // XPCK
    [InlineData(new byte[] { 0x43, 0x52, 0x49, 0x4C, 0x41, 0x59, 0x4C, 0x41 }, GameFileKind.CriLaylaCompressed)] // CRILAYLA
    public void Detect_Magic_ReturnsCorrectKind(byte[] magic, GameFileKind expected)
    {
        Assert.Equal(expected, GameFileType.Detect(magic));
    }

    [Fact]
    public void Detect_UnknownMagic_ReturnsUnknown()
    {
        byte[] unknown = [0xDE, 0xAD, 0xBE, 0xEF];
        Assert.Equal(GameFileKind.Unknown, GameFileType.Detect(unknown));
    }

    [Fact]
    public void Detect_TooShort_ReturnsUnknown()
    {
        byte[] tooShort = [0x47, 0x34];
        Assert.Equal(GameFileKind.Unknown, GameFileType.Detect(tooShort));
    }

    [Fact]
    public void Detect_G4PK_WithoutFifthByte_ReturnsG4Package()
    {
        // G4PK sans 5e octet → G4Package (paquet standard)
        byte[] g4pk = [0x47, 0x34, 0x50, 0x4B];
        Assert.Equal(GameFileKind.G4Package, GameFileType.Detect(g4pk));
    }

    // ── T2B footer via DetectFromData ─────────────────────────────────────────

    [Fact]
    public void DetectFromData_T2bFooter_ReturnsCfgBin()
    {
        // Crée un buffer avec le footer T2B (01 74 32 62) à la fin
        byte[] data = new byte[16];
        new Random(42).NextBytes(data);
        // Force un magic inconnu au début pour s'assurer que c'est le footer qui décide
        data[0] = 0x00; data[1] = 0x00; data[2] = 0x00; data[3] = 0x01;
        // Footer
        data[^4] = 0x01; data[^3] = 0x74; data[^2] = 0x32; data[^1] = 0x62;

        Assert.Equal(GameFileKind.CfgBin, GameFileType.DetectFromData(data));
    }

    [Fact]
    public void DetectFromData_RdbnMagic_ReturnsCfgBin()
    {
        byte[] rdbn = new byte[32];
        rdbn[0] = 0x52; rdbn[1] = 0x44; rdbn[2] = 0x42; rdbn[3] = 0x4E; // RDBN
        Assert.Equal(GameFileKind.CfgBin, GameFileType.DetectFromData(rdbn));
    }

    // ── GetInfo ────────────────────────────────────────────────────────────────

    [Fact]
    public void GetInfo_G4Texture_ReturnsMagicG4TX()
    {
        var info = GameFileType.GetInfo(GameFileKind.G4Texture);
        Assert.NotNull(info);
        Assert.Equal("G4TX", info!.Magic);
        Assert.Equal("texture", info.TsKind);
    }

    [Fact]
    public void GetInfo_Unknown_ReturnsNull()
    {
        var info = GameFileType.GetInfo(GameFileKind.Unknown);
        Assert.Null(info);
    }

    [Fact]
    public void KnownTypes_AllHaveNonEmptyMagicAndKind()
    {
        foreach (var t in GameFileType.KnownTypes)
        {
            Assert.False(string.IsNullOrEmpty(t.Magic),      $"{t.Kind} : Magic vide");
            Assert.False(string.IsNullOrEmpty(t.TsKind),     $"{t.Kind} : TsKind vide");
            Assert.False(string.IsNullOrEmpty(t.Extension),  $"{t.Kind} : Extension vide");
        }
    }

    // ── Fichiers réels (skip si absents) ─────────────────────────────────────

    [Fact]
    public void Detect_RealRdbnFile_ReturnsCfgBin()
    {
        string path = Path.Combine(TestDataPaths.DataRoot, "common", "gamedata", "event", "event_movie_config_0.00.00.cfg.bin");
        if (!File.Exists(path)) return;

        var kind = GameFileType.Detect(path);
        Assert.Equal(GameFileKind.CfgBin, kind);
    }

    [Fact]
    public void Detect_RealLuaFile_ReturnsLuaBytecode()
    {
        string path = Path.Combine(TestDataPaths.DataRoot, "common", "script", "lua", "menu", "qrcode_menu.lua.bin");
        if (!File.Exists(path)) return;

        var kind = GameFileType.Detect(path);
        Assert.Equal(GameFileKind.LuaBytecode, kind);
    }
}
