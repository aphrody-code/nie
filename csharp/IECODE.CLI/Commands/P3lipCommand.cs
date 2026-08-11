using System.CommandLine;
using System.Text.Json;
using IECODE.Core.Formats.Level5;

namespace IECODE.CLI.Commands;

/// <summary>
/// CLI for P3lip (lives::CResLipSync) lip-sync keyframe tracks.
/// </summary>
public static class P3lipCommand
{
    public static Command Create()
    {
        var command = new Command("p3lip", "P3lip LipSync keyframe track operations (lives::CResLipSync)");

        // info
        var infoCommand = new Command("info", "Display P3lip header summary");
        var infoFileArg = new Argument<string>("file", "P3lip file");
        infoCommand.AddArgument(infoFileArg);
        infoCommand.SetHandler(ShowInfo, infoFileArg);
        command.AddCommand(infoCommand);

        // parse → JSON {frames:[{time,phoneme,weight}]}
        var parseCommand = new Command("parse", "Parse a P3lip file and emit JSON keyframes");
        var parseFileArg = new Argument<string>("file", "P3lip file");
        parseCommand.AddArgument(parseFileArg);
        var outOption = new Option<string?>(aliases: ["--output", "-o"], description: "Write JSON to file instead of stdout");
        parseCommand.AddOption(outOption);
        parseCommand.SetHandler(ParseOne, parseFileArg, outOption);
        command.AddCommand(parseCommand);

        // batch: parse a whole directory tree and count
        var batchCommand = new Command("batch", "Recursively parse every *.p3lip under a directory and report counts");
        var batchDirArg = new Argument<string>("dir", "Directory to scan");
        batchCommand.AddArgument(batchDirArg);
        var jsonDirOption = new Option<string?>("--json-dir", "Write one JSON per file into this directory");
        batchCommand.AddOption(jsonDirOption);
        batchCommand.SetHandler(Batch, batchDirArg, jsonDirOption);
        command.AddCommand(batchCommand);

        return command;
    }

    private static void ShowInfo(string file)
    {
        if (!File.Exists(file)) { Console.Error.WriteLine($"File not found: {file}"); return; }
        try
        {
            var parsed = P3lipParser.ParseFile(file);
            Console.WriteLine();
            Console.WriteLine($"File: {Path.GetFileName(file)}");
            Console.Write(P3lipParser.GetSummary(parsed));
            Console.WriteLine();
            Console.WriteLine($"{"#",-4} {"time(s)",-9} {"phoneme",-9} {"channel",-8} {"weightRaw"}");
            Console.WriteLine(new string('-', 48));
            int i = 0;
            foreach (var k in parsed.Keyframes)
            {
                string ph = k.Phoneme switch { 0xFE => "START", 0xFF => "END", _ => k.Phoneme.ToString() };
                Console.WriteLine($"{i,-4} {k.Time,-9:0.###} {ph,-9} 0x{k.Channel:X2}     0x{k.WeightRaw:X4}");
                i++;
            }
        }
        catch (Exception ex) { Console.Error.WriteLine($"Error: {ex.Message}"); }
    }

    private static void ParseOne(string file, string? output)
    {
        if (!File.Exists(file)) { Console.Error.WriteLine($"File not found: {file}"); return; }
        try
        {
            var json = ToJson(P3lipParser.ParseFile(file));
            if (output is not null) { File.WriteAllText(output, json); Console.WriteLine($"Wrote {output}"); }
            else Console.WriteLine(json);
        }
        catch (Exception ex) { Console.Error.WriteLine($"Error: {ex.Message}"); }
    }

    private static void Batch(string dir, string? jsonDir)
    {
        if (!Directory.Exists(dir)) { Console.Error.WriteLine($"Directory not found: {dir}"); return; }
        if (jsonDir is not null) Directory.CreateDirectory(jsonDir);

        var files = Directory.EnumerateFiles(dir, "*.p3lip", SearchOption.AllDirectories).ToArray();
        int ok = 0, fail = 0;
        long totalFrames = 0;
        foreach (var f in files)
        {
            try
            {
                var parsed = P3lipParser.ParseFile(f);
                ok++;
                totalFrames += parsed.Keyframes.Count;
                if (jsonDir is not null)
                {
                    var name = Path.GetFileNameWithoutExtension(f) + ".json";
                    File.WriteAllText(Path.Combine(jsonDir, name), ToJson(parsed));
                }
            }
            catch (Exception ex)
            {
                fail++;
                Console.Error.WriteLine($"FAIL {Path.GetFileName(f)}: {ex.Message}");
            }
        }
        Console.WriteLine($"Parsed {ok}/{files.Length} P3lip files ({fail} failed), {totalFrames:N0} keyframes total.");
    }

    private static string ToJson(P3lipFile parsed)
    {
        var dto = new P3lipJson
        {
            Duration = parsed.Header.Duration,
            FileSize = parsed.Header.FileSize,
            Count = parsed.Keyframes.Count,
            Frames = parsed.Keyframes.Select(k => new P3lipFrameJson
            {
                Time = k.Time,
                Phoneme = k.Phoneme,
                Channel = k.Channel,
                Weight = k.WeightRaw,
                Sentinel = k.IsSentinel,
            }).ToArray(),
        };
        return JsonSerializer.Serialize(dto, JsonContext.Default.P3lipJson);
    }
}
