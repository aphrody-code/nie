using System.Text.Json;
using System.Text.Json.Serialization;

namespace IECODE.Core.Formats;

// ── API publique du catalogue de connaissances ────────────────────────────────
//
// Ce fichier expose, sous forme de données pures et sérialisables, TOUT le savoir
// d'IECODE.Core sur les formats binaires LEVEL-5 / CRIWARE rencontrés dans
// Inazuma Eleven: Victory Road (IEVR). Il est conçu pour être consommé hors-.NET :
// la méthode `FormatCatalog.ToJson()` produit un document JSON stable et versionné
// que des outils tiers (notamment `niers`, le moteur de reverse-engineering full-Rust)
// ingèrent comme ancres de vérité.
//
// Source de vérité : les parsers de `Formats/**` et `Audio/**`. Les offsets et
// layouts documentés ici sont extraits de ces parsers (vérifiés octet par octet
// sur des fichiers réels) — aucune valeur n'est fabriquée.

/// <summary>
/// Boutisme d'un en-tête de format.
/// </summary>
public enum FormatEndianness
{
    /// <summary>Petit-boutiste (octet de poids faible en premier).</summary>
    Little,

    /// <summary>Gros-boutiste (octet de poids fort en premier) — typique de CRIWARE.</summary>
    Big,

    /// <summary>Mixte ou sans tête fixe (détecté autrement, ex. footer).</summary>
    None,
}

/// <summary>
/// Catégorie sémantique d'un format documenté.
/// </summary>
public enum FormatCategory
{
    /// <summary>Archive ou conteneur de sous-fichiers.</summary>
    Archive,

    /// <summary>Géométrie, modèle ou squelette 3D.</summary>
    Model,

    /// <summary>Texture ou image.</summary>
    Texture,

    /// <summary>Matériau ou shader.</summary>
    Material,

    /// <summary>Animation ou mouvement.</summary>
    Animation,

    /// <summary>Configuration ou données structurées.</summary>
    Config,

    /// <summary>Audio (musique, voix, effets).</summary>
    Audio,

    /// <summary>Vidéo.</summary>
    Video,

    /// <summary>Compression ou conteneur de flux compressé.</summary>
    Compression,

    /// <summary>Script ou bytecode.</summary>
    Script,

    /// <summary>Navigation, collision ou physique.</summary>
    Spatial,
}

/// <summary>
/// Description d'un champ d'en-tête d'un format : son décalage, sa taille, son type
/// et une note explicative. Permet à un consommateur de reconstruire le layout binaire
/// sans lire le parser C#.
/// </summary>
/// <param name="Offset">Décalage du champ en octets depuis le début de l'en-tête (ou de la structure de référence).</param>
/// <param name="Size">Taille du champ en octets.</param>
/// <param name="Type">Type primitif du champ (ex. <c>u32</c>, <c>u16</c>, <c>i32</c>, <c>magic</c>).</param>
/// <param name="Name">Nom du champ.</param>
/// <param name="Note">Note explicative (rôle, contraintes, valeur attendue) ; <c>null</c> si évident.</param>
public sealed record FormatField(
    int Offset,
    int Size,
    string Type,
    string Name,
    string? Note = null);

/// <summary>
/// Définition complète d'un format binaire LEVEL-5 / CRIWARE documenté par IECODE.Core.
/// </summary>
/// <param name="Name">Nom court canonique du format (clé stable, ex. <c>G4TX</c>, <c>CPK</c>, <c>cfg.bin</c>).</param>
/// <param name="Category">Catégorie sémantique.</param>
/// <param name="Extensions">Extensions de fichier associées (peut être vide pour les conteneurs internes).</param>
/// <param name="Magic">Magic bytes en représentation lisible (ASCII entre guillemets et/ou hex), ou <c>null</c> si le format n'a pas de magic en tête.</param>
/// <param name="MagicHex">Magic sur 4 octets en uint32, ordre disque (little-endian lu en uint32), ou <c>null</c>.</param>
/// <param name="Endianness">Boutisme de l'en-tête.</param>
/// <param name="HeaderSize">Taille de l'en-tête fixe en octets si connue, sinon <c>null</c>.</param>
/// <param name="Description">Description en français du format et de son rôle.</param>
/// <param name="Doc">Chemin du parser de référence, relatif à <c>iecode/src/IECODE.Core/</c>.</param>
/// <param name="Fields">Layout documenté des champs d'en-tête (peut être vide).</param>
public sealed record FormatDefinition(
    string Name,
    FormatCategory Category,
    IReadOnlyList<string> Extensions,
    string? Magic,
    uint? MagicHex,
    FormatEndianness Endianness,
    int? HeaderSize,
    string Description,
    string Doc,
    IReadOnlyList<FormatField> Fields);

/// <summary>
/// Document racine sérialisé par <see cref="FormatCatalog.ToJson()"/>. Contient la
/// version de schéma, des métadonnées de génération et la liste des formats.
/// </summary>
/// <param name="SchemaVersion">Version du schéma JSON (incrémentée à chaque rupture de compatibilité). Vaut <see cref="FormatCatalog.SchemaVersion"/>.</param>
/// <param name="Generator">Identifiant du générateur (<c>iecode</c>).</param>
/// <param name="Game">Jeu cible (IEVR).</param>
/// <param name="FormatCount">Nombre de formats dans le catalogue.</param>
/// <param name="Formats">Liste des définitions de formats.</param>
public sealed record FormatCatalogDocument(
    [property: JsonPropertyName("schema_version")] int SchemaVersion,
    [property: JsonPropertyName("generator")] string Generator,
    [property: JsonPropertyName("game")] string Game,
    [property: JsonPropertyName("format_count")] int FormatCount,
    [property: JsonPropertyName("formats")] IReadOnlyList<FormatDefinition> Formats);

/// <summary>
/// Contexte de sérialisation source-generated pour le catalogue. Rend
/// <see cref="FormatCatalog.ToJson()"/> compatible AOT (pas de réflexion).
/// </summary>
[JsonSourceGenerationOptions(
    WriteIndented = true,
    PropertyNamingPolicy = JsonKnownNamingPolicy.SnakeCaseLower,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    UseStringEnumConverter = true)]
[JsonSerializable(typeof(FormatCatalogDocument))]
public partial class FormatCatalogJsonContext : JsonSerializerContext
{
}

/// <summary>
/// Source de vérité du savoir d'IECODE.Core sur les formats binaires d'IEVR, exposée
/// comme données pures et exportable en JSON stable.
///
/// <para>Utilisation : <c>FormatCatalog.All</c> pour énumérer en .NET, ou
/// <c>FormatCatalog.ToJson()</c> pour produire l'artefact machine-readable consommé
/// par les outils externes (ex. <c>niers</c>, full-Rust).</para>
///
/// <para>Le JSON respecte un schéma versionné (<see cref="SchemaVersion"/>). Toute
/// modification incompatible (suppression/renommage de champ, changement de sémantique)
/// DOIT incrémenter <see cref="SchemaVersion"/>.</para>
/// </summary>
public static class FormatCatalog
{
    /// <summary>
    /// Version du schéma JSON émis par <see cref="ToJson()"/>. Incrémentée à chaque
    /// rupture de compatibilité du format de sortie.
    /// </summary>
    public const int SchemaVersion = 1;

    /// <summary>
    /// Catalogue complet des formats documentés, dans l'ordre canonique.
    /// </summary>
    public static IReadOnlyList<FormatDefinition> All { get; } = BuildCatalog();

    /// <summary>
    /// Retourne la définition d'un format par son nom canonique, ou <c>null</c> si inconnu.
    /// </summary>
    /// <param name="name">Nom canonique (ex. <c>G4TX</c>).</param>
    public static FormatDefinition? Get(string name)
    {
        foreach (var f in All)
            if (string.Equals(f.Name, name, StringComparison.OrdinalIgnoreCase))
                return f;
        return null;
    }

    /// <summary>
    /// Construit le document racine versionné (sans le sérialiser).
    /// </summary>
    public static FormatCatalogDocument BuildDocument() => new(
        SchemaVersion: SchemaVersion,
        Generator: "iecode",
        Game: "Inazuma Eleven: Victory Road",
        FormatCount: All.Count,
        Formats: All);

    /// <summary>
    /// Sérialise le catalogue complet en JSON stable et versionné (indenté).
    /// AOT-compatible : utilise un contexte source-generated, sans réflexion.
    /// </summary>
    public static string ToJson() =>
        JsonSerializer.Serialize(BuildDocument(), FormatCatalogJsonContext.Default.FormatCatalogDocument);

    // ── Construction du catalogue ─────────────────────────────────────────────

    private static FormatDefinition[] BuildCatalog() =>
    [
        // ── Conteneurs / archives ────────────────────────────────────────────
        new(
            Name: "CPK",
            Category: FormatCategory.Archive,
            Extensions: ["cpk"],
            Magic: "\"CPK \"",
            MagicHex: 0x204B5043u,
            Endianness: FormatEndianness.Little,
            HeaderSize: 0x10,
            Description: "Archive CRIWARE CPK : conteneur principal des assets IEVR. Magic \"CPK \" suivi d'une table @UTF décrivant les TOC (CpkHeader/TOC/ETOC/ITOC) et les fichiers (offsets, tailles, compression CRILAYLA).",
            Doc: "Formats/Criware/CriFs/CpkReader.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\"CPK \" (0x204B5043 LE)"),
                new(0x04, 4, "u32", "Unknown04", "réservé/flags"),
                new(0x08, 8, "u64", "UtfPacketSize", "taille du paquet @UTF qui suit"),
            ]),
        new(
            Name: "@UTF",
            Category: FormatCategory.Archive,
            Extensions: ["utf"],
            Magic: "\"@UTF\"",
            MagicHex: 0x46545540u,
            Endianness: FormatEndianness.Big,
            HeaderSize: 0x20,
            Description: "CRIWARE Universal Table Format : table colonne/ligne gros-boutiste servant de métadonnées dans CPK, ACB, ACF, USM. En-tête big-endian, encodage Shift-JIS ou UTF-8 selon l'octet 0x09.",
            Doc: "Formats/Criware/UtfParser.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\"@UTF\" (0x40555446 BE)"),
                new(0x04, 4, "u32", "TableSize", "taille de la table (BE)"),
                new(0x09, 1, "u8", "Encoding", "0 = Shift-JIS, sinon UTF-8"),
                new(0x0A, 2, "u16", "RowsOffset", "offset des lignes (relatif à 0x08, BE)"),
                new(0x0C, 4, "i32", "StringPoolOffset", "offset du pool de chaînes (relatif à 0x08, BE)"),
                new(0x10, 4, "i32", "DataPoolOffset", "offset du pool de données (relatif à 0x08, BE)"),
                new(0x18, 2, "u16", "ColumnCount", "nombre de colonnes (BE)"),
                new(0x1A, 2, "u16", "RowSizeBytes", "taille d'une ligne en octets (BE)"),
                new(0x1C, 4, "i32", "RowCount", "nombre de lignes (BE)"),
            ]),
        new(
            Name: "ACB",
            Category: FormatCategory.Audio,
            Extensions: ["acb"],
            Magic: "\"@UTF\"",
            MagicHex: 0x46545540u,
            Endianness: FormatEndianness.Big,
            HeaderSize: null,
            Description: "CRIWARE Audio Container Bundle : conteneur de cues audio. C'est une table @UTF (mêmes magic/en-tête) ; distinct de l'UTF brut seulement par l'extension .acb et le schéma de colonnes. L'AWB associé contient les ondes.",
            Doc: "Formats/Criware/AcbReader.cs",
            Fields: []),
        new(
            Name: "AWB",
            Category: FormatCategory.Audio,
            Extensions: ["awb"],
            Magic: "\"AFS2\"",
            MagicHex: 0x32534641u,
            Endianness: FormatEndianness.Little,
            HeaderSize: 0x10,
            Description: "CRIWARE Audio Wave Bank (AFS2) : banque d'ondes audio (HCA/ADX) indexée. En-tête AFS2 suivi de la table des offsets de sous-fichiers.",
            Doc: "Formats/Criware/AwbReader.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\"AFS2\" (0x32534641 LE)"),
                new(0x04, 1, "u8", "Version", "version du format AFS2"),
                new(0x05, 1, "u8", "OffsetSize", "taille des entrées d'offset (2 ou 4 octets)"),
                new(0x08, 4, "u32", "FileCount", "nombre de sous-fichiers"),
            ]),
        new(
            Name: "G4PK",
            Category: FormatCategory.Archive,
            Extensions: ["g4pk"],
            Magic: "\"G4PK\" (+ '@')",
            MagicHex: 0x4B503447u,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Paquet LEVEL-5 : conteneur d'assets liés (layout, motions, textures). Le 5e octet '@' (0x40) distingue la variante IEVR. Le 5e octet 'M' (0x4D) signale la variante menu G4PKM.",
            Doc: "Formats/Level5/G4pkParser.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\"G4PK\" (0x4B503447 LE)"),
                new(0x04, 1, "u8", "Variant", "'@' (0x40) = IEVR, 'M' (0x4D) = menu G4PKM"),
            ]),
        new(
            Name: "G4PKM",
            Category: FormatCategory.Archive,
            Extensions: ["g4pkm"],
            Magic: "\"G4PK\" + 'M'",
            MagicHex: 0x4B503447u,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Variante menu du paquet G4PK (5e octet 'M' = 0x4D) : sous-fichiers de layout/motion d'écran menu (G4MA/G4MT, etc.).",
            Doc: "Formats/Menu/G4pkmLayout.cs",
            Fields: []),
        new(
            Name: "G4RA",
            Category: FormatCategory.Archive,
            Extensions: ["g4ra"],
            Magic: "\"G4RA\" (+ '`')",
            MagicHex: 0x41523447u,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Archive de ressources LEVEL-5 : table de ressources (offset, taille, ref-count, flags) indexée par nom.",
            Doc: "Formats/Level5/G4raParser.cs",
            Fields: []),
        new(
            Name: "XFSA",
            Category: FormatCategory.Archive,
            Extensions: ["xfsa"],
            Magic: "\"XFSA\"",
            MagicHex: 0x41534658u,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Archive LEVEL-5 XFSA (compatible Kuriimu2) : conteneur de sous-fichiers compressés.",
            Doc: "Formats/FormatDetector.cs",
            Fields: []),
        new(
            Name: "XPCK",
            Category: FormatCategory.Archive,
            Extensions: ["xpck"],
            Magic: "\"XPCK\"",
            MagicHex: 0x4B435058u,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Paquet LEVEL-5 XPCK : archive de sous-fichiers (souvent G4TX/G4MD), répandue sur les titres 3DS/Switch LEVEL-5.",
            Doc: "Formats/FormatDetector.cs",
            Fields: []),

        // ── Modèles / géométrie ──────────────────────────────────────────────
        new(
            Name: "G4MD",
            Category: FormatCategory.Model,
            Extensions: ["g4md"],
            Magic: "\"G4MD\"",
            MagicHex: 0x444D3447u,
            Endianness: FormatEndianness.Little,
            HeaderSize: 0x68,
            Description: "Métadonnées de modèle LEVEL-5 (G4MDP) : sous-mailles, matériaux, références d'os, table de layout vertex, offsets de section. Plusieurs champs 32 bits sont byte-swappés.",
            Doc: "Formats/Level5/G4mdParser.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\"G4MD\" (0x444D3447 LE)"),
                new(0x04, 2, "u16", "SubmeshInfo", "offset de la table des sous-mailles (records 0x50)"),
                new(0x06, 2, "u16", "HeaderSize", "taille de header observée (ex. 0x68)"),
                new(0x0A, 2, "u16", "SectionBase", "base de calcul des offsets de section"),
                new(0x20, 2, "u16", "SubmeshCount", "nombre de sous-mailles"),
                new(0x22, 2, "u16", "MaterialCount", "nombre de matériaux"),
                new(0x24, 1, "u8", "BoneCount", "nombre de références d'os"),
                new(0x26, 1, "u8", "VLayoutCount", "nombre d'attributs de layout vertex"),
                new(0x30, 2, "u16", "VertexDataOffset", "offset section vertex (byte-swapped)"),
                new(0x32, 2, "u16", "BoneRefOffset", "offset section références d'os (byte-swapped)"),
            ]),
        new(
            Name: "G4MG",
            Category: FormatCategory.Model,
            Extensions: ["g4mg"],
            Magic: null,
            MagicHex: null,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Groupe de modèles LEVEL-5 : géométrie (vertices/indices) référencée par G4MD. Sans magic propre en tête — table d'attributs g4md décrivant POSITION/NORMAL (SNORM16 vtype=2) / TEXCOORD_0 (ushort vtype=10).",
            Doc: "Formats/Level5/G4mgParser.cs",
            Fields: []),
        new(
            Name: "G4MT",
            Category: FormatCategory.Material,
            Extensions: ["g4mt"],
            Magic: "\"G4MT\"",
            MagicHex: 0x544D3447u,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Matériau LEVEL-5 : paramètres de rendu et références de textures liées au modèle G4MD.",
            Doc: "Formats/Level5/G4mtParser.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\"G4MT\" (0x544D3447 LE)"),
            ]),
        new(
            Name: "G4SK",
            Category: FormatCategory.Model,
            Extensions: ["g4sk"],
            Magic: "\"G4SK\" (+ '@')",
            MagicHex: 0x4B533447u,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Squelette LEVEL-5 : hiérarchie d'os (noms, transforms, parents) liée au modèle, pour le skinning et l'animation.",
            Doc: "Formats/Level5/G4skParser.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\"G4SK\" (0x4B533447 LE)"),
            ]),
        new(
            Name: "G4NV",
            Category: FormatCategory.Spatial,
            Extensions: ["g4nv"],
            Magic: "\"NAVM\"",
            MagicHex: 0x4D56414Eu,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Maillage de navigation LEVEL-5 : extension .g4nv, magic interne \"NAVM\". Polygones de navigation/IA de déplacement.",
            Doc: "Formats/Level5/NavmParser.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\"NAVM\" (0x4D56414E LE)"),
            ]),
        new(
            Name: "PXCL",
            Category: FormatCategory.Spatial,
            Extensions: ["pxcl", "col"],
            Magic: "\"PXCL\"",
            MagicHex: 0x4C435850u,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Données pixel/collision LEVEL-5 : géométrie de collision (extension .col, magic interne \"PXCL\").",
            Doc: "Formats/Level5/PxclParser.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\"PXCL\" (0x5058434C LE)"),
            ]),

        // ── Textures ─────────────────────────────────────────────────────────
        new(
            Name: "G4TX",
            Category: FormatCategory.Texture,
            Extensions: ["g4tx"],
            Magic: "\"G4TX\"",
            MagicHex: 0x58543447u,
            Endianness: FormatEndianness.Little,
            HeaderSize: 0x60,
            Description: "Conteneur de textures LEVEL-5 : en-tête 0x60, tables d'entrées (0x30), de sous-textures atlas (0x18), de hash, d'IDs et de noms ; les données pointent sur des blocs NXTCH (Switch) ou DDS.",
            Doc: "Formats/Level5/G4txParser.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\"G4TX\" (0x58543447 LE)"),
                new(0x04, 2, "i16", "HeaderSize", "taille de l'en-tête (0x60)"),
                new(0x06, 2, "i16", "FileType", "type de fichier"),
                new(0x0C, 4, "i32", "TableSize", "taille des tables avant les données"),
                new(0x20, 2, "i16", "TextureCount", "nombre de textures principales"),
                new(0x22, 2, "i16", "TotalCount", "nombre total d'entrées (textures + sous-textures)"),
                new(0x25, 1, "u8", "SubTextureCount", "nombre de sous-textures (atlas)"),
                new(0x2C, 4, "i32", "TextureDataSize", "taille totale des données de texture"),
            ]),
        new(
            Name: "NXTCH",
            Category: FormatCategory.Texture,
            Extensions: ["nxtch"],
            Magic: "\"NXTCH\"",
            MagicHex: null,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Nintendo Switch Texture Chunk : bloc de texture swizzlée (BCn) référencé par G4TX. Magic \"NXTCH\" sur 5 octets (masque 0xFFFFFFFFFF).",
            Doc: "Formats/Level5/NxtchParser.cs",
            Fields: []),
        new(
            Name: "DDS",
            Category: FormatCategory.Texture,
            Extensions: ["dds"],
            Magic: "\"DDS \"",
            MagicHex: 0x20534444u,
            Endianness: FormatEndianness.Little,
            HeaderSize: 0x80,
            Description: "DirectDraw Surface : texture standard (DXT/BCn), forme alternative des données portées par G4TX.",
            Doc: "Formats/Level5/DdsParser.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\"DDS \" (0x20534444 LE)"),
            ]),
        new(
            Name: "DXBC",
            Category: FormatCategory.Material,
            Extensions: ["vfxo", "pfxo"],
            Magic: "\"DXBC\"",
            MagicHex: 0x43425844u,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "DirectX Byte Code : shaders HLSL compilés (Vertex/Pixel), embarqués dans les FXBIN.",
            Doc: "Formats/Shader/DxbcReader.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\"DXBC\" (0x43425844 LE)"),
            ]),

        // ── Animation ────────────────────────────────────────────────────────
        new(
            Name: "AGI",
            Category: FormatCategory.Animation,
            Extensions: ["agi"],
            Magic: "\".AGI\"",
            MagicHex: 0x4147492Eu,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Infos animation/graphiques LEVEL-5 : magic \".AGI\" (octets disque 2E 49 47 41).",
            Doc: "Formats/Level5/AgiParser.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\".AGI\" (0x4147492E LE)"),
            ]),
        new(
            Name: "P3LIP",
            Category: FormatCategory.Animation,
            Extensions: ["p3lip"],
            Magic: "\"lip\\0\"",
            MagicHex: null,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Synchronisation labiale LEVEL-5 (lives::CResLipSync) : pistes de phonèmes (temps, phonème, canal, poids).",
            Doc: "Formats/Level5/P3lipParser.cs",
            Fields: []),

        // ── Configuration / données ──────────────────────────────────────────
        new(
            Name: "cfg.bin",
            Category: FormatCategory.Config,
            Extensions: ["cfg.bin", "bin"],
            Magic: null,
            MagicHex: null,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Configuration binaire LEVEL-5. Deux variantes : T2B (sans magic en tête, détectée par le footer 01 74 32 62 = 't2b') et RDBN (magic explicite \"RDBN\"). Porte la quasi-totalité des données du jeu (persos, skills, items, routes).",
            Doc: "Formats/Level5/CfgBin/CfgBin.cs",
            Fields:
            [
                new(-4, 4, "magic", "T2bFooter", "footer 't2b' (01 74 32 62) sur les 4 derniers octets de la variante T2B ; offset relatif à la fin de fichier"),
            ]),
        new(
            Name: "RDBN",
            Category: FormatCategory.Config,
            Extensions: ["cfg.bin", "bin"],
            Magic: "\"RDBN\"",
            MagicHex: 0x4E424452u,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Variante moderne de cfg.bin avec magic explicite \"RDBN\" en tête : table de structures et de chaînes typées.",
            Doc: "Formats/Level5/CfgBin/Rdbn/RdbnReader.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\"RDBN\" (0x4E424452 LE)"),
            ]),
        new(
            Name: "MEVBIN",
            Category: FormatCategory.Config,
            Extensions: ["mev.bin"],
            Magic: "footer 't2b'",
            MagicHex: null,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Motion events LEVEL-5 : conteneur cfg.bin T2B (footer 't2b') décrivant les évènements de motion.",
            Doc: "Formats/Level5/MevbinDocument.cs",
            Fields: []),
        new(
            Name: "FXBIN",
            Category: FormatCategory.Material,
            Extensions: ["fx.bin"],
            Magic: "footer 't2b'",
            MagicHex: null,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "ShaderFX LEVEL-5 : conteneur cfg.bin T2B (footer 't2b') référençant des shaders DXBC.",
            Doc: "Formats/Level5/FxbinParser.cs",
            Fields: []),
        new(
            Name: "OBJB",
            Category: FormatCategory.Config,
            Extensions: ["objbin"],
            Magic: "\"objb\"",
            MagicHex: 0x626A626Fu,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Objets binaires LEVEL-5 : conteneur d'objets de scène/menu (magic \"objb\").",
            Doc: "Formats/Menu/ObjbParser.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\"objb\" (0x6F626A62 LE)"),
            ]),

        // ── Scripts ──────────────────────────────────────────────────────────
        new(
            Name: "LUA",
            Category: FormatCategory.Script,
            Extensions: ["lua.bin"],
            Magic: "\"\\x1bLua\"",
            MagicHex: 0x61754C1Bu,
            Endianness: FormatEndianness.Little,
            HeaderSize: null,
            Description: "Bytecode Lua 5.2 LEVEL-5 : scripts de gameplay/UI compilés (signature ESC+\"Lua\").",
            Doc: "Formats/Lua/LuaParser.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\\x1bLua (0x61754C1B LE)"),
            ]),

        // ── Compression ──────────────────────────────────────────────────────
        new(
            Name: "CRILAYLA",
            Category: FormatCategory.Compression,
            Extensions: [],
            Magic: "\"CRILAYLA\"",
            MagicHex: null,
            Endianness: FormatEndianness.Little,
            HeaderSize: 0x10,
            Description: "Flux compressé CRIWARE LZSS : en-tête 0x10 (magic 8 octets + taille décompressée + offset d'en-tête non compressé), suivi des données compressées puis d'un bloc de 0x100 octets non compressés copié en tête du résultat.",
            Doc: "Formats/Criware/CriFs/Compression/CriLayla.cs",
            Fields:
            [
                new(0x00, 8, "magic", "Magic", "\"CRILAYLA\" (0x414C59414C495243 LE 64 bits)"),
                new(0x08, 4, "i32", "UncompressedSize", "taille des données décompressées"),
                new(0x0C, 4, "i32", "UncompHeaderOffset", "offset du bloc de 0x100 octets non compressés"),
            ]),

        // ── Audio / vidéo ────────────────────────────────────────────────────
        new(
            Name: "HCA",
            Category: FormatCategory.Audio,
            Extensions: ["hca"],
            Magic: "\"HCA\\0\"",
            MagicHex: null,
            Endianness: FormatEndianness.Big,
            HeaderSize: null,
            Description: "CRIWARE High Compression Audio : audio compressé gros-boutiste. Les tags de tête (HCA/fmt/comp|dec/ciph/loop) sont masqués par 0x7F (bit de poids fort = drapeau de chiffrement éventuel).",
            Doc: "Audio/HcaDecoder.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\"HCA\\0\" (0x48434100 BE, octets masqués 0x7F)"),
                new(0x04, 2, "u16", "Version", "version du format (BE)"),
                new(0x06, 2, "u16", "HeaderSize", "taille de l'en-tête (BE)"),
            ]),
        new(
            Name: "ADX",
            Category: FormatCategory.Audio,
            Extensions: ["adx"],
            Magic: "0x80 0x00",
            MagicHex: null,
            Endianness: FormatEndianness.Big,
            HeaderSize: null,
            Description: "CRIWARE ADX : audio ADPCM gros-boutiste (préfixe 0x80 0x00 = offset de copyright). Décodage PCM16 natif pour le type 0x02.",
            Doc: "Audio/AdxDecoder.cs",
            Fields:
            [
                new(0x00, 2, "u16", "CopyrightOffset", "0x8000 | offset du bloc copyright (BE)"),
                new(0x03, 1, "u8", "Encoding", "type d'encodage (0x02 = ADPCM standard)"),
            ]),
        new(
            Name: "USM",
            Category: FormatCategory.Video,
            Extensions: ["usm"],
            Magic: "\"CRID\"",
            MagicHex: 0x44495243u,
            Endianness: FormatEndianness.Big,
            HeaderSize: null,
            Description: "CRIWARE USM : conteneur vidéo (démultiplexage de flux @SFV/@SFA via tables @UTF). Magic de bloc \"CRID\".",
            Doc: "Formats/Criware/UsmDemuxer.cs",
            Fields:
            [
                new(0x00, 4, "magic", "Magic", "\"CRID\" (0x43524944 BE)"),
            ]),
    ];
}
