using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using IECODE.Core.Converters;
using IECODE.Core.Formats.Level5;
using SharpGLTF.Schema2;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests de l'embarquement des VRAIES textures (base-color g4tx) dans les GLB chr.
///
/// Couvre :
/// - le parsing des noms de matériau de base depuis la queue du .g4md (disposition réelle :
///   material_count variantes …M puis material_count noms de base) ;
/// - l'export GLB texturé : le matériau de la sous-maille porte une base-color (image WebP
///   embarquée) résolue par homonymie nom-de-matériau ↔ texture-du-g4tx, en respectant l'UV0.
/// </summary>
public class TexturedModelExportTests
{
    // -------------------------------------------------------------------------
    // MaterialBaseNames — disposition réelle de la queue du .g4md
    // -------------------------------------------------------------------------

    /// <summary>
    /// Construit un .g4md minimal valide (header + 1 sous-maille + table d'attributs) dont la
    /// queue contient le bloc de chaînes matériau : <c>materialCount</c> variantes …M puis
    /// <c>materialCount</c> noms de base, dans l'ordre. Reproduit la disposition vérifiée octet
    /// par octet sur chr/_uniform et chr/_face réels.
    /// </summary>
    private static byte[] BuildG4mdWithMaterials(string[] baseNames, int faceDataBase = 0x80)
    {
        int materialCount = baseNames.Length;
        var ms = new MemoryStream();
        var bw = new BinaryWriter(ms);

        // Header 0xA0 : magic + champs minimaux. submesh_info=0xA0, submesh_count=1.
        bw.Write(new byte[] { 0x47, 0x34, 0x4D, 0x44 }); // "G4MD"
        bw.Write((ushort)0xA0); // 0x04 submesh_info
        bw.Write((ushort)0x00); // 0x06
        bw.Write(new byte[0xA0 - 8]);

        // Patch des champs header utiles.
        var buf = ms.GetBuffer();
        buf[0x20] = 0x01; // submesh_count = 1
        buf[0x22] = (byte)materialCount; // material_count
        buf[0x5C] = (byte)(faceDataBase & 0xFF);
        buf[0x5D] = (byte)((faceDataBase >> 8) & 0xFF);

        // 1 record de sous-maille (0x50) : vert_count=0 → ignoré par ExtractGeometry, OK ici.
        bw.Write(new byte[0x50]);
        // Bloc bornes 8 octets + table d'attributs (1er attribut vtype=1 pos float).
        bw.Write(new byte[8]);
        WriteAttr(bw, vtype: 1, offset: 0, datatype: 3); // attr pos float3
        WriteAttr(bw, vtype: 0, offset: 0, datatype: 0); // fin

        // Table d'offsets factice (alignée sur le réel : 3 u16 + padding ×2 blocs).
        for (int i = 0; i < materialCount; i++) bw.Write((ushort)0);
        bw.Write((ushort)0);
        for (int i = 0; i < materialCount; i++) bw.Write((ushort)0);
        bw.Write((ushort)0);

        // Bloc de chaînes : d'abord les …M, puis les bases.
        foreach (var n in baseNames) WriteCStr(bw, n + "M");
        foreach (var n in baseNames) WriteCStr(bw, n);
        // padding final (toléré par le parseur)
        bw.Write((ushort)0);

        bw.Flush();
        return ms.ToArray();
    }

    private static void WriteCStr(BinaryWriter bw, string s)
    {
        bw.Write(System.Text.Encoding.ASCII.GetBytes(s));
        bw.Write((byte)0);
    }

    /// <summary>
    /// Écrit un attribut de layout vertex (8 octets) au format vérifié : vtype@0, offset u16@1,
    /// datatype u32@4 (l'octet @3 est un padding). Le lecteur (ReadVertexAttributes) lit le
    /// datatype à o+4 — il faut donc respecter ce décalage.
    /// </summary>
    private static void WriteAttr(BinaryWriter bw, byte vtype, ushort offset, uint datatype)
    {
        bw.Write(vtype);          // @0
        bw.Write(offset);         // @1 (u16)
        bw.Write((byte)0);        // @3 padding
        bw.Write(datatype);       // @4 (u32)
    }

    [Fact]
    public void MaterialBaseNames_SingleMaterial_Uniform()
    {
        var data = BuildG4mdWithMaterials(["u11130090_10"]);
        var g4md = new G4mdParser();
        g4md.Parse(data);

        Assert.Equal(1, g4md.Header.MaterialCount);
        Assert.Equal(new[] { "u11130090_10" }, g4md.MaterialBaseNames.ToArray());
        Assert.Equal("u11130090_10", g4md.GetMaterialBaseName(0));
        Assert.Null(g4md.GetMaterialBaseName(1));
    }

    [Fact]
    public void MaterialBaseNames_MultiMaterial_FacePreservesOrder()
    {
        // Cas chr/_face c01000010 : 3 matériaux, bases [c01000010_20, mouth_10, eye_10].
        var bases = new[] { "c01000010_20", "mouth_10", "eye_10" };
        var data = BuildG4mdWithMaterials(bases);
        var g4md = new G4mdParser();
        g4md.Parse(data);

        Assert.Equal(3, g4md.Header.MaterialCount);
        Assert.Equal(bases, g4md.MaterialBaseNames.ToArray());
        // La variante …M ne fuit pas dans les noms de base.
        Assert.DoesNotContain(g4md.MaterialBaseNames, n => n.EndsWith("M", StringComparison.Ordinal) && n.Length > 3 && char.IsLetter(n[^2]));
    }

    // -------------------------------------------------------------------------
    // Export GLB texturé — base-color embarquée + UV0 respectée
    // -------------------------------------------------------------------------

    /// <summary>NXTCH header = 48 octets (8 magic + 10 × u32). On le remplit de zéros : seul
    /// le décalage compte, les dimensions/format viennent de la <see cref="G4txTexture"/>.</summary>
    private const int NxtchHeaderSize = 48;

    /// <summary>
    /// Construit une <see cref="G4txTexture"/> RGBA8 non-DDS (format 0x18) 4×4 avec un dégradé,
    /// pour que <c>ToImage()</c> la décode sans dépendre d'un codec BCn.
    /// </summary>
    private static G4txTexture BuildRgbaTexture(string name, int w = 4, int h = 4)
    {
        var payload = new byte[NxtchHeaderSize + w * h * 4];
        for (int i = 0; i < w * h; i++)
        {
            int o = NxtchHeaderSize + i * 4;
            payload[o + 0] = (byte)(i * 16 % 256); // R varie → texture non uniforme
            payload[o + 1] = (byte)(255 - i * 8 % 256);
            payload[o + 2] = 128;
            payload[o + 3] = 255;
        }
        return new G4txTexture(
            Id: 0, Name: name, Width: w, Height: h, Format: 0x18, MipMapCount: 1,
            TextureData: payload, IsDds: false, SubTextures: Array.Empty<G4txSubTexture>());
    }

    /// <summary>
    /// .g4mg + .g4md d'un quad (4 vertices stride 32 : pos float3 @0, UV ushort @24) avec
    /// indices [0,1,2,0,2,3]. UV0 présent → le writer doit émettre TEXCOORD_0 et, avec une
    /// base-color homonyme, un matériau texturé.
    /// </summary>
    private static (byte[] g4mg, G4mdParser g4md) BuildTexturedQuad(string materialName)
    {
        const int stride = 32;
        const int vcount = 4;
        const int faceBase = stride * vcount; // 0x80
        var g4mg = new byte[faceBase + 6 * 2];

        // 4 vertices : positions distinctes, UV (ushort UNORM) @24.
        (float x, float y, ushort u, ushort v)[] verts =
        [
            (0, 0, 0, 0),
            (1, 0, 65535, 0),
            (1, 1, 65535, 65535),
            (0, 1, 0, 65535),
        ];
        for (int i = 0; i < vcount; i++)
        {
            int p = i * stride;
            BitConverter.GetBytes(verts[i].x).CopyTo(g4mg, p);
            BitConverter.GetBytes(verts[i].y).CopyTo(g4mg, p + 4);
            BitConverter.GetBytes(0f).CopyTo(g4mg, p + 8);
            BitConverter.GetBytes(verts[i].u).CopyTo(g4mg, p + 24);
            BitConverter.GetBytes(verts[i].v).CopyTo(g4mg, p + 26);
        }
        ushort[] idx = [0, 1, 2, 0, 2, 3];
        for (int i = 0; i < idx.Length; i++)
            BitConverter.GetBytes(idx[i]).CopyTo(g4mg, faceBase + i * 2);

        // .g4md : 1 sous-maille vert_count=4 stride=32 + attributs pos@0 / uv@24 + 1 matériau.
        var ms = new MemoryStream();
        var bw = new BinaryWriter(ms);
        bw.Write(new byte[] { 0x47, 0x34, 0x4D, 0x44 });
        bw.Write((ushort)0xA0); bw.Write((ushort)0);
        bw.Write(new byte[0xA0 - 8]);
        var buf = ms.GetBuffer();
        buf[0x20] = 0x01; buf[0x22] = 0x01;
        buf[0x5C] = (byte)(faceBase & 0xFF); buf[0x5D] = (byte)((faceBase >> 8) & 0xFF);

        // record sous-maille 0x50 : vert_off@0=0, face_off@4=0, vert_count@8=4, face_count@0xC=6,
        // stride@0x2E=32.
        var rec = new byte[0x50];
        BitConverter.GetBytes(4).CopyTo(rec, 0x08);
        BitConverter.GetBytes(6).CopyTo(rec, 0x0C);
        rec[0x2E] = stride;
        bw.Write(rec);
        bw.Write(new byte[8]); // bornes
        // attributs (8 octets/attr) : vtype@0, offset u16@1, datatype u32@4 (octet @3 = padding).
        WriteAttr(bw, vtype: 1, offset: 0, datatype: 3);    // pos float3
        WriteAttr(bw, vtype: 10, offset: 24, datatype: 14); // uv ushort UNORM16
        WriteAttr(bw, vtype: 0, offset: 0, datatype: 0);    // fin
        // offsets factices + chaînes : 1 …M puis 1 base.
        bw.Write((ushort)0); bw.Write((ushort)0);
        WriteCStr(bw, materialName + "M");
        WriteCStr(bw, materialName);
        bw.Write((ushort)0);
        bw.Flush();

        var g4md = new G4mdParser();
        g4md.Parse(ms.ToArray());
        return (g4mg, g4md);
    }

    [Fact]
    public void BuildTexturedGlb_EmbedsBaseColorImage_AndKeepsUv()
    {
        const string mat = "u11130090_10";
        var (g4mg, g4md) = BuildTexturedQuad(mat);

        // Sanity : le matériau de base est bien parsé.
        Assert.Equal(mat, g4md.GetMaterialBaseName(0));

        var textures = new List<G4txTexture> { BuildRgbaTexture(mat) };

        byte[]? glb = TexturedModelExport.BuildTexturedGlb(
            g4mg, g4md,
            g4txProvider: () => textures,
            out int totalTris, out int texturedSubmeshes,
            maxTextureSize: 1024);

        Assert.NotNull(glb);
        Assert.Equal(2, totalTris);              // quad = 2 triangles
        Assert.Equal(1, texturedSubmeshes);       // 1 sous-maille texturée

        // Relit le GLB via SharpGLTF et vérifie la présence d'une base-color + UV0.
        var model = ModelRoot.ParseGLB(glb);
        Assert.NotEmpty(model.LogicalImages);     // au moins l'image base-color embarquée
        Assert.NotEmpty(model.LogicalTextures);

        var mater = model.LogicalMaterials.First(m => m.Name == mat);
        var baseChannel = mater.FindChannel("BaseColor");
        Assert.NotNull(baseChannel);
        Assert.NotNull(baseChannel!.Value.Texture);

        // La primitive porte bien TEXCOORD_0.
        var prim = model.LogicalMeshes.SelectMany(me => me.Primitives).First();
        Assert.NotNull(prim.GetVertexAccessor("TEXCOORD_0"));
    }

    [Fact]
    public void BuildTexturedGlb_MissingTexture_FallsBackToGrey_NoFabrication()
    {
        const string mat = "u11130090_10";
        var (g4mg, g4md) = BuildTexturedQuad(mat);

        // Le g4tx ne contient PAS la texture homonyme → pas de base-color, pas de fabrication.
        var textures = new List<G4txTexture> { BuildRgbaTexture("autre_nom") };

        byte[]? glb = TexturedModelExport.BuildTexturedGlb(
            g4mg, g4md,
            g4txProvider: () => textures,
            out int totalTris, out int texturedSubmeshes);

        Assert.NotNull(glb);
        Assert.Equal(2, totalTris);
        Assert.Equal(0, texturedSubmeshes);

        var model = ModelRoot.ParseGLB(glb);
        // Aucune base-color résolue → le matériau gris n'a pas d'image.
        var mater = model.LogicalMaterials.First();
        var baseChannel = mater.FindChannel("BaseColor");
        if (baseChannel is { } ch)
            Assert.Null(ch.Texture);
    }
}
