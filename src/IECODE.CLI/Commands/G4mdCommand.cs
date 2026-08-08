using System.CommandLine;
using IECODE.Core.Converters;
using IECODE.Core.Formats.Level5;
using IECODE.Core.Logging;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commands for G4MD (Level-5 Model Data) files.
/// </summary>
public static class G4mdCommand
{
    public static Command Create()
    {
        var command = new Command("g4md", "Parse and convert G4MD model files");

        command.AddCommand(CreateInfoCommand());
        command.AddCommand(CreateExportCommand());
        command.AddCommand(CreateToGlbCommand());

        return command;
    }

    /// <summary>
    /// Serialize a complete G4mdInfo to indented JSON (AOT-safe via JsonContext).
    /// </summary>
    private static string SerializeInfo(G4mdParser.G4mdInfo info)
    {
        return System.Text.Json.JsonSerializer.Serialize(info, IECODE.CLI.JsonContext.Default.G4mdInfo);
    }

    // -------------------------------------------------------------------------
    // g4md info <file> [-o <json>]
    // -------------------------------------------------------------------------

    private static Command CreateInfoCommand()
    {
        var cmd = new Command("info", "Display G4MD file information");
        var fileArg = new Argument<string>("file", "Path to G4MD file");
        var outputOpt = new Option<string?>(["--output", "-o"], "Output JSON file");
        cmd.AddArgument(fileArg);
        cmd.AddOption(outputOpt);

        cmd.SetHandler((string file, string? output) =>
        {
            if (!File.Exists(file))
            {
                Console.Error.WriteLine($"File not found: {file}");
                return;
            }

            var parser = new G4mdParser();
            parser.Parse(file);

            Console.WriteLine($"G4MD: {Path.GetFileName(file)}");
            Console.WriteLine($"  Magic:        0x{parser.Header.Magic:X8}");
            Console.WriteLine($"  HeaderSize:   {parser.Header.HeaderSize}");
            Console.WriteLine($"  TypeId:       {parser.Header.TypeId}");
            Console.WriteLine($"  SubmeshCount: {parser.Header.SubmeshCount}");
            Console.WriteLine($"  TotalCount:   {parser.Header.TotalCount}");
            Console.WriteLine($"  Vertices:     {parser.Header.VertexCount}");
            Console.WriteLine($"  Faces:        {parser.Header.FaceCount}");
            Console.WriteLine($"  Bones:        {parser.Header.BoneCount}");
            Console.WriteLine($"  Bounds:       min({parser.Bounds.MinX:0.###}, {parser.Bounds.MinY:0.###}, {parser.Bounds.MinZ:0.###}) max({parser.Bounds.MaxX:0.###}, {parser.Bounds.MaxY:0.###}, {parser.Bounds.MaxZ:0.###})");
            Console.WriteLine($"  TextureRefs ({parser.TextureRefs.Count}): {string.Join(", ", parser.TextureRefs)}");
            Console.WriteLine($"  MaterialBaseNames ({parser.MaterialBaseNames.Count}): {string.Join(", ", parser.MaterialBaseNames)}");
            Console.WriteLine($"  Submeshes ({parser.Submeshes.Count}):");

            foreach (var mesh in parser.Submeshes)
            {
                Console.WriteLine($"    {mesh.Name}");
                Console.WriteLine($"      Indices:  {mesh.IndexCount}  @ 0x{mesh.IndexBufferOffset:X}  ({mesh.IndexBufferSize} bytes)");
                Console.WriteLine($"      Vertices: {mesh.VertexCount} @ 0x{mesh.VertexBufferOffset:X}");
                Console.WriteLine($"      Material: {mesh.MaterialIndex} -> {parser.GetMaterialBaseName(mesh.MaterialIndex) ?? "(none)"}");
            }

            if (output != null)
            {
                var info = parser.GetInfo(Path.GetFileNameWithoutExtension(file));
                File.WriteAllText(output, SerializeInfo(info));
                Console.WriteLine($"Info exported to: {output}");
            }

        }, fileArg, outputOpt);

        return cmd;
    }

    // -------------------------------------------------------------------------
    // g4md export <file> -o <json>
    //   Exporte les métadonnées complètes (header, bbox, submeshes, bones,
    //   texture_refs) en JSON structuré.
    // -------------------------------------------------------------------------

    private static Command CreateExportCommand()
    {
        var cmd = new Command("export", "Export complete G4MD metadata to a JSON file");
        var fileArg = new Argument<string>("file", "Path to G4MD file");
        var outputOpt = new Option<string?>(["--output", "-o"], "Output JSON file (default: <file>.json)");
        cmd.AddArgument(fileArg);
        cmd.AddOption(outputOpt);

        cmd.SetHandler((string file, string? output) =>
        {
            if (!File.Exists(file))
            {
                Console.Error.WriteLine($"File not found: {file}");
                return;
            }

            output ??= Path.ChangeExtension(file, ".json");

            var parser = new G4mdParser();
            parser.Parse(file);

            var info = parser.GetInfo(Path.GetFileNameWithoutExtension(file));
            File.WriteAllText(output, SerializeInfo(info));
            Console.WriteLine($"OK: {output} ({info.Submeshes.Count} submeshes, {info.TextureRefs.Count} texture refs)");

        }, fileArg, outputOpt);

        return cmd;
    }

    // -------------------------------------------------------------------------
    // g4md to-glb <file> [-o <output.glb>]
    // -------------------------------------------------------------------------

    private static Command CreateToGlbCommand()
    {
        var cmd = new Command("to-glb", "Convert G4MD + associated G4MG to GLB");
        var fileArg = new Argument<string>("file", "Path to G4MD file");
        var outputOpt = new Option<string?>(["--output", "-o"], "Output GLB file (default: next to input)");
        cmd.AddArgument(fileArg);
        cmd.AddOption(outputOpt);

        cmd.SetHandler((string file, string? output) =>
        {
            if (!File.Exists(file))
            {
                Console.Error.WriteLine($"File not found: {file}");
                return;
            }

            output ??= Path.ChangeExtension(file, ".glb");

            try
            {
                var converter = new AssetConverterFacade();
                converter.ConvertG4md(file, output);
                Console.WriteLine($"OK: {output}");
            }
            catch (Exception ex)
            {
                LogService.Instance.Error("G4md", ex.Message);
                Console.Error.WriteLine($"Error: {ex.Message}");
            }

        }, fileArg, outputOpt);

        return cmd;
    }
}
