using IECODE.Core.Util;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests de l'algorithme de hash LEVEL-5 (CRC32 standard réfléchi, poly 0xEDB88320).
///
/// Toutes les paires (nom, hash) ci-dessous sont RÉELLES : extraites des tables de
/// clés de fichiers cfg.bin/objbin du jeu (le fichier stocke le hash 32-bit à côté
/// du nom en clair, ce qui permet la vérification directe).
///
/// Sources :
///   • cmd_tag_config_2.00.17.00.cfg.bin  (CMD_TAG_*)
///   • soccer20_12_tactics_information.objbin  (OBJ_BGN, SETUP_*, PROP_INFO_*)
///   • menu_group_capture_config.cfg.bin  (GROUP_CAPTURE_*)
/// </summary>
public class Level5HashTests
{
    // ── Paires réelles tirées de cmd_tag_config_2.00.17.00.cfg.bin ───────────

    [Theory]
    [InlineData("CMD_TAG_PAD_LIST_BEG",             0xCB189152u)]
    [InlineData("CMD_TAG_PAD",                       0xDE5DABCEu)]
    [InlineData("CMD_TAG_KEYBOARD_MOUSE_LIST_BEG",  0xCB618B68u)]
    [InlineData("CMD_TAG_KEYBOARD_MOUSE",            0xCE4E7342u)]
    [InlineData("CMD_TAG_INFO_LIST_BEG",             0x600C5121u)]
    [InlineData("CMD_TAG_INFO",                      0x5C183C3Au)]
    [InlineData("CMD_TAG_INFO_REF_PAD",              0xDBE1188Du)]
    [InlineData("CMD_TAG_INFO_REF_KEYBOARD_MOUSE",   0x0295017Bu)]
    [InlineData("CMD_TAG_INFO_LIST_END",             0x1FBECFD5u)]
    public void Hash_CfgBin_CmdTagConfig(string name, uint expectedHash)
    {
        Assert.Equal(expectedHash, Level5Hash.Hash(name));
    }

    // ── Paires réelles tirées de soccer20_12_tactics_information.objbin ──────

    [Theory]
    [InlineData("OBJ_BGN",        0xB1D0C26Eu)]
    [InlineData("SETUP_BGN",      0xB14DCDB0u)]
    [InlineData("SETUP_PARAM",    0x8BB13144u)]
    [InlineData("SETUP_END",      0x85158962u)]
    [InlineData("PROP_INFO_BGN",  0x689952A2u)]
    [InlineData("PROP_PARAM",     0xBD064D3Eu)]
    [InlineData("PROP_INFO_END",  0x5CC11670u)]
    [InlineData("OBJ_END",        0x858886BCu)]
    public void Hash_Objbin_SoccerTacticsInformation(string name, uint expectedHash)
    {
        Assert.Equal(expectedHash, Level5Hash.Hash(name));
    }

    // ── Paires réelles tirées de menu_group_capture_config.cfg.bin ───────────

    [Theory]
    [InlineData("GROUP_CAPTURE_INFO_LIST_BEG", 0x57BBB0C1u)]
    [InlineData("GROUP_CAPTURE_INFO",           0xE07BCBBCu)]
    [InlineData("GROUP_CAPTURE_INFO_LIST_END",  0x28092E35u)]
    public void Hash_CfgBin_GroupCaptureConfig(string name, uint expectedHash)
    {
        Assert.Equal(expectedHash, Level5Hash.Hash(name));
    }

    // ── Cas limites ───────────────────────────────────────────────────────────

    [Fact]
    public void Hash_EmptyString_ReturnsKnownCrc32()
    {
        // CRC32("") = 0x00000000 (seed=0xFFFFFFFF, ~0xFFFFFFFF = 0x00000000)
        Assert.Equal(0x00000000u, Level5Hash.Hash(string.Empty));
    }

    [Fact]
    public void Hash_SpanOverload_MatchesStringOverload()
    {
        const string name = "CMD_TAG_PAD";
        byte[] bytes = System.Text.Encoding.UTF8.GetBytes(name);
        Assert.Equal(Level5Hash.Hash(name), Level5Hash.Hash(bytes));
    }

    [Fact]
    public void ToHex_FormatsCorrectly()
    {
        Assert.Equal("CB189152", Level5Hash.ToHex(0xCB189152u));
        Assert.Equal("00000000", Level5Hash.ToHex(0u));
        Assert.Equal("FFFFFFFF", Level5Hash.ToHex(uint.MaxValue));
    }

    [Theory]
    [InlineData("0xCB189152", 0xCB189152u, true)]
    [InlineData("CB189152",   0xCB189152u, true)]
    [InlineData("0xcb189152", 0xCB189152u, true)]
    [InlineData("ZZZZ",       0u,          false)]
    public void TryParseHex(string input, uint expected, bool expectedOk)
    {
        bool ok = Level5Hash.TryParseHex(input, out uint hash);
        Assert.Equal(expectedOk, ok);
        if (expectedOk)
            Assert.Equal(expected, hash);
    }

    // ── Cohérence avec l'implémentation CfgBin.Tools.Crc32 déjà en place ─────

    [Theory]
    [InlineData("CMD_TAG_PAD_LIST_BEG",  0xCB189152u)]
    [InlineData("OBJ_BGN",               0xB1D0C26Eu)]
    [InlineData("GROUP_CAPTURE_INFO",    0xE07BCBBCu)]
    public void Hash_ConsistentWithCfgBinCrc32(string name, uint expectedHash)
    {
        // Level5Hash.Hash doit donner le même résultat que
        // IECODE.Core.Formats.Level5.CfgBin.Tools.Crc32.Compute (même algo, même poly)
        uint fromLevel5Hash = Level5Hash.Hash(name);
        uint fromCfgBinCrc32 = IECODE.Core.Formats.Level5.CfgBin.Tools.Crc32.Compute(
            System.Text.Encoding.UTF8.GetBytes(name));

        Assert.Equal(expectedHash, fromLevel5Hash);
        Assert.Equal(fromLevel5Hash, fromCfgBinCrc32);
    }
}
