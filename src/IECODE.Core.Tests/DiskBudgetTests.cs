using IECODE.Core.Dump;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Logique pure du garde-fou disque du dump : réserve (plancher 2 Gio / 3 %), budget
/// utilisable, décision tient/dépasse, franchissement de réserve en cours d'extraction.
/// Aucune dépendance au disque réel.
/// </summary>
public class DiskBudgetTests
{
    private const long Gib = 1024L * 1024 * 1024;

    // ── Réserve ───────────────────────────────────────────────────────────────

    [Fact]
    public void Reserve_PetitePartition_UtiliseLePlancher2Gio()
    {
        // 3 % de 40 Gio = 1.2 Gio < plancher → plancher 2 Gio gagne.
        Assert.Equal(DiskBudget.MinReserveBytes, DiskBudget.Reserve(40 * Gib));
    }

    [Fact]
    public void Reserve_GrossePartition_UtiliseLaFraction3Pourcent()
    {
        // 3 % de 200 Gio = 6 Gio > plancher → fraction gagne.
        long expected = (long)(200 * Gib * DiskBudget.ReserveFraction);
        Assert.Equal(expected, DiskBudget.Reserve(200 * Gib));
        Assert.True(DiskBudget.Reserve(200 * Gib) > DiskBudget.MinReserveBytes);
    }

    // ── Budget utilisable ─────────────────────────────────────────────────────

    [Fact]
    public void UsableBudget_RetireLaReserve()
    {
        // 64 Gio libres sur 193 Gio : réserve = max(2, 3%·193=5.79) = 5.79 Gio.
        long total = 193 * Gib;
        long free = 64 * Gib;
        long reserve = DiskBudget.Reserve(total);
        Assert.Equal(free - reserve, DiskBudget.UsableBudget(free, total));
    }

    [Fact]
    public void UsableBudget_JamaisNegatif()
    {
        // Libre déjà sous la réserve → budget = 0, pas négatif.
        Assert.Equal(0, DiskBudget.UsableBudget(1 * Gib, 193 * Gib));
    }

    // ── Décision tient / dépasse ──────────────────────────────────────────────

    [Fact]
    public void Fits_EstimationSousBudget_Ok()
    {
        // 30 Gio estimés, 64 Gio libres sur 193 Gio → tient large.
        Assert.True(DiskBudget.Fits(30 * Gib, 64 * Gib, 193 * Gib));
    }

    [Fact]
    public void Fits_EstimationDepasseBudget_Refuse()
    {
        // 100 Gio estimés > ~58 Gio utilisables → refus.
        Assert.False(DiskBudget.Fits(100 * Gib, 64 * Gib, 193 * Gib));
    }

    [Fact]
    public void Fits_PileSurLaLimite_Accepte()
    {
        long total = 193 * Gib;
        long free = 64 * Gib;
        long budget = DiskBudget.UsableBudget(free, total);
        Assert.True(DiskBudget.Fits(budget, free, total));
        Assert.False(DiskBudget.Fits(budget + 1, free, total));
    }

    // ── Re-check en cours d'extraction ────────────────────────────────────────

    [Fact]
    public void ReserveBreached_AuDessusDeLaReserve_Faux()
    {
        Assert.False(DiskBudget.ReserveBreached(10 * Gib, 193 * Gib));
    }

    [Fact]
    public void ReserveBreached_SousLaReserve_Vrai()
    {
        // 1 Gio libre < réserve plancher 2 Gio → arrêt.
        Assert.True(DiskBudget.ReserveBreached(1 * Gib, 40 * Gib));
    }
}
