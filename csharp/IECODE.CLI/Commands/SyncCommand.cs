using IECODE.Core.Dump;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande sync — pipeline natif complet : <c>download</c> (Steam) puis <c>dump</c>
/// (extraction CPK sélective). Remplace entièrement steamcmd + scripts externes.
/// </summary>
public static class SyncCommand
{
    public static async Task ExecuteAsync(
        uint appId,
        string installDir,
        string output,
        string? preset,
        string? user,
        string? password,
        string? guardCode,
        string branch,
        string os,
        int threads,
        string? tokenStore,
        bool skipDownload,
        bool verbose)
    {
        // 1. Téléchargement natif (sauf --skip-download).
        if (!skipDownload)
        {
            await DownloadCommand.ExecuteAsync(
                appId, installDir, user, password, guardCode, branch, os,
                allPlatforms: false, depots: [], threads, tokenStore, list: false, verbose);

            if (Environment.ExitCode != 0)
            {
                Console.Error.WriteLine("✗ Sync interrompu : le téléchargement a échoué.");
                return;
            }
        }
        else
        {
            Console.WriteLine("▸ Téléchargement sauté (--skip-download).");
        }

        // 2. Dump sélectif (extraction native) de l'install téléchargée.
        var fileFilter = DumpPresets.Resolve(preset);
        Console.WriteLine();
        Console.WriteLine($"▸ dump (preset {preset ?? "inagle-azalee"}) {installDir} → {output}");
        await DumpCommand.ExecuteAsync(
            gamePath: installDir,
            output: output,
            smart: true,
            verbose: verbose,
            threads: threads,
            includeLoose: true,
            fileFilter: fileFilter);

        if (Environment.ExitCode == 0)
        {
            Console.WriteLine($"\n✓ Sync terminé. Données prêtes : {Path.GetFullPath(output)}");
        }
    }
}
