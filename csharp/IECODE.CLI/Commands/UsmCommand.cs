using System.CommandLine;
using IECODE.Core.Formats.Criware;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande pour les vidéos CRI Sofdec2 (.usm) : info / extract.
/// Le démuxage→MP4 reste accessible via <c>iecode convert</c> (ffmpeg).
/// </summary>
public static class UsmCommand
{
    public static Command Create()
    {
        var command = new Command("usm", "Inspecte et extrait les vidéos CRI Sofdec2 (.usm)");

        // ---- usm info <file> ----
        var infoCommand = new Command("info", "Affiche les métadonnées d'un USM (résolution, codec, durée, flux)");
        var infoFileArg = new Argument<string>("file", "Chemin du fichier .usm");
        infoCommand.AddArgument(infoFileArg);
        infoCommand.SetHandler((string file) => Info(file), infoFileArg);
        command.AddCommand(infoCommand);

        // ---- usm extract <file> -o <dir> ----
        var extractCommand = new Command("extract", "Démuxe un USM en flux bruts (vidéo .m1v/.h264, audio .hca, sous-titres)");
        var extractFileArg = new Argument<string>("file", "Chemin du fichier .usm");
        extractCommand.AddArgument(extractFileArg);
        var outputOption = new Option<string?>(["--output", "-o"], "Répertoire de sortie (défaut : à côté du fichier)");
        extractCommand.AddOption(outputOption);
        extractCommand.SetHandler((string file, string? output) => Extract(file, output), extractFileArg, outputOption);
        command.AddCommand(extractCommand);

        return command;
    }

    private static void Info(string file)
    {
        if (!File.Exists(file))
        {
            Console.WriteLine($"Fichier introuvable : {file}");
            return;
        }

        UsmInfo info;
        try { info = UsmDemuxer.GetInfo(file); }
        catch (Exception ex) { Console.WriteLine($"Erreur : {ex.Message}"); return; }

        Console.WriteLine($"USM : {Path.GetFileName(file)}");
        Console.WriteLine($"  Chiffré (basename) : {(info.Encrypted ? "oui" : "non")}");
        if (info.Filename != null) Console.WriteLine($"  Nom interne        : {info.Filename}");
        if (info.FileSize > 0) Console.WriteLine($"  Taille déclarée    : {info.FileSize:N0} octets");

        if (info.Video is { } v)
        {
            Console.WriteLine("  Vidéo :");
            Console.WriteLine($"    Codec      : {v.Codec}");
            Console.WriteLine($"    Résolution : {v.Width}x{v.Height} (affichage {v.DisplayWidth}x{v.DisplayHeight})");
            Console.WriteLine($"    Framerate  : {v.FramerateHz:F3} fps ({v.FramerateN}/{v.FramerateD})");
            Console.WriteLine($"    Images     : {v.TotalFrames}");
            Console.WriteLine($"    Durée      : {v.DurationSeconds:F2} s");
            if (v.AlphaType != 0) Console.WriteLine($"    Alpha      : type {v.AlphaType}");
        }

        if (info.Audio is { } a)
        {
            Console.WriteLine("  Audio :");
            Console.WriteLine($"    Codec        : {a.Codec}");
            Console.WriteLine($"    Échantillon  : {a.SampleRate} Hz, {a.Channels} canal/aux");
            if (a.TotalSamples > 0) Console.WriteLine($"    Total        : {a.TotalSamples:N0} échantillons");
        }

        if (info.HasSubtitles) Console.WriteLine("  Sous-titres : oui (@SBT)");
        if (info.HasAlpha) Console.WriteLine("  Couche alpha : oui (@ALP)");

        Console.WriteLine("  Flux :");
        foreach (var kv in info.Streams)
        {
            var bytes = System.BitConverter.GetBytes(System.Buffers.Binary.BinaryPrimitives.ReverseEndianness(kv.Key));
            string tag = System.Text.Encoding.ASCII.GetString(bytes);
            Console.WriteLine($"    {tag} : {kv.Value.chunks} chunks, {kv.Value.bytes:N0} octets");
        }
    }

    private static void Extract(string file, string? output)
    {
        if (!File.Exists(file))
        {
            Console.WriteLine($"Fichier introuvable : {file}");
            return;
        }

        string outDir = output ?? Path.Combine(
            Path.GetDirectoryName(Path.GetFullPath(file)) ?? ".",
            Path.GetFileNameWithoutExtension(file) + "_usm");

        Dictionary<uint, string> paths;
        try { paths = UsmDemuxer.Demux(file, outDir); }
        catch (Exception ex) { Console.WriteLine($"Erreur : {ex.Message}"); return; }

        if (paths.Count == 0)
        {
            Console.WriteLine("Aucun flux média extrait.");
            return;
        }

        Console.WriteLine($"Extraction → {outDir}");
        foreach (var p in paths.Values)
        {
            long len = new FileInfo(p).Length;
            Console.WriteLine($"  {Path.GetFileName(p)} ({len:N0} octets)");
        }
        Console.WriteLine("Note : l'audio .hca doit être décodé en PCM via le HcaDecoder (Phase C) avant un mux complet.");
    }
}
