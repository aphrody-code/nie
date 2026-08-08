using System.Linq;
using IECODE.Core.Formats.Level5;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests de l'extraction de géométrie G4MG (sans en-tête) pilotée par le .g4md compagnon.
///
/// Les .g4mg réels n'ont AUCUN magic ni header : l'offset 0 est de la donnée vertex et toute
/// la métadonnée géométrique vit dans le .g4md. Ces tests valident l'extraction sur des octets
/// réels embarqués (le bloc d'index de l'échantillon menu mainmenu90_02_2.g4mg, dont les
/// indices confirmés sont [0,1,2,0,2,3]).
/// </summary>
public class G4mgGeometryTests
{
    /// <summary>
    /// 192 octets réels de data/common/menu/.../mainmenu90_02_2.g4mg (sans en-tête).
    /// Offset 0 = float 1.0f (0x3F800000) ; indices u16 [0,1,2,0,2,3] à l'offset 0x80.
    /// </summary>
    private static readonly byte[] MenuG4mg =
    [
        0,0,128,63,0,0,0,0,0,0,0,0,0,0,0,0,
        255,127,255,127,255,255,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,255,127,255,127,0,0,0,0,
        0,0,0,0,0,0,128,191,0,0,0,0,0,0,0,0,
        255,127,255,127,0,0,255,255,0,0,128,63,0,0,128,191,
        0,0,0,0,0,0,0,0,255,127,255,127,255,255,255,255,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,1,0,2,0,0,0,2,0,3,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    ];

    /// <summary>
    /// G4MD synthétique minimal décrivant l'échantillon menu (le fichier menu réel n'a pas de
    /// .g4md sur disque) : 1 sous-maille, vert_count=4, face_count=6, stride=32, vert_offset=0,
    /// face_offset=0, face_data_base=0x80. Construit selon la disposition vérifiée sur les
    /// vrais chr/_uniform et chr/_face.
    /// </summary>
    private static readonly byte[] MenuG4md =
    [
        71,52,77,68,160,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        1,0,1,0,0,0,1,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,128,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,4,0,0,0,6,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,32,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    ];

    [Fact]
    public void ExtractGeometry_MenuSample_IndicesAreQuadTriList()
    {
        var g4md = new G4mdParser();
        g4md.Parse(MenuG4md);

        Assert.Equal(1, g4md.Header.SubmeshCount);
        Assert.Equal((uint)0x80, g4md.Header.FaceDataBase);
        Assert.Single(g4md.Submeshes);
        Assert.Equal(4, g4md.Submeshes[0].VertexCount);
        Assert.Equal(6, g4md.Submeshes[0].IndexCount);
        Assert.Equal(32, g4md.Submeshes[0].VertexStride);

        var geometry = G4mgParser.ExtractGeometry(MenuG4mg, g4md);

        Assert.Single(geometry);
        var sm = geometry[0];

        // Indices confirmés du quad menu (2 triangles).
        Assert.Equal(new uint[] { 0, 1, 2, 0, 2, 3 }, sm.Indices.ToArray());

        // 4 positions décodées (float3 à +0 de chaque vertex de 32 octets).
        Assert.Equal(4, sm.Positions.Count);
        Assert.False(sm.Index32);

        // Le vertex 0 commence par 0x3F800000 = 1.0f sur l'axe X.
        Assert.Equal(1.0f, sm.Positions[0].X, precision: 5);
    }

    [Fact]
    public void ExtractGeometry_NoCompanionParser_Throws()
    {
        // Confirme l'absence de chemin « magic G4MG » fictif : on ne décode jamais sans .g4md.
        Assert.Throws<System.NotSupportedException>(
            () => G4mgParser.ParseMeshes(MenuG4mg));
    }

    /// <summary>
    /// Décodage normale (vtype=2, short SNORM16 ×3) + UV0 (vtype=10, ushort UNORM ×2) à leur
    /// offset réel, sur le layout vérifié de chr/_uniform u11130090 (stride 68, normale @12,
    /// uv @64). Vecteur unique construit avec des valeurs SNORM/UNORM connues → normale
    /// normalisée attendue et UV ~[0,1].
    /// </summary>
    [Fact]
    public void ParseVertices_DecodesSnorm16NormalAndUnormUv()
    {
        const int stride = 68;
        var vtx = new byte[stride];

        // Position float3 à +0 : (0.5, -0.25, 2.0)
        System.BitConverter.GetBytes(0.5f).CopyTo(vtx, 0);
        System.BitConverter.GetBytes(-0.25f).CopyTo(vtx, 4);
        System.BitConverter.GetBytes(2.0f).CopyTo(vtx, 8);

        // Normale short SNORM16 @12 : (32767, 0, 0) -> (1,0,0)
        System.BitConverter.GetBytes((short)32767).CopyTo(vtx, 12);
        System.BitConverter.GetBytes((short)0).CopyTo(vtx, 14);
        System.BitConverter.GetBytes((short)0).CopyTo(vtx, 16);

        // UV0 ushort UNORM16 @64 : (16383, 49151) -> (~0.25, ~0.75)
        System.BitConverter.GetBytes((ushort)16383).CopyTo(vtx, 64);
        System.BitConverter.GetBytes((ushort)49151).CopyTo(vtx, 66);

        var attrs = new[]
        {
            new G4mgParser.VertexAttribute(1, 0, 3),    // position float3
            new G4mgParser.VertexAttribute(2, 12, 20),  // normale short SNORM16 ×3
            new G4mgParser.VertexAttribute(10, 64, 14), // uv0 ushort UNORM16 ×2
        };

        var verts = G4mgReader.ParseVertices(vtx, stride, attrs);
        Assert.Single(verts);
        var v = verts[0];

        Assert.Equal(0.5f, v.PositionX, precision: 5);
        Assert.Equal(-0.25f, v.PositionY, precision: 5);
        Assert.Equal(2.0f, v.PositionZ, precision: 5);

        // Normale normalisée (1,0,0)
        Assert.Equal(1.0f, v.NormalX, precision: 4);
        Assert.Equal(0.0f, v.NormalY, precision: 4);
        Assert.Equal(0.0f, v.NormalZ, precision: 4);
        float len = System.MathF.Sqrt(v.NormalX * v.NormalX + v.NormalY * v.NormalY + v.NormalZ * v.NormalZ);
        Assert.Equal(1.0f, len, precision: 4);

        // UV0 dans [0,1]
        Assert.Equal(16383f / 65535f, v.U, precision: 4);
        Assert.Equal(49151f / 65535f, v.V, precision: 4);
        Assert.InRange(v.U, 0f, 1f);
        Assert.InRange(v.V, 0f, 1f);
    }

    /// <summary>
    /// Sans table d'attributs, le décodage retombe sur la position seule (normale (0,0,1),
    /// UV (0,0)) — aucune valeur fabriquée. Garantit la rétrocompatibilité.
    /// </summary>
    [Fact]
    public void ParseVertices_NoAttributes_PositionOnlyDefaults()
    {
        const int stride = 68;
        var vtx = new byte[stride];
        System.BitConverter.GetBytes(1.0f).CopyTo(vtx, 0);

        var verts = G4mgReader.ParseVertices(vtx, stride);
        Assert.Single(verts);
        Assert.Equal(1.0f, verts[0].PositionX, precision: 5);
        Assert.Equal(0f, verts[0].NormalX);
        Assert.Equal(0f, verts[0].NormalY);
        Assert.Equal(1f, verts[0].NormalZ);
        Assert.Equal(0f, verts[0].U);
        Assert.Equal(0f, verts[0].V);
    }
}
