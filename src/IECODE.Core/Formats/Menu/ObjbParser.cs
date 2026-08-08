using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace IECODE.Core.Formats.Menu;

// ── Modèles ─────────────────────────────────────────────────────────────────

/// <summary>
/// Objet de menu parsé depuis un fichier .objbin.
/// Chaque fichier contient exactement un objet racine.
/// </summary>
public sealed class MenuObject
{
    /// <summary>Nom de l'objet (paramètre de OBJ_BGN, ex. "title00_09_version").</summary>
    public string Name { get; init; } = string.Empty;

    /// <summary>Type moteur (SETUP_BGN, toujours "gmdMenuObj" dans IEVR).</summary>
    public string EngineType { get; init; } = string.Empty;

    /// <summary>Référence au paquet d'animation 3D (.g4pkm) — chemin logique relatif.</summary>
    public string? G4pkmPath { get; init; }

    /// <summary>Chemin logique de la texture principale (.g4tx, avec &lt;LG&gt; pour la locale).</summary>
    public string? G4txPath { get; init; }

    /// <summary>Composants attachés à l'objet.</summary>
    public IReadOnlyList<MenuComponent> Components { get; init; } = Array.Empty<MenuComponent>();
}

/// <summary>Composant de menu (base commune).</summary>
public abstract class MenuComponent
{
    /// <summary>Nom RTTI du composant (ex. "CMenuRenderComponent").</summary>
    public string TypeName { get; init; } = string.Empty;
}

/// <summary>
/// CMenuRenderComponent — rendu (z-order, mode de dessin, caméra).
/// Les champs entier de m_cameraName sont des hash CRC-32 de noms de caméra.
/// </summary>
public sealed class RenderComponent : MenuComponent
{
    /// <summary>Priorité de dessin (z-order croissant = au-dessus).</summary>
    public int DrawPriority { get; init; }

    /// <summary>Mode de dessin (0=normal, 1=additif, 4=…).</summary>
    public int DrawType { get; init; }

    /// <summary>CRC-32 du nom de caméra (ex. 0x02D8FB06 pour la caméra "menu").</summary>
    public uint CameraNameHash { get; init; }
}

/// <summary>
/// CMenuAnimation — animations d'ouverture/fermeture.
/// Les noms de motions sont stockés comme hash CRC-32.
/// </summary>
public sealed class AnimationComponent : MenuComponent
{
    /// <summary>Hash CRC-32 du nom de motion d'ouverture (m_nameMotOpen).</summary>
    public uint MotOpenHash { get; init; }

    /// <summary>Hash CRC-32 du nom de motion de fermeture, si présent.</summary>
    public uint MotCloseHash { get; init; }

    /// <summary>Hash CRC-32 du nom de motion de sélection, si présent.</summary>
    public uint MotSelectHash { get; init; }
}

/// <summary>
/// MenuTextSetting — clés de texte localisées (lookup dans common/text/&lt;locale&gt;/).
/// Les clés et valeurs sont des hash CRC-32 de noms.
/// </summary>
public sealed class TextComponent : MenuComponent
{
    /// <summary>Index ou mode de la table texte (paramètre entier de PROP_INFO_BGN).</summary>
    public int TableIndex { get; init; }

    /// <summary>
    /// Entrées texte : clé = nom du slot (ex. "_text_choice01_on"), valeurs = hash CRC-32.
    /// </summary>
    public IReadOnlyList<TextEntry> Entries { get; init; } = Array.Empty<TextEntry>();
}

/// <summary>Entrée texte : slot nommé + hash(es) de résolution.</summary>
public sealed class TextEntry
{
    /// <summary>Nom du slot texte (ex. "_text_choice01_on").</summary>
    public string Key { get; init; } = string.Empty;

    /// <summary>Hash(es) de résolution (hash de la chaîne de texte dans le dico).</summary>
    public IReadOnlyList<uint> Hashes { get; init; } = Array.Empty<uint>();
}

/// <summary>
/// CMenuCreatePrimitiveComponent — primitives graphiques (rectangles, jauges…).
/// Contient des références nommées (MenuNumberSettingName) et des maximums (DispMaxValue).
/// </summary>
public sealed class PrimitiveComponent : MenuComponent
{
    /// <summary>Hash(es) de noms de primitives enregistrées (MenuNumberSettingName).</summary>
    public IReadOnlyList<uint> NumberSettingHashes { get; init; } = Array.Empty<uint>();

    /// <summary>Maximums par primitive : hash → valeur max (DispMaxValue).</summary>
    public IReadOnlyList<DispMaxEntry> DispMaxValues { get; init; } = Array.Empty<DispMaxEntry>();
}

/// <summary>Valeur maximale d'affichage pour une primitive.</summary>
public sealed class DispMaxEntry
{
    public uint PrimitiveHash { get; init; }
    public int MaxValue { get; init; }
}

/// <summary>
/// CMenuAttachLocator — points d'attache (null layers).
/// </summary>
public sealed class AttachLocatorComponent : MenuComponent
{
    /// <summary>Nom de la couche null (NullLayerName), sous forme de hash(es) CRC-32.</summary>
    public IReadOnlyList<uint> NullLayerHashes { get; init; } = Array.Empty<uint>();
}

/// <summary>
/// MenuCollisionSetting — zones de collision tactile.
/// </summary>
public sealed class CollisionComponent : MenuComponent
{
    /// <summary>Mode (0 = standard, etc.).</summary>
    public int Mode { get; init; }

    /// <summary>Entrées de collision : nom du touch → [enabled, type, …].</summary>
    public IReadOnlyList<CollisionEntry> Entries { get; init; } = Array.Empty<CollisionEntry>();
}

/// <summary>Entrée de collision tactile.</summary>
public sealed class CollisionEntry
{
    public string Key { get; init; } = string.Empty;
    public int Enabled { get; init; }
    public int Type { get; init; }
    public int Extra { get; init; }
}

/// <summary>
/// CMenuSoundCmdProperty — commandes sonores associées à l'objet.
/// </summary>
public sealed class SoundCmdComponent : MenuComponent
{
    /// <summary>Entrées son : nom de commande → paramètre entier.</summary>
    public IReadOnlyList<SoundCmdEntry> Entries { get; init; } = Array.Empty<SoundCmdEntry>();
}

/// <summary>Entrée son.</summary>
public sealed class SoundCmdEntry
{
    public string Command { get; init; } = string.Empty;
    public int Param { get; init; }
}

/// <summary>
/// CSetupMeshVisible — visibilité de meshes nommés (par CRC).
/// </summary>
public sealed class MeshVisibleComponent : MenuComponent
{
    /// <summary>Entrées de visibilité : hash du mesh → booléen visible.</summary>
    public IReadOnlyList<MeshVisibleEntry> Params { get; init; } = Array.Empty<MeshVisibleEntry>();
}

/// <summary>Entrée de visibilité de mesh.</summary>
public sealed class MeshVisibleEntry
{
    public uint MeshNameCrc { get; init; }
    public bool IsVisible { get; init; }
}

/// <summary>
/// Composant générique pour les types non reconnus (préserve le nom RTTI et les paramètres bruts).
/// </summary>
public sealed class UnknownComponent : MenuComponent
{
    /// <summary>Paramètres bruts (PROP_PARAM) sous forme de liste : (clé, [int…]).</summary>
    public IReadOnlyList<(string Key, IReadOnlyList<int> Values)> RawParams { get; init; }
        = Array.Empty<(string, IReadOnlyList<int>)>();
}

// ── Erreur de parse ──────────────────────────────────────────────────────────

/// <summary>Erreur levée lors du parsing d'un fichier .objbin invalide.</summary>
public sealed class ObjbParseException : Exception
{
    public ObjbParseException(string message) : base(message) { }
    public ObjbParseException(string message, Exception inner) : base(message, inner) { }
}

// ── Parseur ──────────────────────────────────────────────────────────────────

/// <summary>
/// Parseur de fichiers .objbin (OBJB — arbre d'objets-menu IEVR).
///
/// Format identique au conteneur cfg.bin de Level-5 (IECODE.Core.Formats.Level5.CfgBin) :
/// en-tête 16 octets + zone d'entrées + table de chaînes + table de clés + pied de page.
/// Les données sémantiques OBJB sont extraites des records typés à clés hashées CRC-32.
///
/// Structure d'un objet :
///   OBJ_BGN("name")
///     SETUP_BGN("gmdMenuObj")
///       SETUP_PARAM("SkeletonAnime", "path/to.g4pkm")
///       SETUP_PARAM("Texture",       "#/path/<LG>/file.g4tx")
///     SETUP_END
///     PROP_INFO_BGN("CMenuRenderComponent")
///       PROP_PARAM("m_drawPriority", int)
///       PROP_PARAM("m_drawType",     int)
///       PROP_PARAM("m_cameraName",   hash)
///     PROP_INFO_END
///     PROP_INFO_BGN("MenuTextSetting", int?)
///       PROP_PARAM("_text_xxx", hash…)
///     PROP_INFO_END
///     …
///   OBJ_END
///
/// Réutilise la logique de décodage de CfgBin (même format binaire) sans la dupliquer.
/// </summary>
public static class ObjbParser
{
    // Hashes CRC-32 des records connus (validés sur les vrais fichiers)
    private const uint CrcObjBgn       = 0xB1D0C26E; // "OBJ_BGN"
    private const uint CrcSetupBgn     = 0xB14DCDB0; // "SETUP_BGN"
    private const uint CrcSetupParam   = 0x8BB13144; // "SETUP_PARAM"
    private const uint CrcSetupEnd     = 0x85158962; // "SETUP_END"
    private const uint CrcPropInfoBgn  = 0x689952A2; // "PROP_INFO_BGN"
    private const uint CrcPropParam    = 0xBD064D3E; // "PROP_PARAM"
    private const uint CrcPropInfoEnd  = 0x5CC11670; // "PROP_INFO_END"
    private const uint CrcPropParamBgn = 0x6454D5A5; // "PROP_PARAM_BGN"
    private const uint CrcPropParamEnd = 0x500C9177; // "PROP_PARAM_END"
    private const uint CrcObjEnd       = 0x858886BC; // "OBJ_END"

    // Pied de page cfg.bin standard
    private static readonly byte[] Footer = { 0x01, 0x74, 0x32, 0x62 };

    /// <summary>
    /// Parse un fichier .objbin depuis un tableau d'octets.
    /// </summary>
    /// <param name="data">Contenu brut du fichier .objbin.</param>
    /// <returns>L'objet de menu parsé.</returns>
    /// <exception cref="ObjbParseException">Le fichier est invalide ou corrompu.</exception>
    public static MenuObject Parse(byte[] data)
    {
        if (data is null) throw new ArgumentNullException(nameof(data));
        return Parse(new ReadOnlySpan<byte>(data));
    }

    /// <summary>
    /// Parse un fichier .objbin depuis un flux.
    /// </summary>
    public static MenuObject Parse(Stream stream)
    {
        if (stream is null) throw new ArgumentNullException(nameof(stream));
        using var ms = new MemoryStream();
        stream.CopyTo(ms);
        return Parse(ms.ToArray());
    }

    /// <summary>
    /// Vérifie rapidement si un tableau d'octets est un fichier .objbin valide
    /// (pied de page cfg.bin présent).
    /// </summary>
    public static bool IsObjb(ReadOnlySpan<byte> data)
    {
        if (data.Length < 16) return false;
        int searchStart = Math.Max(0, data.Length - 32);
        for (int i = searchStart; i <= data.Length - 4; i++)
        {
            if (data[i] == 0x01 && data[i + 1] == 0x74 && data[i + 2] == 0x32 && data[i + 3] == 0x62)
                return true;
        }
        return false;
    }

    // ── Parse interne ────────────────────────────────────────────────────────

    private static MenuObject Parse(ReadOnlySpan<byte> data)
    {
        if (data.Length < 16)
            throw new ObjbParseException("Fichier trop petit pour être un .objbin valide.");

        if (!IsObjb(data))
            throw new ObjbParseException("Pied de page cfg.bin absent — fichier .objbin invalide.");

        // En-tête : 4 × int32 LE
        int entryCount     = BinaryPrimitives.ReadInt32LittleEndian(data);
        int strTableOffset = BinaryPrimitives.ReadInt32LittleEndian(data[4..]);
        int strTableLength = BinaryPrimitives.ReadInt32LittleEndian(data[8..]);
        int strTableCount  = BinaryPrimitives.ReadInt32LittleEndian(data[12..]);

        if (strTableOffset < 0x10 || strTableOffset > data.Length)
            throw new ObjbParseException($"StringTableOffset invalide : 0x{strTableOffset:X}");
        if (strTableLength < 0 || (long)strTableOffset + strTableLength > data.Length)
            throw new ObjbParseException("StringTable dépasse la fin du fichier.");

        // Table de chaînes
        var strings = ParseStringTable(data.Slice(strTableOffset, strTableLength));

        // Table de clés (après strings, alignée à 16 octets)
        long rawEnd    = (long)strTableOffset + strTableLength;
        int  ktOffset  = (int)((rawEnd + 15) & ~15L);
        var  keyTable  = ParseKeyTable(data, ktOffset);

        // Zone d'entrées : [0x10 .. strTableOffset)
        var entries = ParseEntries(data.Slice(0x10, strTableOffset - 0x10), entryCount, strings, keyTable);

        return BuildObject(entries);
    }

    // ── Table de chaînes ─────────────────────────────────────────────────────

    private static Dictionary<int, string> ParseStringTable(ReadOnlySpan<byte> buf)
    {
        var result = new Dictionary<int, string>();
        int pos = 0;
        while (pos < buf.Length)
        {
            int start = pos;
            while (pos < buf.Length && buf[pos] != 0) pos++;
            if (pos > start)
                result[start] = Encoding.UTF8.GetString(buf.Slice(start, pos - start));
            pos++; // saute le null
        }
        return result;
    }

    // ── Table de clés ────────────────────────────────────────────────────────

    private static Dictionary<uint, string> ParseKeyTable(ReadOnlySpan<byte> data, int ktOffset)
    {
        if (ktOffset + 16 > data.Length)
            return new Dictionary<uint, string>();

        // KeyHeader : int KeyLength, int KeyCount, int KeyStringOffset, int KeyStringLength
        int keyLength        = BinaryPrimitives.ReadInt32LittleEndian(data[ktOffset..]);
        int keyCount         = BinaryPrimitives.ReadInt32LittleEndian(data[(ktOffset + 4)..]);
        int keyStringOffset  = BinaryPrimitives.ReadInt32LittleEndian(data[(ktOffset + 8)..]);

        var result = new Dictionary<uint, string>(keyCount);
        int entriesBase = ktOffset + 0x10; // après le header de 16 octets
        int stringBase  = ktOffset + keyStringOffset;

        for (int i = 0; i < keyCount; i++)
        {
            int pos = entriesBase + i * 8;
            if (pos + 8 > data.Length) break;

            uint crc     = BinaryPrimitives.ReadUInt32LittleEndian(data[pos..]);
            int  strOff  = BinaryPrimitives.ReadInt32LittleEndian(data[(pos + 4)..]);
            int  strStart = stringBase + strOff;
            int  strEnd   = strStart;

            while (strEnd < data.Length && data[strEnd] != 0) strEnd++;

            if (strStart < data.Length)
                result[crc] = Encoding.UTF8.GetString(data.Slice(strStart, strEnd - strStart));
        }
        return result;
    }

    // ── Entrées brutes ───────────────────────────────────────────────────────

    /// <summary>
    /// Entrée brute parsée : CRC de type + paramètres typés.
    /// ParamTypes[j] : 0=String, 1=Int, 2=Float, 3=Unknown.
    /// StrParams[j]  : valeur résolue si ParamTypes[j]==0, sinon null.
    /// IntParams[j]  : valeur brute si ParamTypes[j]!=0, sinon 0.
    /// </summary>
    private sealed record RawEntry(uint Crc, string? Name, byte[] ParamTypes, string?[] StrParams, int[] IntParams);

    private static List<RawEntry> ParseEntries(
        ReadOnlySpan<byte> buf, int count,
        Dictionary<int, string> strings, Dictionary<uint, string> keyTable)
    {
        var result = new List<RawEntry>(count);
        int pos = 0;

        for (int i = 0; i < count; i++)
        {
            if (pos + 5 > buf.Length)
                throw new ObjbParseException($"Entrée {i} dépasse le buffer.");

            uint crc        = BinaryPrimitives.ReadUInt32LittleEndian(buf[pos..]);
            int  paramCount = buf[pos + 4];
            int  typeBytes  = (paramCount + 3) / 4;
            pos += 5;

            // Lit les types (2 bits par param)
            var paramTypes = new byte[paramCount];
            int paramIndex = 0;
            for (int j = 0; j < typeBytes; j++)
            {
                byte tb = buf[pos++];
                for (int k = 0; k < 4 && paramIndex < paramCount; k++, paramIndex++)
                    paramTypes[paramIndex] = (byte)((tb >> (2 * k)) & 3);
            }

            // Aligne à 4 octets depuis le début du buffer
            if (pos % 4 != 0) pos = (pos + 3) & ~3;

            // Lit les valeurs
            var strParams = new string?[paramCount];
            var intParams = new int[paramCount];

            for (int j = 0; j < paramCount; j++)
            {
                if (pos + 4 > buf.Length)
                    throw new ObjbParseException($"Paramètre {j} de l'entrée {i} dépasse le buffer.");

                int raw = BinaryPrimitives.ReadInt32LittleEndian(buf[pos..]);
                pos += 4;

                switch (paramTypes[j])
                {
                    case 0: // String : raw = offset dans la table de chaînes
                        strParams[j] = raw != -1 && strings.TryGetValue(raw, out var sv) ? sv : null;
                        break;
                    case 1: // Int
                    case 2: // Float (stocké comme int brut ici, pas besoin de SingleToInt32Bits)
                    case 3: // Unknown
                    default:
                        intParams[j] = raw;
                        break;
                }
            }

            keyTable.TryGetValue(crc, out var name);
            result.Add(new RawEntry(crc, name, paramTypes, strParams, intParams));
        }

        return result;
    }

    // ── Helpers d'extraction ────────────────────────────────────────────────

    /// <summary>
    /// Extrait les valeurs numériques (non-String) d'une entrée.
    /// Dans les PROP_PARAM, param[0] est toujours la clé String et les suivants
    /// sont des entiers (hash CRC-32 ou valeurs scalaires).
    /// </summary>
    private static int[] ExtractIntValues(RawEntry e)
    {
        int paramCount = e.ParamTypes.Length;
        var result = new System.Collections.Generic.List<int>(paramCount);
        for (int j = 0; j < paramCount; j++)
        {
            // Saute les params de type String (type tag = 0)
            if (e.ParamTypes[j] == 0) continue;
            result.Add(e.IntParams[j]);
        }
        return result.ToArray();
    }

    // ── Construction de l'objet ──────────────────────────────────────────────

    private static MenuObject BuildObject(List<RawEntry> entries)
    {
        // L'objet commence avec OBJ_BGN et finit avec OBJ_END
        int i = 0;
        if (i >= entries.Count || entries[i].Crc != CrcObjBgn)
            throw new ObjbParseException("OBJ_BGN attendu en position 0.");

        string objName = entries[i].StrParams.Length > 0 ? entries[i].StrParams[0] ?? string.Empty : string.Empty;
        i++;

        // SETUP_BGN … SETUP_END
        string engineType = string.Empty;
        string? g4pkmPath = null;
        string? g4txPath  = null;

        if (i < entries.Count && entries[i].Crc == CrcSetupBgn)
        {
            engineType = entries[i].StrParams.Length > 0 ? entries[i].StrParams[0] ?? string.Empty : string.Empty;
            i++;

            while (i < entries.Count && entries[i].Crc == CrcSetupParam)
            {
                var e = entries[i];
                string? key = e.StrParams.Length > 0 ? e.StrParams[0] : null;
                string? val = e.StrParams.Length > 1 ? e.StrParams[1] : null;

                if (key == "SkeletonAnime") g4pkmPath = val;
                else if (key == "Texture")  g4txPath  = NormalizeG4txPath(val);
                i++;
            }

            // SETUP_END
            if (i < entries.Count && entries[i].Crc == CrcSetupEnd) i++;
        }

        // PROP_INFO_BGN … PROP_INFO_END (répété pour chaque composant)
        var components = new List<MenuComponent>();

        while (i < entries.Count && entries[i].Crc != CrcObjEnd)
        {
            if (entries[i].Crc == CrcPropInfoBgn)
            {
                string compType  = entries[i].StrParams.Length > 0 ? entries[i].StrParams[0] ?? string.Empty : string.Empty;
                // La param 0 est la clé String, les éventuels params suivants sont des entiers (ex. mode de table texte)
                var    modeVals  = ExtractIntValues(entries[i]);
                int    compMode  = modeVals.Length > 0 ? modeVals[0] : 0;
                i++;

                // Collecte les PROP_PARAM et les blocs PROP_PARAM_BGN/END jusqu'à PROP_INFO_END
                var rawProps = new List<(string Key, int[] Values)>();
                var nestedGroups = new List<List<(string Key, int[] Values)>>();

                while (i < entries.Count && entries[i].Crc != CrcPropInfoEnd)
                {
                    if (entries[i].Crc == CrcPropParam)
                    {
                        var e   = entries[i];
                        var key = e.StrParams.Length > 0 ? e.StrParams[0] ?? string.Empty : string.Empty;
                        // La param 0 est la clé (String), les params suivants sont les valeurs (Int/hash).
                        // ExtractIntValues ignore les slots String et ne renvoie que les valeurs numériques.
                        rawProps.Add((key, ExtractIntValues(e)));
                        i++;
                    }
                    else if (entries[i].Crc == CrcPropParamBgn)
                    {
                        // Sous-bloc (ex. Param pour CSetupMeshVisible)
                        string? groupName = entries[i].StrParams.Length > 0 ? entries[i].StrParams[0] : null;
                        i++;
                        var group = new List<(string Key, int[] Values)>();
                        while (i < entries.Count && entries[i].Crc != CrcPropParamEnd)
                        {
                            if (entries[i].Crc == CrcPropParam)
                            {
                                var e   = entries[i];
                                var key = e.StrParams.Length > 0 ? e.StrParams[0] ?? string.Empty : string.Empty;
                                group.Add((key, ExtractIntValues(e)));
                            }
                            i++;
                        }
                        if (i < entries.Count) i++; // saute PROP_PARAM_END
                        nestedGroups.Add(group);
                    }
                    else
                    {
                        i++;
                    }
                }
                if (i < entries.Count) i++; // saute PROP_INFO_END

                components.Add(BuildComponent(compType, compMode, rawProps, nestedGroups));
            }
            else
            {
                i++;
            }
        }

        return new MenuObject
        {
            Name        = objName,
            EngineType  = engineType,
            G4pkmPath   = g4pkmPath,
            G4txPath    = g4txPath,
            Components  = components.AsReadOnly()
        };
    }

    // ── Construction des composants ──────────────────────────────────────────

    private static MenuComponent BuildComponent(
        string typeName, int mode,
        List<(string Key, int[] Values)> props,
        List<List<(string Key, int[] Values)>> nested)
    {
        switch (typeName)
        {
            case "CMenuRenderComponent":
                return BuildRenderComponent(typeName, props);

            case "CMenuAnimation":
                return BuildAnimationComponent(typeName, props);

            case "MenuTextSetting":
                return BuildTextComponent(typeName, mode, props);

            case "CMenuCreatePrimitiveComponent":
                return BuildPrimitiveComponent(typeName, props);

            case "CMenuAttachLocator":
                return BuildAttachLocatorComponent(typeName, props);

            case "MenuCollisionSetting":
                return BuildCollisionComponent(typeName, mode, props);

            case "CMenuSoundCmdProperty":
                return BuildSoundCmdComponent(typeName, props);

            case "CSetupMeshVisible":
                return BuildMeshVisibleComponent(typeName, props, nested);

            default:
                return BuildUnknownComponent(typeName, props);
        }
    }

    private static RenderComponent BuildRenderComponent(
        string typeName, List<(string Key, int[] Values)> props)
    {
        int  drawPriority    = 0;
        int  drawType        = 0;
        uint cameraNameHash  = 0;

        foreach (var (key, vals) in props)
        {
            if (vals.Length == 0) continue;
            switch (key)
            {
                case "m_drawPriority": drawPriority   = vals[0]; break;
                case "m_drawType":     drawType        = vals[0]; break;
                case "m_cameraName":   cameraNameHash  = (uint)vals[0]; break;
            }
        }

        return new RenderComponent
        {
            TypeName       = typeName,
            DrawPriority   = drawPriority,
            DrawType       = drawType,
            CameraNameHash = cameraNameHash
        };
    }

    private static AnimationComponent BuildAnimationComponent(
        string typeName, List<(string Key, int[] Values)> props)
    {
        uint motOpen   = 0;
        uint motClose  = 0;
        uint motSelect = 0;

        foreach (var (key, vals) in props)
        {
            if (vals.Length == 0) continue;
            switch (key)
            {
                case "m_nameMotOpen":
                    motOpen = (uint)vals[0];
                    if (vals.Length > 1) motClose  = (uint)vals[1];
                    if (vals.Length > 2) motSelect = (uint)vals[2];
                    break;
            }
        }

        return new AnimationComponent
        {
            TypeName      = typeName,
            MotOpenHash   = motOpen,
            MotCloseHash  = motClose,
            MotSelectHash = motSelect
        };
    }

    private static TextComponent BuildTextComponent(
        string typeName, int mode, List<(string Key, int[] Values)> props)
    {
        var entries = new List<TextEntry>(props.Count);
        foreach (var (key, vals) in props)
        {
            var hashes = new uint[vals.Length];
            for (int j = 0; j < vals.Length; j++) hashes[j] = (uint)vals[j];
            entries.Add(new TextEntry { Key = key, Hashes = hashes });
        }
        return new TextComponent
        {
            TypeName   = typeName,
            TableIndex = mode,
            Entries    = entries.AsReadOnly()
        };
    }

    private static PrimitiveComponent BuildPrimitiveComponent(
        string typeName, List<(string Key, int[] Values)> props)
    {
        var numberSettingHashes = new List<uint>();
        var dispMaxValues       = new List<DispMaxEntry>();

        foreach (var (key, vals) in props)
        {
            switch (key)
            {
                case "MenuNumberSettingName":
                    foreach (var v in vals) numberSettingHashes.Add((uint)v);
                    break;
                case "DispMaxValue":
                    if (vals.Length >= 2)
                        dispMaxValues.Add(new DispMaxEntry { PrimitiveHash = (uint)vals[0], MaxValue = vals[1] });
                    break;
            }
        }

        return new PrimitiveComponent
        {
            TypeName            = typeName,
            NumberSettingHashes = numberSettingHashes.AsReadOnly(),
            DispMaxValues       = dispMaxValues.AsReadOnly()
        };
    }

    private static AttachLocatorComponent BuildAttachLocatorComponent(
        string typeName, List<(string Key, int[] Values)> props)
    {
        var hashes = new List<uint>();
        foreach (var (key, vals) in props)
        {
            if (key == "NullLayerName")
                foreach (var v in vals) hashes.Add((uint)v);
        }
        return new AttachLocatorComponent { TypeName = typeName, NullLayerHashes = hashes.AsReadOnly() };
    }

    private static CollisionComponent BuildCollisionComponent(
        string typeName, int mode, List<(string Key, int[] Values)> props)
    {
        var entries = new List<CollisionEntry>(props.Count);
        foreach (var (key, vals) in props)
        {
            entries.Add(new CollisionEntry
            {
                Key     = key,
                Enabled = vals.Length > 0 ? vals[0] : 0,
                Type    = vals.Length > 1 ? vals[1] : 0,
                Extra   = vals.Length > 2 ? vals[2] : 0
            });
        }
        return new CollisionComponent { TypeName = typeName, Mode = mode, Entries = entries.AsReadOnly() };
    }

    private static SoundCmdComponent BuildSoundCmdComponent(
        string typeName, List<(string Key, int[] Values)> props)
    {
        var entries = new List<SoundCmdEntry>(props.Count);
        foreach (var (key, vals) in props)
            entries.Add(new SoundCmdEntry { Command = key, Param = vals.Length > 0 ? vals[0] : 0 });

        return new SoundCmdComponent { TypeName = typeName, Entries = entries.AsReadOnly() };
    }

    private static MeshVisibleComponent BuildMeshVisibleComponent(
        string typeName,
        List<(string Key, int[] Values)> props,
        List<List<(string Key, int[] Values)>> nested)
    {
        var paramsList = new List<MeshVisibleEntry>(nested.Count);
        foreach (var group in nested)
        {
            uint crc = 0;
            bool vis = false;
            foreach (var (k, v) in group)
            {
                if (k == "meshNameCrc" && v.Length > 0) crc = (uint)v[0];
                if (k == "isVisible"   && v.Length > 0) vis = v[0] != 0;
            }
            paramsList.Add(new MeshVisibleEntry { MeshNameCrc = crc, IsVisible = vis });
        }
        return new MeshVisibleComponent { TypeName = typeName, Params = paramsList.AsReadOnly() };
    }

    private static UnknownComponent BuildUnknownComponent(
        string typeName, List<(string Key, int[] Values)> props)
    {
        var raw = new List<(string, IReadOnlyList<int>)>(props.Count);
        foreach (var (k, v) in props) raw.Add((k, v));
        return new UnknownComponent { TypeName = typeName, RawParams = raw.AsReadOnly() };
    }

    // ── Utilitaires ──────────────────────────────────────────────────────────

    /// <summary>
    /// Normalise un chemin de texture .g4tx : remplace le préfixe "#/" par
    /// "dx11/" (convention du serveur d'assets azalee/CDN).
    /// </summary>
    private static string? NormalizeG4txPath(string? path)
    {
        if (path is null) return null;
        if (path.StartsWith("#/", StringComparison.Ordinal))
            return "dx11/" + path[2..];
        return path;
    }
}
