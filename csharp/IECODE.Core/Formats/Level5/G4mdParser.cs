using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace IECODE.Core.Formats.Level5;

/// <summary>
/// Parser for G4MD (Level-5 Model Data).
/// Contains geometry data (vertices, indices, submeshes).
/// 
/// Reverse Engineered from nie.exe FUN_14056d530:
/// - Format is stored as Big-Endian, converted to Little-Endian at load
/// - Header contains section offsets for vertex/face/bone data
/// - Multiple data sections with different strides
/// 
/// AOT-Compatible: No reflection.
/// </summary>
public class G4mdParser
{
    /// <summary>Magic "G4MD" in Little-Endian (as read on x86)</summary>
    public const uint MAGIC_LE = 0x444D3447;

    /// <summary>Magic "G4MD" in Big-Endian (native format)</summary>
    public const uint MAGIC_BE = 0x47344D44;

    // Legacy alias
    public const uint MAGIC = MAGIC_LE;

    /// <summary>
    /// G4MD Header structure (0x44+ bytes)
    /// Stored as Big-Endian, requires byte-swapping on x86.
    /// Based on FUN_14056d530 reverse engineering.
    /// </summary>
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    public struct G4mdHeader
    {
        public uint Magic;              // 0x00: "G4MD"
        public ushort SubmeshInfo;      // 0x04: offset de la table des sous-mailles (records 0x50)
        public ushort Field06;          // 0x06: taille de header observée (ex. 0x68)
        public byte Field08;            // 0x08
        public byte Field09;            // 0x09
        public ushort SectionBase;      // 0x0A: base pour le calcul des offsets de section
        public uint Field0C;            // 0x0C: byte-swapped (32-bit)

        // Reserved: 0x10-0x1F (16 bytes)

        public ushort SubmeshCount;     // 0x20: nombre de sous-mailles (vérifié sur fichiers réels)
        public ushort MaterialCount;    // 0x22: nombre de matériaux (vérifié sur fichiers réels)
        public byte BoneCount;          // 0x24: nombre de références d'os
        public byte Reserved25;         // 0x25
        public byte VLayoutCount;       // 0x26: nombre d'attributs dans la table de layout vertex
        public byte Reserved27;         // 0x27

        public uint Field28;            // 0x28: byte-swapped
        public uint Field2C;            // 0x2C: byte-swapped

        // Section offset table (all ushort, byte-swapped)
        public ushort VertexDataOffset; // 0x30: Vertex section offset
        public ushort BoneRefOffset;    // 0x32: Bone reference offset
        public ushort Section34Offset;  // 0x34
        public ushort Section36Offset;  // 0x36
        public ushort Section38Offset;  // 0x38
        public ushort Section3AOffset;  // 0x3A
        public ushort IndexOffset;      // 0x3C: Index buffer offset
        public ushort Section3EOffset;  // 0x3E
        public ushort Section40Offset;  // 0x40
        public ushort Section42Offset;  // 0x42

        /// <summary>
        /// 0x5C u32 : offset de base du bloc de données d'index (face_data) dans le .g4mg compagnon.
        /// Les offsets de face de chaque sous-maille s'y ajoutent (vérifié sur chr/_uniform et _face).
        /// </summary>
        public uint FaceDataBase;       // 0x5C

        // Legacy accessors
        public readonly ushort HeaderSize => (ushort)(SectionBase * 4);
        public readonly ushort TypeId => Field06;
        public readonly uint Unk1 => (uint)(Field08 | (Field09 << 8));
        public readonly uint Unk2 => Field0C;
        // Anciens noms conservés : VertexCount/FaceCount désignaient en réalité
        // submesh_count / material_count (relabellisés d'après les octets réels).
        public readonly ushort VertexCount => SubmeshCount;
        public readonly ushort FaceCount => MaterialCount;
        public readonly ushort TotalCount => MaterialCount;
    }

    /// <summary>
    /// Submesh/geometry section data
    /// </summary>
    public struct Submesh
    {
        public string Name;
        public int IndexCount;
        public int MaterialIndex;
        public uint VertexFormat;
        public int IndexBufferOffset;
        public int IndexBufferSize;
        public int VertexCount;
        public int VertexBufferOffset;

        /// <summary>
        /// Pas (stride) du vertex en octets, lu sur l'enregistrement de sous-maille (+0x3E).
        /// Réel : 68 octets pour les chr (position float3 à +0, normale/UV packées en SNORM16).
        /// Ne jamais coder en dur — toujours dérivé du .g4md.
        /// </summary>
        public int VertexStride;

        /// <summary>Numéro de layout vertex (+0x3C, octet bas) référençant la table d'attributs.</summary>
        public int LayoutNum;
    }

    /// <summary>
    /// Bone reference entry
    /// </summary>
    public readonly record struct BoneRef(
        int BoneIndex,
        float Weight
    );

    /// <summary>
    /// Axis-aligned bounding box (two corners), or a transform/bounds region
    /// read from the header float block at 0x34.
    /// </summary>
    public struct BoundingBox
    {
        public float MinX;
        public float MinY;
        public float MinZ;
        public float MaxX;
        public float MaxY;
        public float MaxZ;
    }

    /// <summary>
    /// Complete G4MD model information, suitable for JSON export.
    /// Aggregates header fields, geometry counts, submeshes, bone refs,
    /// bounding region floats and the embedded texture/material string refs.
    /// </summary>
    public struct G4mdInfo
    {
        public string Name { get; set; }
        public string MagicHex { get; set; }
        public bool IsBigEndian { get; set; }
        public int HeaderSize { get; set; }
        public int TypeId { get; set; }
        public int SectionBase { get; set; }

        public int VertexCount { get; set; }
        public int FaceCount { get; set; }
        public int BoneCount { get; set; }
        public int SubmeshCount { get; set; }

        public BoundingBox Bounds { get; set; }

        public int VertexDataOffset { get; set; }
        public int BoneRefOffset { get; set; }
        public int IndexOffset { get; set; }

        public List<Submesh> Submeshes { get; set; }
        public List<BoneRef> BoneRefs { get; set; }

        /// <summary>Embedded null-terminated texture/material reference strings.</summary>
        public List<string> TextureRefs { get; set; }

        /// <summary>Base-color texture name per material index (sans suffixe M).</summary>
        public List<string> MaterialBaseNames { get; set; }
        public int FileSize { get; set; }
    }

    /// <summary>
    /// Nom de la texture base-color pour un index de matériau donné, ou null si l'index est
    /// hors plage / non résolu. Sert au pont GLB pour mapper submesh → texture g4tx.
    /// </summary>
    public string? GetMaterialBaseName(int materialIndex)
    {
        if (materialIndex < 0 || materialIndex >= MaterialBaseNames.Count)
            return null;
        return MaterialBaseNames[materialIndex];
    }

    public G4mdHeader Header { get; private set; }
    public List<Submesh> Submeshes { get; private set; } = [];
    public List<BoneRef> BoneRefs { get; private set; } = [];
    public List<string> TextureRefs { get; private set; } = [];

    /// <summary>
    /// Noms de texture/material de BASE (sans suffixe M), un par index de matériau, dans
    /// l'ordre des matériaux du .g4md. Vérifié octet par octet sur fichiers réels chr/_uniform
    /// (u11130090 : 1 mat → [u11130090_10]) et chr/_face (c01000010 : 3 mats →
    /// [c01000010_20, mouth_10, eye_10]). Le nom de base correspond au basename de la texture
    /// base-color dans le .g4tx compagnon (texture homonyme). La variante <c>…M</c> est la
    /// normal/material map (non utilisée pour la base-color).
    /// </summary>
    public List<string> MaterialBaseNames { get; private set; } = [];
    public BoundingBox Bounds { get; private set; }
    public int FileSize { get; private set; }
    public bool IsBigEndian { get; private set; }

    /// <summary>
    /// Copie des octets bruts du .g4md, conservée pour relire la table d'attributs de
    /// vertex (8 octets/attribut) lors de l'extraction de la géométrie du .g4mg compagnon.
    /// </summary>
    public byte[] RawData { get; private set; } = [];

    public void Parse(string filePath)
    {
        var data = File.ReadAllBytes(filePath);
        Parse(data);
    }

    public void Parse(ReadOnlySpan<byte> data)
    {
        RawData = data.ToArray();
        // Detect endianness
        uint magic = BinaryPrimitives.ReadUInt32LittleEndian(data[..4]);
        IsBigEndian = magic == MAGIC_BE;

        Header = ParseHeader(data, IsBigEndian);
        Submeshes.Clear();
        BoneRefs.Clear();
        TextureRefs.Clear();
        MaterialBaseNames.Clear();
        FileSize = data.Length;

        // Parse submeshes using section offset table
        ParseSubmeshes(data);

        // Parse bone references if present
        if (Header.BoneCount > 0)
        {
            ParseBoneRefs(data);
        }

        // Bounding/transform float block at 0x34 (6 floats: min xyz, max xyz)
        Bounds = ParseBounds(data);

        // Embedded null-terminated texture/material reference strings
        TextureRefs.AddRange(ExtractTextureRefs(data));

        // Noms de base-color par matériau (région de chaînes en queue de fichier)
        MaterialBaseNames.AddRange(ExtractMaterialBaseNames(data, Header.MaterialCount));
    }

    /// <summary>
    /// Extrait les noms de base-color par matériau depuis le bloc de chaînes en queue de .g4md.
    ///
    /// Disposition vérifiée octet par octet (chr/_uniform u11130090, chr/_face c01000010,
    /// c02028110, c06031920) : la queue contient une table d'offsets puis exactement
    /// <c>2 * material_count</c> chaînes null-terminées contiguës — d'abord les
    /// <c>material_count</c> variantes <c>…M</c> (normal/material), puis les
    /// <c>material_count</c> noms de BASE (base-color), dans le MÊME ordre. Le i-ème nom de base
    /// est donc l'élément <c>material_count + i</c> du run terminal de chaînes matériau.
    ///
    /// On localise le run terminal en repartant de la fin : on collecte les chaînes ASCII
    /// null-terminées (≥3, alphanumériques + '_') jusqu'à briser la contiguïté, puis on garde
    /// les <c>2 * material_count</c> dernières et on renvoie la seconde moitié (les bases).
    /// </summary>
    private static List<string> ExtractMaterialBaseNames(ReadOnlySpan<byte> data, int materialCount)
    {
        var result = new List<string>();
        if (materialCount <= 0 || data.Length == 0)
            return result;

        // Collecte de toutes les chaînes terminales contiguës, dans l'ordre du fichier.
        // On part de la fin du fichier (en sautant un éventuel padding 0x00) et on remonte
        // tant que les octets précédents forment des chaînes ASCII matériau séparées par 0x00.
        int end = data.Length;
        while (end > 0 && data[end - 1] == 0x00)
            end--; // saute le padding final

        var tailStrings = new List<(int start, string value)>();
        int i = end;
        while (i > 0)
        {
            // borne de fin de la chaîne courante = i (exclu)
            int strEnd = i;
            int j = i - 1;
            while (j >= 0 && data[j] >= 0x20 && data[j] <= 0x7E)
                j--;
            // j pointe sur l'octet non-imprimable (séparateur) ou -1
            int strStart = j + 1;
            int len = strEnd - strStart;
            if (len < 1)
                break;

            // Le séparateur attendu est un 0x00 ; sinon la contiguïté du run est rompue.
            bool precededByNul = j < 0 || data[j] == 0x00;
            if (!precededByNul)
                break;

            var sb = new StringBuilder(len);
            for (int k = strStart; k < strEnd; k++)
                sb.Append((char)data[k]);

            if (!IsMaterialName(sb))
                break;

            tailStrings.Insert(0, (strStart, sb.ToString()));
            i = j; // poursuit avant le séparateur 0x00
        }

        // Doit contenir au moins 2 * material_count chaînes (M + base).
        int need = 2 * materialCount;
        if (tailStrings.Count < need)
            return result; // disposition inattendue : on ne fabrique rien

        // Garde les need dernières (le run matériau pur) ; la 2e moitié = noms de base.
        var run = tailStrings.GetRange(tailStrings.Count - need, need);
        for (int m = 0; m < materialCount; m++)
            result.Add(run[materialCount + m].value);

        return result;
    }

    /// <summary>
    /// Vrai si la chaîne ressemble à un nom de texture/material : alphanumérique + '_',
    /// commence par une lettre. (Tolère l'absence de chiffre, ex. "eye"/"mouth" sont suffixés.)
    /// </summary>
    private static bool IsMaterialName(StringBuilder sb)
    {
        if (sb.Length < 3 || !char.IsLetter(sb[0]))
            return false;
        for (int i = 0; i < sb.Length; i++)
        {
            char c = sb[i];
            if (!(char.IsLetterOrDigit(c) || c == '_'))
                return false;
        }
        return true;
    }

    /// <summary>
    /// Read the 6-float bounds block at header offset 0x34.
    /// Identified from real chr/_uniform models (min xyz / max xyz region).
    /// </summary>
    private BoundingBox ParseBounds(ReadOnlySpan<byte> data)
    {
        if (data.Length < 0x34 + 24)
            return default;

        static float ReadF(ReadOnlySpan<byte> d, bool bigEndian, int off) =>
            BitConverter.Int32BitsToSingle(
                bigEndian
                    ? BinaryPrimitives.ReadInt32BigEndian(d[off..])
                    : BinaryPrimitives.ReadInt32LittleEndian(d[off..]));

        return new BoundingBox
        {
            MinX = ReadF(data, IsBigEndian, 0x34),
            MinY = ReadF(data, IsBigEndian, 0x38),
            MinZ = ReadF(data, IsBigEndian, 0x3C),
            MaxX = ReadF(data, IsBigEndian, 0x40),
            MaxY = ReadF(data, IsBigEndian, 0x44),
            MaxZ = ReadF(data, IsBigEndian, 0x48),
        };
    }

    /// <summary>
    /// Extract embedded null-terminated ASCII texture/material reference strings.
    /// These appear in the string region near the file tail (e.g. "e000401_10",
    /// "e000401_10M"). Filtered to model-id-like tokens to drop binary noise.
    /// </summary>
    private static List<string> ExtractTextureRefs(ReadOnlySpan<byte> data)
    {
        var refs = new List<string>();
        var seen = new HashSet<string>();
        var sb = new StringBuilder();

        for (int i = 0; i < data.Length; i++)
        {
            byte b = data[i];
            if (b >= 0x20 && b <= 0x7E)
            {
                sb.Append((char)b);
            }
            else
            {
                if (b == 0x00 && sb.Length >= 4 && IsTextureRef(sb))
                {
                    string s = sb.ToString();
                    if (seen.Add(s))
                        refs.Add(s);
                }
                sb.Clear();
            }
        }

        return refs;
    }

    /// <summary>
    /// Heuristic for a real texture/material ref: starts with a letter,
    /// followed by digits/letters/underscore, contains at least one digit.
    /// Drops the "G4MD" magic and binary-garbage runs.
    /// </summary>
    private static bool IsTextureRef(StringBuilder sb)
    {
        if (!char.IsLetter(sb[0]))
            return false;
        bool hasDigit = false;
        for (int i = 0; i < sb.Length; i++)
        {
            char c = sb[i];
            if (!(char.IsLetterOrDigit(c) || c == '_'))
                return false;
            if (char.IsDigit(c))
                hasDigit = true;
        }
        return hasDigit && sb.ToString() != "G4MD";
    }

    /// <summary>
    /// Build the complete <see cref="G4mdInfo"/> after parsing.
    /// </summary>
    public G4mdInfo GetInfo(string? name = null)
    {
        // Sanitize floats: the bone-ref block currently overlaps the header
        // float region, so raw reinterpretation can yield NaN/Infinity which
        // are not valid JSON. Clamp non-finite values to 0 for safe export.
        var safeBones = new List<BoneRef>(BoneRefs.Count);
        foreach (var b in BoneRefs)
            safeBones.Add(new BoneRef(b.BoneIndex, Finite(b.Weight)));

        return new G4mdInfo
        {
            Name = name ?? string.Empty,
            MagicHex = $"0x{Header.Magic:X8}",
            IsBigEndian = IsBigEndian,
            HeaderSize = Header.HeaderSize,
            TypeId = Header.TypeId,
            SectionBase = Header.SectionBase,
            VertexCount = Header.VertexCount,
            FaceCount = Header.FaceCount,
            BoneCount = Header.BoneCount,
            SubmeshCount = Submeshes.Count,
            Bounds = SanitizeBounds(Bounds),
            VertexDataOffset = GetSectionOffset(Header.VertexDataOffset),
            BoneRefOffset = GetSectionOffset(Header.BoneRefOffset),
            IndexOffset = GetSectionOffset(Header.IndexOffset),
            Submeshes = Submeshes,
            BoneRefs = safeBones,
            TextureRefs = TextureRefs,
            MaterialBaseNames = MaterialBaseNames,
            FileSize = FileSize,
        };
    }

    /// <summary>Clamp a non-finite float (NaN/±Infinity) to 0 for valid JSON.</summary>
    private static float Finite(float v) => float.IsFinite(v) ? v : 0f;

    private static BoundingBox SanitizeBounds(BoundingBox b) => new()
    {
        MinX = Finite(b.MinX),
        MinY = Finite(b.MinY),
        MinZ = Finite(b.MinZ),
        MaxX = Finite(b.MaxX),
        MaxY = Finite(b.MaxY),
        MaxZ = Finite(b.MaxZ),
    };

    /// <summary>
    /// Calculate absolute offset for a section.
    /// Formula from FUN_14056d530: base_ptr + (SectionBase + offset) * 4
    /// </summary>
    public int GetSectionOffset(ushort relativeOffset)
    {
        return (Header.SectionBase + relativeOffset) * 4;
    }

    /// <summary>
    /// Table des sous-mailles : records de 0x50 octets à partir de l'offset <c>submesh_info</c>
    /// (header +0x04), <c>submesh_count</c> entrées (header +0x20). Disposition vérifiée octet
    /// par octet sur des fichiers réels chr/_uniform et chr/_face :
    /// +0x00 u32 vert_offset (OCTETS dans le .g4mg) ; +0x04 u32 face_offset (OCTETS, à ajouter à
    /// FaceDataBase) ; +0x08 u32 vert_count ; +0x0C u32 face_count (= index_count) ;
    /// +0x2E u8 stride ; +0x32 u8 layout_num ; +0x33 u8 mat_num.
    /// </summary>
    private void ParseSubmeshes(ReadOnlySpan<byte> data)
    {
        const int recordSize = 0x50;
        int tableOffset = Header.SubmeshInfo;
        int count = Header.SubmeshCount;

        if (tableOffset <= 0 || tableOffset >= data.Length || count <= 0)
            return;

        for (int i = 0; i < count; i++)
        {
            int offset = tableOffset + i * recordSize;
            if (offset + recordSize > data.Length)
                break;

            var rec = data.Slice(offset, recordSize);

            int faceCount = ReadInt32(rec, 0x0C);
            int vertCount = ReadInt32(rec, 0x08);
            byte stride = rec.Length > 0x2E ? rec[0x2E] : (byte)0;

            var mesh = new Submesh
            {
                Name = $"Mesh_{i}",
                VertexBufferOffset = ReadInt32(rec, 0x00),
                IndexBufferOffset = ReadInt32(rec, 0x04),
                VertexCount = vertCount,
                IndexCount = faceCount,
                // index_count u16 (ou u32 si vert_count > 65535) → taille du buffer d'index en octets
                IndexBufferSize = faceCount * (vertCount > 65535 ? 4 : 2),
                VertexStride = stride,
                LayoutNum = rec.Length > 0x32 ? rec[0x32] : 0,
                MaterialIndex = rec.Length > 0x33 ? rec[0x33] : 0,
                VertexFormat = 0,
            };

            Submeshes.Add(mesh);
        }
    }

    /// <summary>
    /// Injecte une table de sous-mailles déjà construite (et la base du bloc d'index) sans
    /// parser de fichier. Sert au pont de compatibilité <c>G4mgParser.ParseRawGeometry</c>
    /// qui accepte directement une <see cref="List{Submesh}"/>.
    /// </summary>
    public void SetSubmeshesForExtraction(List<Submesh> submeshes, int faceDataBase)
    {
        Submeshes = submeshes ?? [];
        var h = Header;
        h.FaceDataBase = (uint)faceDataBase;
        Header = h;
    }

    private void ParseBoneRefs(ReadOnlySpan<byte> data)
    {
        int boneOffset = GetSectionOffset(Header.BoneRefOffset);
        if (boneOffset <= 0 || boneOffset >= data.Length)
            return;

        // Bone entries are 8 bytes each (from FUN_14056d530 inner loop)
        int stride = 8;

        for (int i = 0; i < Header.BoneCount; i++)
        {
            int offset = boneOffset + (i * stride);
            if (offset + stride > data.Length)
                break;

            var entry = data.Slice(offset, stride);
            BoneRefs.Add(new BoneRef(
                BoneIndex: ReadInt32(entry, 0),
                Weight: BitConverter.Int32BitsToSingle(ReadInt32(entry, 4))
            ));
        }
    }

    private int ReadInt32(ReadOnlySpan<byte> data, int offset)
    {
        if (offset + 4 > data.Length) return 0;
        return IsBigEndian
            ? BinaryPrimitives.ReadInt32BigEndian(data[offset..])
            : BinaryPrimitives.ReadInt32LittleEndian(data[offset..]);
    }

    private uint ReadUInt32(ReadOnlySpan<byte> data, int offset)
    {
        if (offset + 4 > data.Length) return 0;
        return IsBigEndian
            ? BinaryPrimitives.ReadUInt32BigEndian(data[offset..])
            : BinaryPrimitives.ReadUInt32LittleEndian(data[offset..]);
    }

    private ushort ReadUInt16(ReadOnlySpan<byte> data, int offset)
    {
        if (offset + 2 > data.Length) return 0;
        return IsBigEndian
            ? BinaryPrimitives.ReadUInt16BigEndian(data[offset..])
            : BinaryPrimitives.ReadUInt16LittleEndian(data[offset..]);
    }

    private static G4mdHeader ParseHeader(ReadOnlySpan<byte> span, bool isBigEndian)
    {
        var header = new G4mdHeader();

        header.Magic = isBigEndian
            ? BinaryPrimitives.ReadUInt32BigEndian(span[..4])
            : BinaryPrimitives.ReadUInt32LittleEndian(span[..4]);

        if (header.Magic != MAGIC_LE && header.Magic != MAGIC_BE)
            throw new InvalidDataException($"Invalid G4MD magic: 0x{header.Magic:X8}");

        // Read with appropriate endianness
        header.SubmeshInfo = isBigEndian
            ? BinaryPrimitives.ReadUInt16BigEndian(span[4..])
            : BinaryPrimitives.ReadUInt16LittleEndian(span[4..]);
        header.Field06 = isBigEndian
            ? BinaryPrimitives.ReadUInt16BigEndian(span[6..])
            : BinaryPrimitives.ReadUInt16LittleEndian(span[6..]);
        header.Field08 = span[8];
        header.Field09 = span[9];
        header.SectionBase = isBigEndian
            ? BinaryPrimitives.ReadUInt16BigEndian(span[0x0A..])
            : BinaryPrimitives.ReadUInt16LittleEndian(span[0x0A..]);
        header.Field0C = isBigEndian
            ? BinaryPrimitives.ReadUInt32BigEndian(span[0x0C..])
            : BinaryPrimitives.ReadUInt32LittleEndian(span[0x0C..]);

        // Counts at 0x20+ (relabellisés d'après les octets réels :
        // 0x20 = submesh_count, 0x22 = material_count)
        header.SubmeshCount = isBigEndian
            ? BinaryPrimitives.ReadUInt16BigEndian(span[0x20..])
            : BinaryPrimitives.ReadUInt16LittleEndian(span[0x20..]);
        header.MaterialCount = isBigEndian
            ? BinaryPrimitives.ReadUInt16BigEndian(span[0x22..])
            : BinaryPrimitives.ReadUInt16LittleEndian(span[0x22..]);
        header.BoneCount = span[0x24];
        if (span.Length > 0x26)
            header.VLayoutCount = span[0x26];
        // Base du bloc d'index (face_data) dans le .g4mg compagnon
        if (span.Length >= 0x60)
            header.FaceDataBase = isBigEndian
                ? BinaryPrimitives.ReadUInt32BigEndian(span[0x5C..])
                : BinaryPrimitives.ReadUInt32LittleEndian(span[0x5C..]);

        // Section offsets (0x30-0x42)
        header.VertexDataOffset = isBigEndian
            ? BinaryPrimitives.ReadUInt16BigEndian(span[0x30..])
            : BinaryPrimitives.ReadUInt16LittleEndian(span[0x30..]);
        header.BoneRefOffset = isBigEndian
            ? BinaryPrimitives.ReadUInt16BigEndian(span[0x32..])
            : BinaryPrimitives.ReadUInt16LittleEndian(span[0x32..]);
        header.Section34Offset = isBigEndian
            ? BinaryPrimitives.ReadUInt16BigEndian(span[0x34..])
            : BinaryPrimitives.ReadUInt16LittleEndian(span[0x34..]);
        header.Section36Offset = isBigEndian
            ? BinaryPrimitives.ReadUInt16BigEndian(span[0x36..])
            : BinaryPrimitives.ReadUInt16LittleEndian(span[0x36..]);
        header.Section38Offset = isBigEndian
            ? BinaryPrimitives.ReadUInt16BigEndian(span[0x38..])
            : BinaryPrimitives.ReadUInt16LittleEndian(span[0x38..]);
        header.Section3AOffset = isBigEndian
            ? BinaryPrimitives.ReadUInt16BigEndian(span[0x3A..])
            : BinaryPrimitives.ReadUInt16LittleEndian(span[0x3A..]);
        header.IndexOffset = isBigEndian
            ? BinaryPrimitives.ReadUInt16BigEndian(span[0x3C..])
            : BinaryPrimitives.ReadUInt16LittleEndian(span[0x3C..]);
        header.Section3EOffset = isBigEndian
            ? BinaryPrimitives.ReadUInt16BigEndian(span[0x3E..])
            : BinaryPrimitives.ReadUInt16LittleEndian(span[0x3E..]);
        header.Section40Offset = isBigEndian
            ? BinaryPrimitives.ReadUInt16BigEndian(span[0x40..])
            : BinaryPrimitives.ReadUInt16LittleEndian(span[0x40..]);
        header.Section42Offset = isBigEndian
            ? BinaryPrimitives.ReadUInt16BigEndian(span[0x42..])
            : BinaryPrimitives.ReadUInt16LittleEndian(span[0x42..]);

        return header;
    }

    /// <summary>
    /// Get summary information about a G4MD file.
    /// </summary>
    public string GetSummary()
    {
        return $"""
            G4MD Model Data
            ---------------
            Endianness: {(IsBigEndian ? "Big-Endian" : "Little-Endian")}
            Vertices: {Header.VertexCount}
            Faces: {Header.FaceCount}
            Bones: {Header.BoneCount}
            Submeshes: {Submeshes.Count}
            Section Base: 0x{Header.SectionBase:X4}
            Data Sections:
              - Vertex Data: 0x{GetSectionOffset(Header.VertexDataOffset):X}
              - Bone Refs:   0x{GetSectionOffset(Header.BoneRefOffset):X}
              - Index Data:  0x{GetSectionOffset(Header.IndexOffset):X}
            """;
    }

    /// <summary>
    /// Check if data is a valid G4MD file.
    /// </summary>
    public static bool IsG4md(ReadOnlySpan<byte> data)
    {
        if (data.Length < 4) return false;
        uint magic = BinaryPrimitives.ReadUInt32LittleEndian(data);
        return magic == MAGIC_LE || magic == MAGIC_BE;
    }
}
