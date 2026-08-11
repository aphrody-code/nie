using System.Buffers.Binary;
using System.Text.Json.Serialization;

namespace IECODE.Core.Formats;

// ── Enum + métadonnées ────────────────────────────────────────────────────────

/// <summary>
/// Catégorie sémantique d'un fichier LEVEL-5 / CRI, déterminée par ses magic bytes.
/// </summary>
public enum GameFileKind
{
    /// <summary>Format inconnu ou non détecté.</summary>
    Unknown = 0,

    // ── Archives / paquets ────────────────────────────────────────────────────

    /// <summary>Archive CRI (<c>CPK </c>).</summary>
    CpkArchive,
    /// <summary>Paquet LEVEL-5 (<c>G4PK@</c>) — assets liés (layout, motions, textures).</summary>
    G4Package,
    /// <summary>Paquet menu LEVEL-5 (<c>G4PKM</c>) — variante sous-fichiers G4MA/G4MT.</summary>
    G4PackageMenu,
    /// <summary>Archive de ressources LEVEL-5 (<c>G4RA`</c>).</summary>
    G4ResourceArchive,
    /// <summary>Archive XFSA LEVEL-5 (<c>XFSA</c>).</summary>
    XfsaArchive,
    /// <summary>Paquet XPCK LEVEL-5 (<c>XPCK</c>).</summary>
    XpckPackage,
    /// <summary>Archive audio CRI AFS2 (<c>AFS2</c>).</summary>
    Afs2Archive,
    /// <summary>Bundle audio CRI ACB (<c>@UTF</c> dans le conteneur).</summary>
    AcbBundle,
    /// <summary>Wave Bank audio CRI AWB.</summary>
    AwbWaveBank,

    // ── Graphiques / modèles ──────────────────────────────────────────────────

    /// <summary>Texture LEVEL-5 (<c>G4TX</c>).</summary>
    G4Texture,
    /// <summary>Squelette LEVEL-5 (<c>G4SK@</c>).</summary>
    G4Skeleton,
    /// <summary>Métadonnées de modèle LEVEL-5 (<c>G4MDP</c>).</summary>
    G4ModelData,
    /// <summary>Groupe de modèles LEVEL-5 (<c>G4MG</c>).</summary>
    G4ModelGroup,
    /// <summary>Matériau LEVEL-5 (<c>G4MT</c>).</summary>
    G4Material,
    /// <summary>Animation LEVEL-5 (<c>G4MA</c>).</summary>
    G4Motion,
    /// <summary>Infos animation/graphiques LEVEL-5 (<c>.AGI</c>).</summary>
    AgiInfo,

    // ── Configuration / données ───────────────────────────────────────────────

    /// <summary>Configuration binaire LEVEL-5, format T2B (footer <c>01 74 32 62</c>) ou RDBN (<c>RDBN</c>).</summary>
    CfgBin,
    /// <summary>Objets binaires LEVEL-5 (<c>objb</c>).</summary>
    ObjBinary,
    /// <summary>Collision/pixel data LEVEL-5 (<c>PXCL</c>).</summary>
    PxclData,

    // ── Scripts ───────────────────────────────────────────────────────────────

    /// <summary>Bytecode Lua 5.2 (<c>\x1bLua</c>).</summary>
    LuaBytecode,

    // ── CRI Middleware ────────────────────────────────────────────────────────

    /// <summary>Table UTF CRI (<c>@UTF</c>).</summary>
    CriUtfTable,
    /// <summary>Flux compressé CRI LZSS (<c>CRILAYLA</c>).</summary>
    CriLaylaCompressed,
    /// <summary>Audio ADX CRI (<c>\x80\x00</c>).</summary>
    AdxAudio,
    /// <summary>Audio HCA CRI (<c>HCA\x00</c>).</summary>
    HcaAudio,
    /// <summary>Vidéo USM CRI (<c>CRID</c>).</summary>
    UsmVideo,
}

/// <summary>
/// Métadonnées associées à un <see cref="GameFileKind"/> : magic, extension, description,
/// et sa représentation pour le discriminant TypeScript.
/// </summary>
public sealed record GameFileTypeInfo(
    GameFileKind Kind,
    string Magic,
    string Extension,
    string Description,
    string TsKind);

// ── Service de détection ──────────────────────────────────────────────────────

/// <summary>
/// Détecte le <see cref="GameFileKind"/> d'un fichier LEVEL-5 / CRI par ses magic bytes
/// ou son extension de chemin.
///
/// <para>Référence : <c>re/research/ghidra-export/REPORT.md</c> §6 « Magic strings »,
/// et constantes extraites de <c>nie.exe</c>.</para>
/// </summary>
public static class GameFileType
{
    // ── Table des magics ─────────────────────────────────────────────────────

    // LEVEL-5 G4* formats — les 4 premiers octets suffisent pour la plupart.
    // G4PK@ et G4SK@ : le 5e octet '@' (0x40) distingue le format IEVR du G4PK/G4SK XPCK.
    // G4PKM : le 5e octet 'M' (0x4D) distingue le paquet menu.
    // RDBN : magic 0x4E424452 ("RDBN" LE).
    // cfg.bin T2B : pas de magic en tête — détecté par le footer 01 74 32 62.
    // CRILAYLA : 8 octets.
    // Lua 5.2 bytecode : \x1b\x4C\x75\x61 (ESC + "Lua").

    private const uint Magic_G4TX  = 0x58543447u; // "G4TX" LE
    private const uint Magic_G4PK  = 0x4B503447u; // "G4PK" LE (suivi de '@' ou 'M')
    private const uint Magic_G4SK  = 0x4B533447u; // "G4SK" LE (suivi de '@')
    private const uint Magic_G4MD  = 0x444D3447u; // "G4MD" LE (en réalité G4MDP)
    private const uint Magic_G4MG  = 0x474D3447u; // "G4MG" LE
    private const uint Magic_G4MT  = 0x544D3447u; // "G4MT" LE
    private const uint Magic_G4MA  = 0x414D3447u; // "G4MA" LE
    private const uint Magic_G4RA  = 0x41523447u; // "G4RA" LE (suivi de '`')
    private const uint Magic_RDBN  = 0x4E424452u; // "RDBN" LE
    private const uint Magic_CPK   = 0x204B5043u; // "CPK " LE
    private const uint Magic_AFS2  = 0x32534641u; // "AFS2" LE
    private const uint Magic_UTF   = 0x46545540u; // "@UTF" LE
    private const uint Magic_CRIL  = 0x4C495243u; // "CRIL" LE (4 premiers octets de CRILAYLA)
    private const uint Magic_Lua   = 0x61754C1Bu; // "\x1bLua" LE
    private const uint Magic_OBJB  = 0x626A626Fu; // "objb" LE
    private const uint Magic_PXCL  = 0x4C435850u; // "PXCL" LE
    private const uint Magic_XFSA  = 0x41534658u; // "XFSA" LE
    private const uint Magic_XPCK  = 0x4B435058u; // "XPCK" LE
    private const uint Magic_AGI   = 0x4147492Eu; // ".AGI" — uint32 LE (octets disque 2E 49 47 41), aligné FormatDetector.cs
    // NB : pas de Magic_ACB — un ACB CRI est un conteneur "@UTF" (= Magic_UTF), indistinguable de
    // l'UTF brut sur 4 octets. Détectable seulement par extension .acb (cf. FromExtension).
    private const uint Magic_HCA   = 0x00414348u; // "HCA\x00" LE
    private const uint Magic_CRID  = 0x44495243u; // "CRID" LE (USM)

    // T2B footer (derniers 4 octets) : 01 74 32 62
    private static readonly byte[] T2bFooter = [0x01, 0x74, 0x32, 0x62];

    // ── Infos publiques (pour l'émission TypeScript) ────────────────────────

    /// <summary>Toutes les entrées connues, dans l'ordre d'affichage du .d.ts.</summary>
    public static IReadOnlyList<GameFileTypeInfo> KnownTypes { get; } = [
        new(GameFileKind.CpkArchive,         "CPK ",    ".cpk",     "Archive CRI",                        "archive"),
        new(GameFileKind.G4Texture,          "G4TX",    ".g4tx",    "Texture LEVEL-5",                    "texture"),
        new(GameFileKind.G4Package,          "G4PK@",   ".g4pk",    "Paquet LEVEL-5 (layout/motions)",    "package"),
        new(GameFileKind.G4PackageMenu,      "G4PKM",   ".g4pkm",   "Paquet menu LEVEL-5",                "package-menu"),
        new(GameFileKind.G4Skeleton,         "G4SK@",   ".g4sk",    "Squelette LEVEL-5",                  "skeleton"),
        new(GameFileKind.G4ModelData,        "G4MDP",   ".g4md",    "Métadonnées modèle LEVEL-5",         "model"),
        new(GameFileKind.G4ModelGroup,       "G4MG",    ".g4mg",    "Groupe de modèles LEVEL-5",          "model-group"),
        new(GameFileKind.G4Material,         "G4MT",    ".g4mt",    "Matériau LEVEL-5",                   "material"),
        new(GameFileKind.G4Motion,           "G4MA",    ".g4ma",    "Animation LEVEL-5",                  "motion"),
        new(GameFileKind.G4ResourceArchive,  "G4RA`",   ".g4ra",    "Archive ressources LEVEL-5",         "resource-archive"),
        new(GameFileKind.AgiInfo,            ".AGI",    ".agi",     "Infos animation/graphiques LEVEL-5", "agi"),
        new(GameFileKind.CfgBin,             "T2B/RDBN",".cfg.bin", "Configuration binaire LEVEL-5",     "config"),
        new(GameFileKind.ObjBinary,          "objb",    ".objbin",  "Objets binaires LEVEL-5",            "objbin"),
        new(GameFileKind.PxclData,           "PXCL",    ".pxcl",    "Données pixel/collision LEVEL-5",   "pxcl"),
        new(GameFileKind.XfsaArchive,        "XFSA",    ".xfsa",    "Archive XFSA LEVEL-5",               "xfsa"),
        new(GameFileKind.XpckPackage,        "XPCK",    ".xpck",    "Paquet XPCK LEVEL-5",                "xpck"),
        new(GameFileKind.LuaBytecode,        "\\x1bLua",".lua.bin", "Bytecode Lua 5.2",                   "lua"),
        new(GameFileKind.CriUtfTable,        "@UTF",    ".utf",     "Table UTF CRI",                      "utf"),
        new(GameFileKind.CriLaylaCompressed, "CRILAYLA",".cri",     "Compressé CRI LZSS",                 "compressed"),
        new(GameFileKind.Afs2Archive,        "AFS2",    ".afs2",    "Archive audio CRI",                  "audio-archive"),
        new(GameFileKind.AcbBundle,          "@UTF",    ".acb",     "Bundle audio CRI ACB (.acb only)",   "audio-bundle"),
        new(GameFileKind.HcaAudio,           "HCA\\0",  ".hca",     "Audio HCA CRI",                      "audio-hca"),
        new(GameFileKind.UsmVideo,           "CRID",    ".usm",     "Vidéo USM CRI",                      "video"),
    ];

    // ── Détection par magic bytes ────────────────────────────────────────────

    /// <summary>
    /// Détecte le type d'un fichier depuis ses <paramref name="magic"/> bytes (16 premiers octets
    /// recommandés, minimum 4).
    ///
    /// <para>Retourne <see cref="GameFileKind.Unknown"/> si aucun magic n'est reconnu.</para>
    /// </summary>
    public static GameFileKind Detect(ReadOnlySpan<byte> magic)
    {
        if (magic.Length < 4) return GameFileKind.Unknown;

        uint m4 = BinaryPrimitives.ReadUInt32LittleEndian(magic);

        // ── G4PK@ vs G4PKM (5e octet discriminant) ──────────────────────
        if (m4 == Magic_G4PK)
        {
            if (magic.Length >= 5)
                return magic[4] == 0x4D ? GameFileKind.G4PackageMenu : GameFileKind.G4Package;
            // Seulement 4 octets : pas assez pour distinguer — défaut G4Package
            return GameFileKind.G4Package;
        }

        // ── G4SK@ ────────────────────────────────────────────────────────
        if (m4 == Magic_G4SK) return GameFileKind.G4Skeleton;

        // ── Autres G4* ───────────────────────────────────────────────────
        if (m4 == Magic_G4TX)  return GameFileKind.G4Texture;
        if (m4 == Magic_G4MD)  return GameFileKind.G4ModelData;
        if (m4 == Magic_G4MG)  return GameFileKind.G4ModelGroup;
        if (m4 == Magic_G4MT)  return GameFileKind.G4Material;
        if (m4 == Magic_G4MA)  return GameFileKind.G4Motion;
        if (m4 == Magic_G4RA)  return GameFileKind.G4ResourceArchive;

        // ── RDBN (cfg.bin moderne) ───────────────────────────────────────
        if (m4 == Magic_RDBN)  return GameFileKind.CfgBin;

        // ── CRI Middleware ───────────────────────────────────────────────
        if (m4 == Magic_CPK)   return GameFileKind.CpkArchive;
        if (m4 == Magic_AFS2)  return GameFileKind.Afs2Archive;
        if (m4 == Magic_UTF)   return GameFileKind.CriUtfTable;  // ACB inclus (@UTF) — voir .acb par extension
        if (m4 == Magic_HCA)   return GameFileKind.HcaAudio;
        if (m4 == Magic_CRID)  return GameFileKind.UsmVideo;

        // ── CRILAYLA (8 octets) ──────────────────────────────────────────
        if (m4 == Magic_CRIL && magic.Length >= 8)
        {
            uint m8hi = BinaryPrimitives.ReadUInt32LittleEndian(magic[4..]);
            // "AYALA" → hi = 0x414C5941 = "AYLA" LE ; dernier octet 'A'
            if (m8hi == 0x414C5941u) return GameFileKind.CriLaylaCompressed;
        }

        // ── Lua bytecode ─────────────────────────────────────────────────
        if (m4 == Magic_Lua)   return GameFileKind.LuaBytecode;

        // ── Autres LEVEL-5 ───────────────────────────────────────────────
        if (m4 == Magic_OBJB)  return GameFileKind.ObjBinary;
        if (m4 == Magic_PXCL)  return GameFileKind.PxclData;
        if (m4 == Magic_XFSA)  return GameFileKind.XfsaArchive;
        if (m4 == Magic_XPCK)  return GameFileKind.XpckPackage;
        if (m4 == Magic_AGI)   return GameFileKind.AgiInfo;

        // ── cfg.bin T2B : pas de magic en tête, détecté via le footer ───
        // (nécessite le buffer complet — utiliser DetectFromData)
        return GameFileKind.Unknown;
    }

    /// <summary>
    /// Détecte le type depuis un buffer complet (gère aussi le cfg.bin T2B dont le magic
    /// est dans le footer).
    /// </summary>
    public static GameFileKind DetectFromData(ReadOnlySpan<byte> data)
    {
        var kind = Detect(data.Length >= 16 ? data[..16] : data);
        if (kind != GameFileKind.Unknown) return kind;

        // cfg.bin T2B : footer 01 74 32 62 sur les 4 derniers octets
        if (data.Length >= 8 && HasT2BFooter(data)) return GameFileKind.CfgBin;

        return GameFileKind.Unknown;
    }

    /// <summary>
    /// Détecte le type depuis le chemin de fichier (lit les 16 premiers octets + consulte
    /// l'extension en dernier recours).
    /// </summary>
    public static GameFileKind Detect(string path)
    {
        if (!File.Exists(path)) return GameFileKind.Unknown;
        try
        {
            Span<byte> header = stackalloc byte[16];
            using var fs = File.OpenRead(path);
            int read = fs.Read(header);
            var kind = Detect(header[..read]);
            if (kind != GameFileKind.Unknown) return kind;

            // Relit entièrement pour le footer T2B (seulement si < 1 Mo pour éviter le coût)
            var fi = new FileInfo(path);
            if (fi.Length is > 0 and < 1_048_576)
            {
                var full = File.ReadAllBytes(path);
                if (HasT2BFooter(full)) return GameFileKind.CfgBin;
            }
            else if (fi.Length >= 8)
            {
                // Lit juste le footer
                Span<byte> footer = stackalloc byte[4];
                fs.Seek(-4, SeekOrigin.End);
                int footerRead = fs.ReadAtLeast(footer, minimumBytes: 0, throwOnEndOfStream: false);
                if (footerRead == 4 && footer[0] == 0x01 && footer[1] == 0x74 && footer[2] == 0x32 && footer[3] == 0x62)
                    return GameFileKind.CfgBin;
            }

            return FromExtension(path);
        }
        catch
        {
            return GameFileKind.Unknown;
        }
    }

    /// <summary>
    /// Retourne le <see cref="GameFileTypeInfo"/> correspondant, ou <c>null</c> si inconnu.
    /// </summary>
    public static GameFileTypeInfo? GetInfo(GameFileKind kind)
        => KnownTypes.FirstOrDefault(t => t.Kind == kind);

    /// <summary>
    /// Émet un fichier <c>.d.ts</c> TypeScript contenant l'union discriminée de tous les
    /// types de fichiers LEVEL-5 / CRI connus.
    ///
    /// <para>Le fichier est destiné à <c>re/types/game-files.d.ts</c> (gitignored).</para>
    /// </summary>
    public static string EmitDts()
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("// AUTO-GÉNÉRÉ par `iecode cfg types` — NE PAS ÉDITER.");
        sb.AppendLine("// Union discriminée des types de fichiers LEVEL-5 / CRI (IEVR).");
        sb.AppendLine();
        sb.AppendLine("export type GameFile =");
        for (int i = 0; i < KnownTypes.Count; i++)
        {
            var t = KnownTypes[i];
            string magic = t.Magic.Replace("\\", "\\\\").Replace("\"", "\\\"");
            string sep   = i == KnownTypes.Count - 1 ? ";" : "";
            sb.AppendLine($"  | {{ magic: \"{magic}\"; kind: \"{t.Kind}\"; extension: \"{t.Extension}\"; description: \"{t.Description}\" }}{sep}");
        }
        sb.AppendLine();
        sb.AppendLine("export type GameFileKind =");
        for (int i = 0; i < KnownTypes.Count; i++)
        {
            string sep = i == KnownTypes.Count - 1 ? ";" : "";
            sb.AppendLine($"  | \"{KnownTypes[i].Kind}\"{sep}");
        }
        return sb.ToString();
    }

    // ── Helpers privés ───────────────────────────────────────────────────────

    private static bool HasT2BFooter(ReadOnlySpan<byte> data)
    {
        if (data.Length < 4) return false;
        var tail = data[^4..];
        return tail[0] == T2bFooter[0] && tail[1] == T2bFooter[1]
            && tail[2] == T2bFooter[2] && tail[3] == T2bFooter[3];
    }

    private static GameFileKind FromExtension(string path)
    {
        // Gère les doubles extensions : .lua.bin, .cfg.bin
        string name = Path.GetFileName(path).ToLowerInvariant();
        if (name.EndsWith(".lua.bin",  StringComparison.Ordinal)) return GameFileKind.LuaBytecode;
        if (name.EndsWith(".cfg.bin",  StringComparison.Ordinal)) return GameFileKind.CfgBin;
        return Path.GetExtension(path).ToLowerInvariant() switch
        {
        ".g4tx"    => GameFileKind.G4Texture,
        ".g4sk"    => GameFileKind.G4Skeleton,
        ".g4md"    => GameFileKind.G4ModelData,
        ".g4mg"    => GameFileKind.G4ModelGroup,
        ".g4mt"    => GameFileKind.G4Material,
        ".g4ma"    => GameFileKind.G4Motion,
        ".g4ra"    => GameFileKind.G4ResourceArchive,
        ".g4pkm"   => GameFileKind.G4PackageMenu,
        ".g4pk"    => GameFileKind.G4Package,
        ".cpk"     => GameFileKind.CpkArchive,
        ".cfg.bin" => GameFileKind.CfgBin,
        ".bin"     => GameFileKind.CfgBin,  // heuristique
        ".objbin"  => GameFileKind.ObjBinary,
        ".pxcl"    => GameFileKind.PxclData,
        ".xfsa"    => GameFileKind.XfsaArchive,
        ".xpck"    => GameFileKind.XpckPackage,
        ".agi"     => GameFileKind.AgiInfo,
        ".afs2"    => GameFileKind.Afs2Archive,
        ".acb"     => GameFileKind.AcbBundle,
        ".awb"     => GameFileKind.AwbWaveBank,
        ".hca"     => GameFileKind.HcaAudio,
        ".adx"     => GameFileKind.AdxAudio,
        ".usm"     => GameFileKind.UsmVideo,
        ".utf"     => GameFileKind.CriUtfTable,
        _          => GameFileKind.Unknown,
        };
    }
}
