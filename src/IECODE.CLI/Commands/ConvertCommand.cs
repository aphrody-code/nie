using System.Collections.Generic;
using System.CommandLine;
using System.CommandLine.Invocation;
using IECODE.Core.Converters;

namespace IECODE.CLI.Commands;

public static class ConvertCommand
{
    public static Command Create()
    {
        var command = new Command("convert", "Convert game assets to standard formats (PNG, WebP, GLB, MP4, WebM)");

        var inputArgument   = new Argument<string>("input", "Input file or directory path");
        var outputOption    = new Option<string?>(["--output", "-o"], "Output directory (default: same as input)");
        var recursiveOption = new Option<bool>(["--recursive", "-r"], "Process directories recursively");
        var formatOption    = new Option<string?>(["--format", "-f"], "Target format: png, webp, glb, mp4, webm");
        var verboseOption   = new Option<bool>(["--verbose", "-v"], "Print each converted file path");
        var archiveOption   = new Option<bool>(["--archive", "-a"], "Create a ZIP archive of the output directory after conversion");
        var archivePathOpt  = new Option<string?>(["--archive-path"], "Custom ZIP path (default: <output>.zip)");
        var langOption      = new Option<string[]>(["--lang"], "Include only these language folders (e.g. --lang fr --lang en)")
        {
            AllowMultipleArgumentsPerToken = true
        };
        var noDupOption     = new Option<bool>(["--no-dup"], "Skip files whose output path was already queued (deduplication)");

        command.AddArgument(inputArgument);
        command.AddOption(outputOption);
        command.AddOption(recursiveOption);
        command.AddOption(formatOption);
        command.AddOption(verboseOption);
        command.AddOption(archiveOption);
        command.AddOption(archivePathOpt);
        command.AddOption(langOption);
        command.AddOption(noDupOption);

        // Use InvocationContext to bypass the SetHandler parameter count limit.
        command.SetHandler(async (InvocationContext ctx) =>
        {
            string   input       = ctx.ParseResult.GetValueForArgument(inputArgument);
            string?  output      = ctx.ParseResult.GetValueForOption(outputOption);
            bool     recursive   = ctx.ParseResult.GetValueForOption(recursiveOption);
            string?  format      = ctx.ParseResult.GetValueForOption(formatOption);
            bool     verbose     = ctx.ParseResult.GetValueForOption(verboseOption);
            bool     archive     = ctx.ParseResult.GetValueForOption(archiveOption);
            string?  archivePath = ctx.ParseResult.GetValueForOption(archivePathOpt);
            string[] langs       = ctx.ParseResult.GetValueForOption(langOption) ?? [];
            bool     noDup       = ctx.ParseResult.GetValueForOption(noDupOption);

            var converter = new AssetConverterFacade();

            if (string.IsNullOrEmpty(output))
                output = Directory.Exists(input) ? input : (Path.GetDirectoryName(input) ?? ".");

            if (Directory.Exists(input))
            {
                Console.WriteLine($"Converting directory: {input} -> {output}");

                var opts = new ConvertOptions
                {
                    Format         = format,
                    SkipDuplicates = noDup || langs.Length > 0,
                    IncludedLanguages = langs.Length > 0
                        ? new HashSet<string>(langs, StringComparer.OrdinalIgnoreCase)
                        : null
                };

                var results = await converter.ConvertDirectoryAsync(input, output, recursive, opts);
                if (verbose)
                    foreach (var r in results)
                        Console.WriteLine($"  {r}");
                Console.WriteLine($"Done: {results.Count} file(s) converted.");

                if (archive)
                {
                    var zip = converter.ArchiveDirectory(output, archivePath);
                    Console.WriteLine($"Archive: {zip}");
                }
            }
            else if (File.Exists(input))
            {
                var result = await converter.ConvertFileAsync(input, output, format);
                if (result != null)
                    Console.WriteLine($"OK: {result}");
                else
                    Console.Error.WriteLine($"Failed or unsupported: {input}");
            }
            else
            {
                Console.Error.WriteLine($"Error: path not found: {input}");
            }
        });

        return command;
    }
}
