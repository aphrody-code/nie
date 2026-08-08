using System.CommandLine;
using IECODE.Core.Formats.Shader;
using IECODE.Core.Formats.Level5;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande 'shader' — inspection des formats de shaders/effets d'IEVR :
///   .vfxo (vertex shaders DXBC) / .pfxo (pixel shaders DXBC) → DxbcReader
///   .fxbin (table ShaderFX cfg.bin liant techniques/passes ↔ shaders) → FxbinParser
/// </summary>
public static class ShaderCommand
{
    public static Command Create()
    {
        var command = new Command("shader", "Inspect IEVR shader/effect files (.vfxo/.pfxo DXBC, .fxbin ShaderFX)");

        // info
        var infoCommand = new Command("info", "Display shader file information");
        var infoFileArg = new Argument<string>("file", "Path to .vfxo/.pfxo/.fxbin file");
        infoCommand.AddArgument(infoFileArg);
        infoCommand.SetHandler((string file) => Info(file), infoFileArg);
        command.AddCommand(infoCommand);

        // batch
        var batchCommand = new Command("batch", "Scan a directory of shader files and report a summary");
        var batchDirArg = new Argument<string>("directory", "Directory to scan");
        batchCommand.AddArgument(batchDirArg);
        var recursiveOption = new Option<bool>(["--recursive", "-r"], () => true, "Search recursively");
        batchCommand.AddOption(recursiveOption);
        batchCommand.SetHandler((string dir, bool recursive) => Batch(dir, recursive), batchDirArg, recursiveOption);
        command.AddCommand(batchCommand);

        return command;
    }

    private static void Info(string filePath)
    {
        if (!File.Exists(filePath))
        {
            Console.WriteLine($"File not found: {filePath}");
            Environment.ExitCode = 1;
            return;
        }

        var ext = Path.GetExtension(filePath).ToLowerInvariant();
        var data = File.ReadAllBytes(filePath);
        Console.WriteLine($"File: {Path.GetFileName(filePath)} ({data.Length:N0} bytes)");

        try
        {
            if (ext is ".vfxo" or ".pfxo" or ".cfxo" or ".gfxo" || DxbcReader.IsDxbc(data))
            {
                var dx = DxbcReader.Parse(data);
                Console.WriteLine("Format: DXBC (DirectX Byte Code)");
                Console.WriteLine($"  Version:       {dx.Version & 0xFF}.{(dx.Version >> 8) & 0xFF}");
                Console.WriteLine($"  Program type:  {dx.ProgramType}");
                Console.WriteLine($"  Shader model:  {dx.ShaderModelMajor}.{dx.ShaderModelMinor}");
                Console.WriteLine($"  Total size:    {dx.TotalSize:N0} bytes");
                if (dx.Creator != null) Console.WriteLine($"  Creator:       {dx.Creator}");
                Console.WriteLine($"  Chunks ({dx.Chunks.Count}):");
                foreach (var c in dx.Chunks)
                    Console.WriteLine($"    {c.FourCc}  @0x{c.Offset:X}  {c.Size:N0} bytes");
            }
            else if (ext == ".fxbin" || FxbinParser.LooksLikeFxbin(data))
            {
                var fx = FxbinParser.Parse(data);
                Console.WriteLine("Format: FXBIN (ShaderFX technique/pass table, cfg.bin/T2B)");
                Console.WriteLine($"  Member count:  {fx.MemberCount}");
                Console.WriteLine($"  Techniques:    {fx.Techniques.Count}");
                foreach (var tec in fx.Techniques)
                {
                    Console.WriteLine($"    technique '{tec.Name}' ({tec.Passes.Count} pass)");
                    foreach (var p in tec.Passes)
                        Console.WriteLine($"      pass '{p.Name}'  VS={p.VertexShader}  PS={p.PixelShader}");
                }
                Console.WriteLine($"  String refs:   {fx.References.Count}");
            }
            else
            {
                Console.WriteLine("Format: unrecognized (not DXBC, not cfg.bin/T2B).");
                Environment.ExitCode = 1;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error: {ex.Message}");
            Environment.ExitCode = 1;
        }
    }

    private static void Batch(string directory, bool recursive)
    {
        if (!Directory.Exists(directory))
        {
            Console.WriteLine($"Directory not found: {directory}");
            Environment.ExitCode = 1;
            return;
        }

        var opt = recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
        string[] shaderExts = [".vfxo", ".pfxo", ".cfxo", ".gfxo", ".fxbin"];
        var files = Directory.GetFiles(directory, "*.*", opt)
            .Where(f => shaderExts.Any(e => f.EndsWith(e, StringComparison.OrdinalIgnoreCase)))
            .ToArray();

        int vfxo = 0, pfxo = 0, cfxo = 0, gfxo = 0, fxbin = 0, errors = 0;
        int vsShaders = 0, psShaders = 0, csShaders = 0, gsShaders = 0, totalTechniques = 0, totalPasses = 0;

        foreach (var f in files)
        {
            try
            {
                var ext = Path.GetExtension(f).ToLowerInvariant();
                var data = File.ReadAllBytes(f);
                if (ext is ".vfxo" or ".pfxo" or ".cfxo" or ".gfxo" || DxbcReader.IsDxbc(data))
                {
                    var dx = DxbcReader.Parse(data);
                    switch (ext)
                    {
                        case ".pfxo": pfxo++; break;
                        case ".cfxo": cfxo++; break;
                        case ".gfxo": gfxo++; break;
                        default: vfxo++; break;
                    }
                    switch (dx.ProgramType)
                    {
                        case DxbcProgramType.Vertex: vsShaders++; break;
                        case DxbcProgramType.Pixel: psShaders++; break;
                        case DxbcProgramType.Compute: csShaders++; break;
                        case DxbcProgramType.Geometry: gsShaders++; break;
                    }
                }
                else if (ext == ".fxbin" || FxbinParser.LooksLikeFxbin(data))
                {
                    var fx = FxbinParser.Parse(data);
                    fxbin++;
                    totalTechniques += fx.Techniques.Count;
                    totalPasses += fx.Techniques.Sum(t => t.Passes.Count);
                }
            }
            catch
            {
                errors++;
            }
        }

        Console.WriteLine($"Scanned {files.Length} shader file(s) in {directory}");
        Console.WriteLine($"  .vfxo (vertex):   {vfxo}  (DXBC VS={vsShaders})");
        Console.WriteLine($"  .pfxo (pixel):    {pfxo}  (DXBC PS={psShaders})");
        if (cfxo > 0) Console.WriteLine($"  .cfxo (compute):  {cfxo}  (DXBC CS={csShaders})");
        if (gfxo > 0) Console.WriteLine($"  .gfxo (geometry): {gfxo}  (DXBC GS={gsShaders})");
        Console.WriteLine($"  .fxbin:           {fxbin}  (techniques={totalTechniques}, passes={totalPasses})");
        if (errors > 0) Console.WriteLine($"  errors:           {errors}");
    }
}
