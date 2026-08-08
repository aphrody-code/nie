using System.Globalization;

namespace IECODE.Core.Runtime;

/// <summary>
/// Profil de la machine hôte — défauts d'exécution auto-ajustés à la réalité du VPS
/// plutôt qu'au seul nombre de cœurs.
///
/// Contexte (cf. <c>docs/vps.md</c>) : le VPS est <b>partagé</b> (des workloads voisins
/// occupent déjà plusieurs cœurs) et <b>mono-disque</b>. Réclamer aveuglément
/// <see cref="Environment.ProcessorCount"/> threads pour le download/dump sur-souscrit
/// CPU et I/O, dégradant iecode <i>et</i> les voisins. On dimensionne donc le
/// parallélisme par défaut à partir des cœurs <i>réellement libres</i> (charge système),
/// et la taille des buffers I/O pour un disque unique.
///
/// Tout est surchargeable par variable d'environnement :
/// <list type="bullet">
///   <item><c>IECODE_PARALLELISM</c> — force le degré de parallélisme (entier &gt; 0).</item>
///   <item><c>IECODE_IO_BUFFER</c> — taille des buffers I/O séquentiels, en Ko.</item>
/// </list>
/// </summary>
public static class HostProfile
{
    /// <summary>Cœurs logiques vus par le runtime.</summary>
    public static int LogicalCores { get; } = Environment.ProcessorCount;

    /// <summary>
    /// Parallélisme par défaut pour les étapes CPU/I/O lourdes (chunks de download,
    /// extraction CPK). Tient compte de la charge courante pour rester bon voisin sur
    /// une machine partagée. Borné <c>[2, LogicalCores]</c>. Override : <c>IECODE_PARALLELISM</c>.
    /// </summary>
    public static int Parallelism { get; } = ComputeParallelism(
        Environment.ProcessorCount,
        ReadLoadAvg1(),
        Environment.GetEnvironmentVariable("IECODE_PARALLELISM"));

    /// <summary>
    /// Taille des buffers d'I/O séquentiels (lecture CPK clair, écriture chunks). Sur un
    /// disque unique avec RAM large, des buffers plus gros réduisent le nombre de syscalls.
    /// Défaut 1 Mo. Override : <c>IECODE_IO_BUFFER</c> (en Ko).
    /// </summary>
    public static int IoBufferBytes { get; } = ComputeIoBuffer(
        Environment.GetEnvironmentVariable("IECODE_IO_BUFFER"));

    /// <summary>
    /// Logique pure (testable) du choix de parallélisme.
    /// <paramref name="envOverride"/> gagne si entier &gt; 0. Sinon, si une charge est
    /// disponible (<paramref name="load1"/> &gt; 0), on ne réclame que <c>cores - load</c>
    /// cœurs libres ; sans charge (non-Linux), on prend tous les cœurs. Toujours borné
    /// <c>[2, cores]</c> pour garantir le progrès sans saturer.
    /// </summary>
    internal static int ComputeParallelism(int cores, double load1, string? envOverride)
    {
        // Override explicite : honoré tel quel (l'utilisateur peut vouloir sur-souscrire).
        if (int.TryParse(envOverride, NumberStyles.Integer, CultureInfo.InvariantCulture, out var forced) && forced > 0)
            return forced;

        if (load1 <= 0)
            return Math.Max(2, cores);

        // Cœurs réellement libres = total - charge (loadavg 1 min). On laisse ainsi
        // tourner les voisins ; le plancher 2 évite de tomber à 1 si la machine est saturée.
        var free = (int)Math.Floor(cores - load1);
        return Math.Clamp(free, 2, cores);
    }

    /// <summary>Logique pure (testable) du choix de buffer I/O. Override en Ko, sinon 1 Mo.</summary>
    internal static int ComputeIoBuffer(string? envOverride)
    {
        if (int.TryParse(envOverride, NumberStyles.Integer, CultureInfo.InvariantCulture, out var kb) && kb > 0)
            return kb * 1024;
        return 1024 * 1024;
    }

    /// <summary>
    /// Charge système sur 1 minute via <c>/proc/loadavg</c> (Linux). Renvoie <c>-1</c> si
    /// indisponible (autre OS, lecture impossible) — l'appelant retombe alors sur tous les cœurs.
    /// </summary>
    private static double ReadLoadAvg1()
    {
        try
        {
            var text = File.ReadAllText("/proc/loadavg");
            var sp = text.IndexOf(' ');
            if (sp <= 0)
                return -1;
            return double.TryParse(text.AsSpan(0, sp), NumberStyles.Float, CultureInfo.InvariantCulture, out var v)
                ? v
                : -1;
        }
        catch
        {
            return -1;
        }
    }
}
