using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace IECODE.Core.Formats.Menu;

// ── Résultat de la pose finale d'un bone après une motion ────────────────────

/// <summary>
/// Résultat de la résolution de la pose finale pour un bone donné dans un G4PKM.
/// <para>
/// La pose <c>Pose</c> est la meilleure approximation disponible de la position visible
/// de l'objet après la fin de la motion "open" :
/// <list type="bullet">
///   <item>Pour les bones EN écran dans la bind pose → on retourne directement la bind pose.</item>
///   <item>Pour les bones HORS écran (ex. <c>_pos_scl_base01</c> avec tx=1873) dont la
///         position finale n'est pas encodée dans le G4PKM → on remonte la hiérarchie et on
///         retourne la première pose <em>ancêtre</em> qui est dans l'écran (ou la pose
///         <c>_pos_base01</c> qui est toujours à l'origine). La raison : les animations de
///         glissement entrant du menu IEVR ne stockent pas les keyframes d'os dans le G4PKM —
///         seules les animations de matériau (alpha/UV) y sont présentes. La position finale
///         est pilotée par le moteur C++ du jeu.
///   </item>
/// </list>
/// </para>
/// </summary>
public sealed class G4pkmMotionPose
{
    /// <summary>Nom du bone sélectionné pour ce transform (peut être un ancêtre si le bone cible est hors-écran).</summary>
    public string BoneName { get; init; } = string.Empty;

    /// <summary>Transform world du bone sélectionné (espace-écran 1920×1080, centre=0).</summary>
    public Transform2D Pose { get; init; } = Transform2D.Zero;

    /// <summary>
    /// True si la bind pose du bone d'origine était hors-écran et qu'on a dû remonter à un ancêtre.
    /// Dans ce cas, la position X/Y reflète l'ancêtre le plus proche en écran, et non le bone final.
    /// </summary>
    public bool UsedAncestorFallback { get; init; }

    /// <summary>
    /// True si l'objet a une animation d'ouverture (MotOpenHash != 0).
    /// Indique que la position visible réelle nécessite la lecture des keyframes du moteur de jeu.
    /// </summary>
    public bool HasOpenMotion { get; init; }
}

// ── API principale : extraction de la pose finale d'un G4PKM ─────────────────

/// <summary>
/// Fournit la meilleure approximation de la pose visible (frame final de la motion "open")
/// pour un squelette G4PKM de menu IEVR.
///
/// <para><b>Architecture IEVR (confirmée par rétro-ingénierie) :</b>
/// Le G4MT/G4MA du G4PKM contient uniquement des animations de <em>matériau</em>
/// (alpha fade, décalage UV). Les animations de position d'os ("slide depuis hors-écran")
/// ne sont PAS encodées dans le fichier G4PKM — elles sont pilotées par le moteur C++
/// du jeu via un système d'état (G4RA state machine).
/// </para>
///
/// <para><b>Stratégie pour les bones hors-écran :</b>
/// Si le bone de placement (<c>*base*</c> / <c>*pos_scl*</c>) est hors-écran en bind pose,
/// on remonte la hiérarchie osseuse pour trouver le premier ancêtre dans l'écran.
/// En pratique, <c>_pos_base01</c> (parent direct de <c>_pos_scl_base01</c>) est toujours
/// à l'origine (0, 0) = centre écran, ce qui fournit une position valide.
/// La scale d'affichage est préservée depuis le bone le plus profond accessible dans l'écran.
/// </para>
/// </summary>
public static class G4pkmMotion
{
    private const StringComparison OIC = StringComparison.OrdinalIgnoreCase;

    /// <summary>
    /// Retourne la pose finale du bone de placement de cet objet-menu.
    /// </summary>
    /// <param name="layout">Layout G4PKM parsé (bones + bind pose monde).</param>
    /// <param name="hasOpenMotion">
    /// True si l'objet possède un hash de motion "open" (AnimationComponent.MotOpenHash != 0).
    /// Utilisé uniquement pour annoter le résultat (pas de logique différente).
    /// </param>
    /// <returns>Pose du bone de placement (avec fallback ancêtre si hors-écran).</returns>
    public static G4pkmMotionPose GetMotionFinalPose(G4pkmLayout layout, bool hasOpenMotion = false)
    {
        if (layout.BoneCount == 0)
            return new G4pkmMotionPose
            {
                BoneName = "",
                Pose = Transform2D.Zero,
                HasOpenMotion = hasOpenMotion,
            };

        // 1. Trouver le bone de placement candidat (base/pos_scl)
        int candidateIdx = FindPlacementBoneIndex(layout);
        var candidateBone = layout.Bones[candidateIdx];
        var candidatePose = candidateBone.WorldBindPose;

        // 2. Si ce bone est dans l'écran → retourner directement
        if (!candidatePose.IsOffScreen1920)
        {
            return new G4pkmMotionPose
            {
                BoneName = candidateBone.Name,
                Pose = candidatePose,
                HasOpenMotion = hasOpenMotion,
            };
        }

        // 3. Le bone est hors-écran : remonter la hiérarchie pour trouver un ancêtre visible
        //    On garde la scale du bone le plus profond qui est visible (ou la scale du candidat)
        int current = candidateIdx;
        float bestSx = candidatePose.ScaleX;
        float bestSy = candidatePose.ScaleY;
        float bestRot = candidatePose.Rot;

        while (current >= 0)
        {
            var parentIdx = layout.Bones[current].ParentIndex;
            if (parentIdx < 0 || parentIdx >= layout.BoneCount)
                break;

            var parentPose = layout.Bones[parentIdx].WorldBindPose;

            // Si le parent est dans l'écran, l'utiliser avec la scale du candidat original
            if (!parentPose.IsOffScreen1920)
            {
                return new G4pkmMotionPose
                {
                    BoneName = layout.Bones[parentIdx].Name,
                    Pose = new Transform2D(
                        parentPose.X,
                        parentPose.Y,
                        bestSx,
                        bestSy,
                        bestRot,
                        parentPose.AnchorX,
                        parentPose.AnchorY),
                    UsedAncestorFallback = true,
                    HasOpenMotion = hasOpenMotion,
                };
            }

            current = parentIdx;
        }

        // 4. Tous les parents sont hors-écran (cas extrêmement rare) → retourner la bind pose telle quelle
        return new G4pkmMotionPose
        {
            BoneName = candidateBone.Name,
            Pose = candidatePose,
            UsedAncestorFallback = false,
            HasOpenMotion = hasOpenMotion,
        };
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Trouve l'index du bone de placement (le plus profond dans la hiérarchie qui correspond
    /// aux critères) :
    /// <list type="number">
    ///   <item>Préférence 1 : bone contenant "pos_scl" (ex. <c>_pos_scl_base01</c>)</item>
    ///   <item>Préférence 2 : bone contenant "base" MAIS PAS dans le nom de racine ou
    ///         de groupe de haut niveau (ex. on skip "_pos_base01" si "_pos_scl_base01" existe)</item>
    ///   <item>Préférence 3 : premier bone "base" trouvé</item>
    ///   <item>Fallback : bone 0</item>
    /// </list>
    /// La logique cherche le bone le plus profond (index le plus élevé) parmi les candidats
    /// "pos_scl" d'abord, puis "base", pour sélectionner l'objet final de la hiérarchie.
    /// </summary>
    internal static int FindPlacementBoneIndex(G4pkmLayout layout)
    {
        // Passe 1 : chercher les bones "pos_scl" (bone de scale/position globale)
        int bestPosScl = -1;
        for (int i = 0; i < layout.BoneCount; i++)
        {
            if (layout.Bones[i].Name.Contains("pos_scl", OIC))
                bestPosScl = i; // garder le dernier (le plus profond)
        }
        if (bestPosScl >= 0) return bestPosScl;

        // Passe 2 : chercher les bones "base" (base de positionnement)
        for (int i = 0; i < layout.BoneCount; i++)
        {
            var name = layout.Bones[i].Name;
            if (name.Contains("base", OIC))
                return i;
        }

        return 0;
    }
}

// ── Parseur G4MA/G4MT (noms de motions) ──────────────────────────────────────

/// <summary>
/// Parseur léger des blocs G4MA (bone animation) et G4MT (material animation) du container G4PKM.
///
/// <para><b>Format G4MA/G4MT (rétro-ingénierie IEVR) :</b>
/// Les deux formats partagent le même header 0x40 (magic, headerSize, typeId, version, fileSize)
/// suivi de sections d'offsets (u16 × 16 depuis 0x20).
///
/// La table des noms de motions est accessible via la section à l'offset 0x2E (G4MA) / 0x2E (G4MT).
/// Chaque motion a : frameCount (u16), motionIndex (u16), fps_raw (u32), réservé (u32).
/// Les noms de motions sont dans une string table (offset depuis 0x2C / 0x2E du header).
/// </para>
///
/// <para>Limitation : le G4MA/G4MT ne contient QUE des animations de matériau (alpha/UV fade).
/// Les keyframes de translation/rotation d'os pour les animations de glissement d'entrée
/// sont pilotés par le moteur de jeu, pas encodés dans ces blocs.</para>
/// </summary>
public static class G4maParser
{
    private const uint MAGIC_G4MA = 0x414D3447u; // "G4MA" LE
    private const uint MAGIC_G4MT = 0x544D3447u; // "G4MT" LE

    /// <summary>
    /// Extrait les noms de motions d'un bloc G4MA ou G4MT.
    ///
    /// <para><b>Structure du bloc de noms (validée sur 3 fichiers IEVR) :</b>
    /// Le champ à 0x2E du header (u16, unités de 4 octets depuis 0x40) pointe sur la section
    /// "table de noms" :
    /// <list type="number">
    ///   <item>u16 × <c>motCount</c> = indices d'ordre de rendu (sort order)</item>
    ///   <item>Padding jusqu'à l'alignement 16 octets</item>
    ///   <item>u16 × (motCount + 1) = offsets de chaînes (relatifs au début de cette liste d'offsets)</item>
    ///   <item>Chaînes null-terminées (ex. "_sma_fade_in_mat_01")</item>
    /// </list>
    /// </para>
    /// </summary>
    /// <param name="data">Données brutes du bloc G4MA ou G4MT.</param>
    /// <returns>Liste des noms de motions (peut être vide si format non reconnu).</returns>
    public static IReadOnlyList<string> ParseMotionNames(ReadOnlySpan<byte> data)
    {
        if (data.Length < 0x40) return Array.Empty<string>();

        uint magic = BinaryPrimitives.ReadUInt32LittleEndian(data);
        if (magic != MAGIC_G4MA && magic != MAGIC_G4MT) return Array.Empty<string>();

        // Nombre de motions à 0x20
        int motCount = BinaryPrimitives.ReadUInt16LittleEndian(data[0x20..]);
        if (motCount <= 0 || motCount > 256) return Array.Empty<string>();

        // Section de la table de noms : champ à 0x2E (u16 en unités 4 octets depuis 0x40)
        ushort nameSecRaw = BinaryPrimitives.ReadUInt16LittleEndian(data[0x2E..]);
        int nameSecAbs = 0x40 + nameSecRaw * 4;
        if (nameSecAbs >= data.Length) return Array.Empty<string>();

        // Calculer l'offset de la table des offsets de chaînes :
        // Après les motCount u16 de sort-order, aligner à 16 octets.
        int sortSectionEnd = nameSecAbs + motCount * 2;
        int offsetTableBase = (sortSectionEnd + 15) & ~15; // aligner à 16 octets
        if (offsetTableBase >= data.Length) return Array.Empty<string>();

        // Lire les offsets u16 dans la name table (motCount entrées)
        var names = new List<string>(motCount);
        for (int i = 0; i < motCount; i++)
        {
            int entryPos = offsetTableBase + i * 2;
            if (entryPos + 2 > data.Length) break;

            ushort relOff = BinaryPrimitives.ReadUInt16LittleEndian(data[entryPos..]);
            int namePos = offsetTableBase + relOff;
            if (namePos >= data.Length) break;

            names.Add(ReadNullTerminatedUtf8(data, namePos));
        }

        return names;
    }

    private static string ReadNullTerminatedUtf8(ReadOnlySpan<byte> data, int offset)
    {
        int end = offset;
        while (end < data.Length && data[end] != 0) end++;
        if (end <= offset) return string.Empty;
        return Encoding.UTF8.GetString(data[offset..end]);
    }
}
