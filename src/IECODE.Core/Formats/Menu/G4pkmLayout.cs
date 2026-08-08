using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace IECODE.Core.Formats.Menu;

// ── Structures de données ─────────────────────────────────────────────────────

/// <summary>
/// Transform 2D d'un bone de menu, exprimé dans l'espace-écran du jeu.
///
/// Espace de référence (confirmé par rétro-ingénierie sur 3 fichiers réels) :
///   - Origine : CENTRE de l'écran (0, 0).
///   - X positif → droite, X négatif → gauche.
///   - Y positif → HAUT (convention OpenGL), Y négatif → bas.
///   - Unité : pixels 1920×1080 (1 unité = 1 pixel à résolution native).
///   - Pour convertir en pixels CSS 1280×720 (canvas azalee) :
///       pixel_x = 640 + x * (1280.0 / 1920.0)
///       pixel_y = 360 - y * (720.0 / 1080.0)   ← Y inversé (CSS = Y bas)
///
/// Calibration (voir re/menu/g4pkm-calibration.md) :
///   - option02_02 / _license_nvidia_dmy01 : tx=0 ty=0 sx=1920 sy=1080 → fullscreen ✓
///   - win00_04 / _cursor01                : tx=-40 ty=40 sx=80 sy=80   → centre-gauche ✓
///   - title00_09 / _pos_scl_base01        : tx=1873 ty=-39 → hors-écran droite (pose bind =
///     position cachée initiale ; la pose visible vient du frame final de la motion "open").
/// </summary>
public sealed partial record Transform2D(
    /// <summary>Position X en unités-écran (centre=0, droite+). Non nul = décalage du pivot.</summary>
    float X,
    /// <summary>Position Y en unités-écran (centre=0, haut+).</summary>
    float Y,
    /// <summary>Largeur du sprite en pixels 1920 (= sx de la matrice locale).</summary>
    float ScaleX,
    /// <summary>Hauteur du sprite en pixels 1080 (= sy de la matrice locale).</summary>
    float ScaleY,
    /// <summary>Rotation en radians (sens trigonométrique). 0 pour la quasi-totalité des menus 2D.</summary>
    float Rot,
    /// <summary>Pivot X normalisé dans le sprite (0=gauche, 0.5=centre, 1=droite). Toujours 0.5 en l'absence d'info.</summary>
    float AnchorX,
    /// <summary>Pivot Y normalisé dans le sprite (0=bas, 0.5=centre, 1=haut). Toujours 0.5 en l'absence d'info.</summary>
    float AnchorY
)
{
    /// <summary>Transforme le pivot du bone en coordonnées pixel CSS sur un canvas 1280×720.</summary>
    public (float px, float py) ToCss1280x720()
    {
        float px = 640.0f + X * (1280.0f / 1920.0f);
        float py = 360.0f - Y * (720.0f / 1080.0f);
        return (px, py);
    }

    /// <summary>Retourne true si la position est visiblement hors du canvas 1920×1080 (|x|>960 ou |y|>540).</summary>
    public bool IsOffScreen1920 =>
        MathF.Abs(X) > 960.0f || MathF.Abs(Y) > 540.0f;
}

/// <summary>
/// Bone parsé depuis un squelette G4SK (issu d'un G4PKM de menu).
/// </summary>
public sealed class G4pkmBone
{
    /// <summary>Index du bone dans le squelette (0-based, ordre du fichier).</summary>
    public int Index { get; init; }

    /// <summary>Nom du bone (ex. "_pos_scl_base01", "_gtxt_ver01", "_cursor01").</summary>
    public string Name { get; init; } = string.Empty;

    /// <summary>Index du parent (-1 = racine).</summary>
    public int ParentIndex { get; init; }

    /// <summary>
    /// Transform LOCAL en bind pose (relatif au parent direct).
    /// Pour les bones racines (chaîne de parents tous identité), c'est aussi la pose monde.
    /// </summary>
    public Transform2D LocalBindPose { get; init; } = Transform2D.Zero;

    /// <summary>
    /// Transform MONDE calculé en composant la chaîne parentale (bind pose).
    /// Représente la position/taille réelle dans l'espace-écran.
    /// Peut être hors-écran si le bone démarre caché (animé via motion "open").
    /// </summary>
    public Transform2D WorldBindPose { get; init; } = Transform2D.Zero;
}

/// <summary>
/// Layout 2D complet d'un squelette G4PKM de menu.
/// Contient la liste des bones avec leurs transforms bind-pose (local + monde).
/// </summary>
public sealed class G4pkmLayout
{
    /// <summary>Nombre de bones dans le squelette.</summary>
    public int BoneCount => Bones.Count;

    /// <summary>Liste des bones dans l'ordre du fichier.</summary>
    public IReadOnlyList<G4pkmBone> Bones { get; init; } = Array.Empty<G4pkmBone>();

    /// <summary>Map boneName → Transform2D monde (bind pose).</summary>
    public IReadOnlyDictionary<string, Transform2D> WorldPoseByName { get; init; } =
        new Dictionary<string, Transform2D>(StringComparer.Ordinal);

    /// <summary>Retourne le transform monde d'un bone par son nom, ou null si non trouvé.</summary>
    public Transform2D? GetWorldPose(string boneName) =>
        WorldPoseByName.TryGetValue(boneName, out var t) ? t : null;
}

// ── Membre statique Zero sur Transform2D ─────────────────────────────────────

public sealed partial record Transform2D
{
    /// <summary>Transform identité (0,0,1,1,0,0.5,0.5).</summary>
    public static Transform2D Zero { get; } = new(0f, 0f, 1f, 1f, 0f, 0.5f, 0.5f);
}

// ── Parseur G4PKM ─────────────────────────────────────────────────────────────

/// <summary>
/// Parseur du squelette G4PKM pour extraire les transforms 2D des bones de menu.
///
/// Structure du fichier G4PKM :
///   G4PK container (header 0x40) contenant :
///   - title00_09.g4sk  → squelette (hiérarchie + bind pose)
///   - title00_09.g4md  → géométrie (non utilisé ici)
///   - title00_09.g4mt  → matériau/animation matériau
///   - title00_09.g4ma  → animation bone (non utilisé ici sauf pour motion "open")
///   - title00_09.g4ra  → render/matériau info
///
/// Structure du fichier G4SK (offset depuis début du sous-fichier G4SK) :
///   0x00 : Magic "G4SK"
///   0x04 : HeaderSize (ushort, toujours 0x40)
///   0x06 : TypeId (ushort)
///   0x08 : Version (uint)
///   0x0C : FileSize (uint, = taille G4SK - 0x40)
///   0x20 : BoneCount (ushort)
///   0x24 : section inv_bind (ushort, en unités 4 octets depuis 0x40)
///   0x26 : section 3 (ushort, idem)
///   0x28 : section 4 (ushort)
///   0x2A : section parent_indices (ushort, 20 shorts, valeur &lt;BoneCount ? index : -1)
///   0x2C : section sort_order (ushort, BoneCount shorts)
///   0x2E : section flags (ushort, BoneCount bytes)
///   0x30 : section ??? (ushort)
///   0x32 : section name_offsets (ushort, BoneCount shorts relatifs à la table elle-même)
///   0x40 : Bloc bind-pose locales (BoneCount × 48 octets = 3 rangées de 4 floats)
///          Matrice 3×4 : ligne 0 = (sx, 0, 0, tx), ligne 1 = (0, sy, 0, ty), ligne 2 = (0, 0, sz, 0)
/// </summary>
public static class G4pkmParser
{
    // Magics des formats imbriqués
    private const uint MAGIC_G4PK = 0x4B503447u; // "G4PK" LE
    private const uint MAGIC_G4SK = 0x4B533447u; // "G4SK" LE

    // Taille fixe du header G4PK
    private const int G4PK_HEADER_SIZE = 0x40;

    // Stride d'une matrice 3×4 flottants (3 rangées × 4 floats × 4 octets)
    private const int MATRIX34_STRIDE = 48; // 0x30

    // ── API principale ───────────────────────────────────────────────────────

    /// <summary>
    /// Parse un fichier G4PKM (G4PK container) et retourne le layout 2D du squelette.
    /// </summary>
    /// <param name="g4pkmData">Contenu binaire du fichier .g4pkm.</param>
    /// <returns>Layout avec tous les bones et leurs transforms monde (bind pose).</returns>
    /// <exception cref="InvalidDataException">Données invalides ou format non reconnu.</exception>
    public static G4pkmLayout ParseG4pkm(ReadOnlySpan<byte> g4pkmData)
    {
        // Valider le container G4PK
        ValidateG4pkMagic(g4pkmData);

        // Extraire le sous-fichier G4SK depuis le container G4PK
        var g4skData = ExtractG4sk(g4pkmData);
        if (g4skData.IsEmpty)
            throw new InvalidDataException("Aucun fichier G4SK trouvé dans le container G4PKM.");

        return ParseG4sk(g4skData);
    }

    /// <summary>
    /// Parse un fichier G4PKM depuis le disque.
    /// </summary>
    public static G4pkmLayout ParseG4pkm(string filePath)
    {
        var data = File.ReadAllBytes(filePath);
        return ParseG4pkm(data.AsSpan());
    }

    // ── Extraction des sous-blocs G4MA / G4MT ───────────────────────────────

    private const uint MAGIC_G4MA = 0x414D3447u; // "G4MA" LE
    private const uint MAGIC_G4MT = 0x544D3447u; // "G4MT" LE

    /// <summary>
    /// Extrait les données brutes du sous-bloc G4MA (animation d'os) depuis un container G4PK.
    /// Retourne <c>ReadOnlyMemory&lt;byte&gt;.Empty</c> si non trouvé.
    /// </summary>
    public static ReadOnlyMemory<byte> ExtractG4maData(byte[] g4pkmData) =>
        ExtractSubFile(g4pkmData.AsSpan(), MAGIC_G4MA);

    /// <summary>
    /// Extrait les données brutes du sous-bloc G4MT (animation de matériau) depuis un container G4PK.
    /// Retourne <c>ReadOnlyMemory&lt;byte&gt;.Empty</c> si non trouvé.
    /// </summary>
    public static ReadOnlyMemory<byte> ExtractG4mtData(byte[] g4pkmData) =>
        ExtractSubFile(g4pkmData.AsSpan(), MAGIC_G4MT);

    /// <summary>
    /// Parse directement un sous-fichier G4SK (squelette).
    /// </summary>
    public static G4pkmLayout ParseG4sk(ReadOnlySpan<byte> g4skData)
    {
        // Valider le magic G4SK
        if (g4skData.Length < 0x40)
            throw new InvalidDataException($"G4SK trop court : {g4skData.Length} < 0x40 octets.");

        uint magic = BinaryPrimitives.ReadUInt32LittleEndian(g4skData);
        if (magic != MAGIC_G4SK)
            throw new InvalidDataException($"Magic G4SK invalide : 0x{magic:X8}");

        // Lire le nombre de bones
        int boneCount = BinaryPrimitives.ReadUInt16LittleEndian(g4skData[0x20..]);
        if (boneCount == 0)
            return new G4pkmLayout
            {
                Bones = Array.Empty<G4pkmBone>(),
                WorldPoseByName = new Dictionary<string, Transform2D>()
            };

        // Lire les offsets des sections (en unités 4 octets depuis 0x40)
        // Le champ à 0x24 pointe sur les matrices inv_bind (après le bloc bind local)
        // Le champ à 0x2A pointe sur les indices parents
        // Le champ à 0x2C pointe sur l'ordre de rendu
        // Le champ à 0x32 pointe sur la table des offsets de noms
        int nameTableAbsOffset  = GetSectionAbsOffset(g4skData, 0x32);
        int parentAbsOffset     = GetSectionAbsOffset(g4skData, 0x2A);

        // ── Lire les noms des bones ──────────────────────────────────────────
        var names = ReadBoneNames(g4skData, nameTableAbsOffset, boneCount);

        // ── Lire les indices parents ─────────────────────────────────────────
        var parents = ReadParentIndices(g4skData, parentAbsOffset, boneCount);

        // ── Lire les matrices bind pose locales (bloc à 0x40) ───────────────
        var localPoses = ReadLocalBindPoses(g4skData, boneCount);

        // ── Calculer les poses monde en composant la hiérarchie ──────────────
        var worldPoses = ComputeWorldPoses(localPoses, parents, boneCount);

        // ── Assembler les bones ──────────────────────────────────────────────
        var bones = new List<G4pkmBone>(boneCount);
        var poseByName = new Dictionary<string, Transform2D>(boneCount, StringComparer.Ordinal);

        for (int i = 0; i < boneCount; i++)
        {
            var bone = new G4pkmBone
            {
                Index        = i,
                Name         = names[i],
                ParentIndex  = parents[i],
                LocalBindPose  = localPoses[i],
                WorldBindPose  = worldPoses[i],
            };
            bones.Add(bone);

            // En cas de doublon de nom (rare), on garde le premier
            poseByName.TryAdd(names[i], worldPoses[i]);
        }

        return new G4pkmLayout
        {
            Bones = bones,
            WorldPoseByName = poseByName,
        };
    }

    // ── Extraction du G4SK depuis le container G4PK ──────────────────────────

    private static void ValidateG4pkMagic(ReadOnlySpan<byte> data)
    {
        if (data.Length < G4PK_HEADER_SIZE)
            throw new InvalidDataException($"G4PKM trop court : {data.Length} < {G4PK_HEADER_SIZE} octets.");

        uint magic = BinaryPrimitives.ReadUInt32LittleEndian(data);
        if (magic != MAGIC_G4PK)
            throw new InvalidDataException($"Magic G4PK invalide : 0x{magic:X8}");
    }

    private static ReadOnlySpan<byte> ExtractG4sk(ReadOnlySpan<byte> pkData)
    {
        var sub = FindSubFile(pkData, MAGIC_G4SK);
        if (sub.IsEmpty)
            return ReadOnlySpan<byte>.Empty;
        return sub;
    }

    /// <summary>
    /// Extrait un sous-fichier par magic depuis un container G4PK.
    /// Retourne <c>ReadOnlyMemory&lt;byte&gt;.Empty</c> si non trouvé.
    /// </summary>
    private static ReadOnlyMemory<byte> ExtractSubFile(ReadOnlySpan<byte> pkData, uint targetMagic)
    {
        var sub = FindSubFile(pkData, targetMagic);
        if (sub.IsEmpty) return ReadOnlyMemory<byte>.Empty;
        return sub.ToArray();
    }

    /// <summary>
    /// Trouve et retourne un sous-fichier depuis le container G4PK (retourne span vide si absent).
    /// </summary>
    private static ReadOnlySpan<byte> FindSubFile(ReadOnlySpan<byte> pkData, uint targetMagic)
    {
        int headerSize = BinaryPrimitives.ReadUInt16LittleEndian(pkData[4..]);
        int fileCount  = BinaryPrimitives.ReadInt32LittleEndian(pkData[0x20..]);

        if (fileCount <= 0 || fileCount > 64)
            return ReadOnlySpan<byte>.Empty;

        // Table des offsets bruts (en unités 4 octets depuis headerSize)
        int offsetTablePos = headerSize;
        var rawOffsets = new int[fileCount];
        for (int i = 0; i < fileCount; i++)
        {
            rawOffsets[i] = BinaryPrimitives.ReadInt32LittleEndian(
                pkData[(offsetTablePos + i * 4)..]);
        }

        // Table des tailles
        int sizeTablePos = offsetTablePos + fileCount * 4;
        var sizes = new int[fileCount];
        for (int i = 0; i < fileCount; i++)
        {
            sizes[i] = BinaryPrimitives.ReadInt32LittleEndian(
                pkData[(sizeTablePos + i * 4)..]);
        }

        // Chercher le premier fichier avec le magic cible
        for (int i = 0; i < fileCount; i++)
        {
            int fileOffset = headerSize + (rawOffsets[i] << 2);
            int fileSize   = sizes[i];

            if (fileOffset < 0 || fileSize <= 0 || fileOffset + fileSize > pkData.Length)
                continue;

            var slice = pkData.Slice(fileOffset, fileSize);
            if (slice.Length >= 4)
            {
                uint magic = BinaryPrimitives.ReadUInt32LittleEndian(slice);
                if (magic == targetMagic)
                    return slice;
            }
        }

        return ReadOnlySpan<byte>.Empty;
    }

    // ── Lecture des sections G4SK ────────────────────────────────────────────

    /// <summary>
    /// Calcule l'offset absolu d'une section à partir du champ ushort à <paramref name="fieldPos"/>.
    /// L'offset stocké est en unités 4 octets depuis 0x40 (début du contenu G4SK après header).
    /// </summary>
    private static int GetSectionAbsOffset(ReadOnlySpan<byte> sk, int fieldPos)
    {
        ushort raw = BinaryPrimitives.ReadUInt16LittleEndian(sk[fieldPos..]);
        return 0x40 + raw * 4;
    }

    /// <summary>
    /// Lit les noms des bones depuis la table d'offsets de noms.
    /// Les offsets sont relatifs au début de la table elle-même.
    /// </summary>
    private static string[] ReadBoneNames(ReadOnlySpan<byte> sk, int tableOffset, int boneCount)
    {
        var names = new string[boneCount];

        if (tableOffset < 0 || tableOffset >= sk.Length)
        {
            for (int i = 0; i < boneCount; i++)
                names[i] = $"Bone_{i}";
            return names;
        }

        for (int i = 0; i < boneCount; i++)
        {
            int entryPos = tableOffset + i * 2;
            if (entryPos + 2 > sk.Length)
            {
                names[i] = $"Bone_{i}";
                continue;
            }

            ushort relOff = BinaryPrimitives.ReadUInt16LittleEndian(sk[entryPos..]);
            int absPos = tableOffset + relOff;

            if (absPos >= sk.Length)
            {
                names[i] = $"Bone_{i}";
                continue;
            }

            names[i] = ReadNullTerminatedUtf8(sk, absPos);
        }

        return names;
    }

    /// <summary>
    /// Lit les indices parents. Une valeur ≥ boneCount signifie « racine » (retourne -1).
    /// </summary>
    private static int[] ReadParentIndices(ReadOnlySpan<byte> sk, int tableOffset, int boneCount)
    {
        var parents = new int[boneCount];

        for (int i = 0; i < boneCount; i++)
        {
            int pos = tableOffset + i * 2;
            if (pos + 2 > sk.Length)
            {
                parents[i] = -1;
                continue;
            }

            short raw = BinaryPrimitives.ReadInt16LittleEndian(sk[pos..]);
            parents[i] = (raw >= 0 && raw < boneCount) ? raw : -1;
        }

        return parents;
    }

    /// <summary>
    /// Lit les matrices bind-pose locales depuis le bloc à l'offset 0x40 du G4SK.
    /// Chaque matrice est 3 rangées × 4 floats = 48 octets :
    ///   ligne 0 = (sx, r01, r02, tx)
    ///   ligne 1 = (r10, sy, r12, ty)
    ///   ligne 2 = (r20, r21, sz, 0)
    /// Pour les menus 2D, r0x et rx0 hors-diagonale sont nuls (pas de rotation).
    /// La rotation est extraite via atan2(r10, r00) si nécessaire.
    /// </summary>
    private static Transform2D[] ReadLocalBindPoses(ReadOnlySpan<byte> sk, int boneCount)
    {
        var poses = new Transform2D[boneCount];
        const int BASE = 0x40;

        for (int i = 0; i < boneCount; i++)
        {
            int off = BASE + i * MATRIX34_STRIDE;

            if (off + MATRIX34_STRIDE > sk.Length)
            {
                poses[i] = Transform2D.Zero;
                continue;
            }

            // Ligne 0 : (sx*cos, -sy*sin, 0, tx)   — pour 2D pur: (sx, 0, 0, tx)
            float r00 = BinaryPrimitives.ReadSingleLittleEndian(sk[(off + 0)..]);
            float r01 = BinaryPrimitives.ReadSingleLittleEndian(sk[(off + 4)..]);
            float tx  = BinaryPrimitives.ReadSingleLittleEndian(sk[(off + 12)..]);

            // Ligne 1 : (sx*sin, sy*cos, 0, ty)     — pour 2D pur: (0, sy, 0, ty)
            float r10 = BinaryPrimitives.ReadSingleLittleEndian(sk[(off + 16)..]);
            float r11 = BinaryPrimitives.ReadSingleLittleEndian(sk[(off + 20)..]);
            float ty  = BinaryPrimitives.ReadSingleLittleEndian(sk[(off + 28)..]);

            // Décomposer scale et rotation depuis la matrice 2D
            // sx = longueur de la première colonne (r00, r10)
            // sy = longueur de la deuxième colonne (r01, r11)
            // rot = atan2(r10, r00)
            float sx  = MathF.Sqrt(r00 * r00 + r10 * r10);
            float sy  = MathF.Sqrt(r01 * r01 + r11 * r11);
            float rot = MathF.Atan2(r10, r00);

            // Si sx et sy proches de zéro, utiliser la diagonale directement
            if (sx < 1e-6f) sx = MathF.Abs(r00);
            if (sy < 1e-6f) sy = MathF.Abs(r11);

            poses[i] = new Transform2D(tx, ty, sx, sy, rot, 0.5f, 0.5f);
        }

        return poses;
    }

    /// <summary>
    /// Compose les matrices 2D à travers la hiérarchie pour obtenir les poses monde.
    /// Pour une matrice 3×4 2D sans rotation : les poses se composent par :
    ///   world.tx = parent.sx * local.tx + parent.tx
    ///   world.sx = parent.sx * local.sx
    /// Avec rotation (cas général) la composition est matricielle.
    /// </summary>
    private static Transform2D[] ComputeWorldPoses(Transform2D[] local, int[] parents, int boneCount)
    {
        var world = new Transform2D[boneCount];

        // Tableau pour détecter les cycles
        var computed = new bool[boneCount];

        for (int i = 0; i < boneCount; i++)
            ComputeWorldRecursive(i, local, parents, world, computed);

        return world;
    }

    private static void ComputeWorldRecursive(
        int i,
        Transform2D[] local,
        int[] parents,
        Transform2D[] world,
        bool[] computed)
    {
        if (computed[i]) return;

        int p = parents[i];
        if (p < 0 || p >= local.Length)
        {
            // Racine : monde = local
            world[i] = local[i];
        }
        else
        {
            // S'assurer que le parent est calculé
            ComputeWorldRecursive(p, local, parents, world, computed);
            world[i] = ComposeTransforms(world[p], local[i]);
        }

        computed[i] = true;
    }

    /// <summary>
    /// Compose deux transforms 2D (parent * child) en tenant compte de la rotation.
    /// Utilise la multiplication matricielle 3×3 (2D homogène) pour le cas général.
    ///
    /// Matrice 2D homogène :
    ///   [sx*cos(r)  -sy*sin(r)  tx]
    ///   [sx*sin(r)   sy*cos(r)  ty]
    ///   [0           0           1]
    /// </summary>
    private static Transform2D ComposeTransforms(Transform2D parent, Transform2D child)
    {
        float pc = MathF.Cos(parent.Rot);
        float ps = MathF.Sin(parent.Rot);
        float cc = MathF.Cos(child.Rot);
        float cs = MathF.Sin(child.Rot);

        // Colonnes de la matrice parent (2×2 = rotation*scale)
        float p00 = parent.ScaleX * pc;
        float p01 = -parent.ScaleY * ps;
        float p10 = parent.ScaleX * ps;
        float p11 = parent.ScaleY * pc;

        // Colonnes de la matrice child
        float c00 = child.ScaleX * cc;
        float c01 = -child.ScaleY * cs;
        float c10 = child.ScaleX * cs;
        float c11 = child.ScaleY * cc;

        // Résultat = parent * child (2×2 + translation)
        float r00 = p00 * c00 + p01 * c10;
        float r01 = p00 * c01 + p01 * c11;
        float r10 = p10 * c00 + p11 * c10;
        float r11 = p10 * c01 + p11 * c11;

        // Translation monde : parent_mat * child.translation + parent.translation
        float worldTx = p00 * child.X + p01 * child.Y + parent.X;
        float worldTy = p10 * child.X + p11 * child.Y + parent.Y;

        // Décomposer le résultat
        float worldSx  = MathF.Sqrt(r00 * r00 + r10 * r10);
        float worldSy  = MathF.Sqrt(r01 * r01 + r11 * r11);
        float worldRot = MathF.Atan2(r10, r00);

        if (worldSx < 1e-6f) worldSx = 1f;
        if (worldSy < 1e-6f) worldSy = 1f;

        return new Transform2D(worldTx, worldTy, worldSx, worldSy, worldRot, 0.5f, 0.5f);
    }

    // ── Utilitaires ──────────────────────────────────────────────────────────

    private static string ReadNullTerminatedUtf8(ReadOnlySpan<byte> data, int offset)
    {
        int end = offset;
        while (end < data.Length && data[end] != 0)
            end++;

        return Encoding.UTF8.GetString(data[offset..end]);
    }
}
