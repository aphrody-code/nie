using System.CommandLine;
using IECODE.Core.Formats;

namespace IECODE.CLI.Commands;

/// <summary>
/// Exporte le savoir d'IECODE.Core sur les formats binaires IEVR en JSON stable et
/// versionné, destiné aux consommateurs hors-.NET (en particulier <c>niers</c>, le
/// moteur de reverse-engineering full-Rust qui l'ingère comme ancres de vérité).
/// </summary>
public static class ExportKnowledgeCommand
{
    public static Command Create()
    {
        var command = new Command(
            "export-knowledge",
            "Exporte le catalogue de formats LEVEL-5 / CRIWARE en JSON versionné (consommé par niers)");

        var outOption = new Option<string?>(
            aliases: ["--out", "-o"],
            description: "Fichier JSON de sortie (défaut : stdout)");
        command.AddOption(outOption);

        command.SetHandler((string? outPath) =>
        {
            string json = FormatCatalog.ToJson();

            if (string.IsNullOrWhiteSpace(outPath))
            {
                Console.WriteLine(json);
            }
            else
            {
                var dir = Path.GetDirectoryName(Path.GetFullPath(outPath));
                if (!string.IsNullOrEmpty(dir))
                    Directory.CreateDirectory(dir);
                File.WriteAllText(outPath, json);
                Console.Error.WriteLine(
                    $"# catalogue écrit : {Path.GetFullPath(outPath)} " +
                    $"(schema v{FormatCatalog.SchemaVersion}, {FormatCatalog.All.Count} formats)");
            }
        }, outOption);

        return command;
    }
}
