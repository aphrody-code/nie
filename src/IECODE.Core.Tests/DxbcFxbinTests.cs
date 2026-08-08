using System.IO;
using System.Linq;
using IECODE.Core.Formats.Level5;
using IECODE.Core.Formats.Shader;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests des lecteurs de shaders/effets IEVR (DxbcReader pour .vfxo/.pfxo,
/// FxbinParser pour .fxbin) contre de VRAIS fichiers extraits sous /tmp/s.
/// Les tests dépendant des fichiers réels sont skippés si ceux-ci sont absents.
/// </summary>
public class DxbcFxbinTests
{
    private const string ShaderDir = "/tmp/s/fxbin/data/dx11/shader/1.00.41";

    private static bool HasSamples() => Directory.Exists(ShaderDir);

    [Fact]
    public void IsDxbc_DetectsMagic()
    {
        Assert.True(DxbcReader.IsDxbc(new byte[] { (byte)'D', (byte)'X', (byte)'B', (byte)'C', 0 }));
        Assert.False(DxbcReader.IsDxbc(new byte[] { 0x01, 0x74, 0x32, 0x62 }));
    }

    [Fact]
    public void Vfxo_ParsesAsVertexShader()
    {
        if (!HasSamples()) return;
        var path = Path.Combine(ShaderDir, "zone_effect.vfxo");
        if (!File.Exists(path)) return;

        var dx = DxbcReader.Parse(path);
        Assert.Equal(DxbcProgramType.Vertex, dx.ProgramType);
        Assert.Equal(5, dx.ShaderModelMajor);
        Assert.Contains(dx.Chunks, c => c.FourCc == "SHEX");
        Assert.Contains(dx.Chunks, c => c.FourCc == "RDEF");
    }

    [Fact]
    public void Pfxo_ParsesAsPixelShader()
    {
        if (!HasSamples()) return;
        var path = Path.Combine(ShaderDir, "zone_effect.pfxo");
        if (!File.Exists(path)) return;

        var dx = DxbcReader.Parse(path);
        Assert.Equal(DxbcProgramType.Pixel, dx.ProgramType);
        Assert.Equal(5, dx.ShaderModelMajor);
    }

    [Fact]
    public void Fxbin_ParsesTechniquesAndPasses()
    {
        if (!HasSamples()) return;
        var path = Path.Combine(ShaderDir, "zone_effect.fxbin");
        if (!File.Exists(path)) return;

        var fx = FxbinParser.Parse(path);
        Assert.NotEmpty(fx.Techniques);
        var tec = fx.Techniques[0];
        Assert.NotEmpty(tec.Passes);
        var pass = tec.Passes[0];
        Assert.Equal("zone_effect", pass.VertexShader);
        Assert.Equal("zone_effect", pass.PixelShader);
    }

    [Fact]
    public void Batch_AllRealShadersParse()
    {
        if (!HasSamples()) return;
        string[] exts = [".vfxo", ".pfxo", ".cfxo", ".gfxo"];
        var dxbcFiles = Directory.GetFiles(ShaderDir)
            .Where(f => exts.Any(e => f.EndsWith(e)))
            .ToArray();
        if (dxbcFiles.Length == 0) return;

        foreach (var f in dxbcFiles)
        {
            var dx = DxbcReader.Parse(f);
            Assert.NotEqual(DxbcProgramType.Unknown, dx.ProgramType);
        }

        var fxbinFiles = Directory.GetFiles(ShaderDir, "*.fxbin");
        foreach (var f in fxbinFiles)
        {
            var fx = FxbinParser.Parse(f);
            Assert.NotEmpty(fx.Techniques);
        }
    }
}
