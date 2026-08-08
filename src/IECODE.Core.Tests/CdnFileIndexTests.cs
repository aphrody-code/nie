using IECODE.Core.Cdn;
using IECODE.Core.Config;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests de logique pure du cœur CDN : index cpk_list → CPK, normalisation, ETag, media-types.
/// (Le chemin d'extraction réel est validé end-to-end contre l'install jeu, hors CI.)
/// </summary>
public class CdnFileIndexTests
{
    private static CpkListData List(params CpkListEntry[] files) => new() { Files = files.ToList() };

    private static CpkListEntry Entry(string dir, string name, string cpk, long size = 100) =>
        new() { Directory = dir, FileName = name, CpkName = cpk, FileSize = size };

    [Fact]
    public void Build_indexes_packed_files_and_skips_loose()
    {
        var data = List(
            Entry("data/common/", "a.cfg.bin", "pack1.cpk"),
            Entry("data/common/", "loose.bin", "")); // loose → ignoré

        var idx = CpkFileIndex.Build(data, "/game/packs");

        Assert.Equal(1, idx.Count);
        Assert.True(idx.TryResolve("data/common/a.cfg.bin", out var loc));
        Assert.Equal("pack1.cpk", loc.CpkName);
        Assert.Equal(Path.Combine("/game/packs", "pack1.cpk"), loc.CpkPath);
    }

    [Fact]
    public void TryResolve_is_case_and_slash_insensitive()
    {
        var idx = CpkFileIndex.Build(List(Entry("data/dx11/chr/", "Face.g4tx", "p.cpk")), "/p");

        Assert.True(idx.TryResolve("DATA\\DX11\\CHR\\FACE.G4TX", out var loc));
        Assert.Equal("p.cpk", loc.CpkName);
        Assert.True(idx.TryResolve("/data/dx11/chr/face.g4tx", out _)); // slash de tête toléré
    }

    [Fact]
    public void Override_base_patch_last_wins()
    {
        // Même chemin dans deux CPK (base puis patch) : la dernière entrée gagne.
        var data = List(
            Entry("data/", "x.bin", "base.cpk", 10),
            Entry("data/", "x.bin", "patch.cpk", 20));

        var idx = CpkFileIndex.Build(data, "/p");

        Assert.Equal(1, idx.Count);
        Assert.True(idx.TryResolve("data/x.bin", out var loc));
        Assert.Equal("patch.cpk", loc.CpkName);
        Assert.Equal(20, loc.Size);
    }

    [Fact]
    public void ETag_is_stable_and_distinguishes_build_size_and_path()
    {
        var a = CpkFileIndex.Build(List(Entry("d/", "f", "c.cpk", 100)), "/p", "BUILD1");
        var b = CpkFileIndex.Build(List(Entry("d/", "f", "c.cpk", 100)), "/p", "BUILD2");
        a.TryResolve("d/f", out var la);
        b.TryResolve("d/f", out var lb);

        Assert.Equal(a.ETag(la), a.ETag(la));      // stable
        Assert.NotEqual(a.ETag(la), b.ETag(lb));   // buildid différent → ETag différent
    }

    [Fact]
    public void Unknown_path_resolves_false()
    {
        var idx = CpkFileIndex.Build(List(Entry("d/", "f", "c.cpk")), "/p");
        Assert.False(idx.TryResolve("d/nope", out _));
    }

    [Theory]
    [InlineData("foo/bar.cfg.bin", "application/vnd.level5.cfgbin")]
    [InlineData("a/b.g4tx", "application/vnd.level5.g4tx")]
    [InlineData("a/movie.usm", "application/vnd.criware.usm")]
    [InlineData("a/sound.acb", "application/vnd.criware.acb")]
    [InlineData("a/pic.png", "image/png")]
    [InlineData("a/data.json", "application/json")]
    [InlineData("a/unknown.zzz", "application/octet-stream")]
    [InlineData("a/no_extension", "application/octet-stream")]
    public void MediaType_mapping(string path, string expected)
    {
        Assert.Equal(expected, CdnMediaTypes.ForPath(path));
    }
}
