namespace IECODE.Core.Dump;

/// <summary>
/// Logique pure (testable, sans disque réel) du contrôle d'espace pour le dump.
///
/// Le dump <b>décompresse</b> les fichiers sélectionnés des CPK : la sortie peut peser
/// bien plus que les CPK compressés (un dump complet dépasse les 57 G compressés). Sur le
/// VPS mono-disque à ~64 G libres, saturer <c>/</c> casserait iecode <i>et</i> les voisins.
/// On garde donc toujours une <b>réserve</b> libre = <c>max(MinReserveBytes, ReserveFraction
/// × taille_partition)</c>, et on refuse (ou stoppe) si l'estimation décompressée dépasse le
/// budget réellement disponible.
/// </summary>
public static class DiskBudget
{
    /// <summary>Réserve plancher : on ne descend jamais sous 2 Gio libres.</summary>
    public const long MinReserveBytes = 2L * 1024 * 1024 * 1024;

    /// <summary>Réserve proportionnelle : au moins 3 % de la partition restent libres.</summary>
    public const double ReserveFraction = 0.03;

    /// <summary>
    /// Réserve à conserver libre sur une partition de <paramref name="totalBytes"/> octets :
    /// <c>max(MinReserveBytes, ReserveFraction × total)</c>.
    /// </summary>
    public static long Reserve(long totalBytes)
    {
        long fraction = (long)(totalBytes * ReserveFraction);
        return Math.Max(MinReserveBytes, fraction);
    }

    /// <summary>
    /// Budget réellement utilisable = espace libre actuel − réserve (jamais négatif).
    /// </summary>
    public static long UsableBudget(long freeBytes, long totalBytes)
    {
        long usable = freeBytes - Reserve(totalBytes);
        return usable > 0 ? usable : 0;
    }

    /// <summary>
    /// Vrai si l'extraction estimée (<paramref name="estimatedBytes"/>, décompressé) tient
    /// dans le budget de la partition. Faux ⇒ dépassement, on refuse sans <c>--force</c>.
    /// </summary>
    public static bool Fits(long estimatedBytes, long freeBytes, long totalBytes) =>
        estimatedBytes <= UsableBudget(freeBytes, totalBytes);

    /// <summary>
    /// Vrai si, en cours d'extraction, l'espace libre est tombé sous la réserve : signal
    /// d'arrêt propre (l'estimation a pu être fausse, ou un voisin a rempli le disque).
    /// </summary>
    public static bool ReserveBreached(long freeBytes, long totalBytes) =>
        freeBytes <= Reserve(totalBytes);
}
