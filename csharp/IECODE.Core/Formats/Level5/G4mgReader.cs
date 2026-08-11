using System;
using System.Buffers.Binary;
using System.IO;
using System.Runtime.InteropServices;
using IECODE.Core.Logging;

namespace IECODE.Core.Formats.Level5;

/// <summary>
/// Reader for G4MG vertex and index buffers.
/// All overloads share a single Stream-based implementation to avoid re-opening files.
/// </summary>
public static class G4mgReader
{
    // -------------------------------------------------------------------------
    // Vertex buffer
    // -------------------------------------------------------------------------

    public static byte[] ReadVertexBuffer(string filePath, G4mgParser.MeshEntry mesh)
    {
        using var fs = File.OpenRead(filePath);
        return ReadVertexBuffer(fs, mesh);
    }

    public static byte[] ReadVertexBuffer(Stream stream, G4mgParser.MeshEntry mesh)
    {
        // Stride réel dérivé du .g4md (jamais codé en dur) ; repli sur la table de format hérité.
        int stride = mesh.VertexStride > 0 ? mesh.VertexStride : G4mgParser.GetVertexStride(mesh.Format);
        int bufferSize = mesh.VertexCount * stride;

        if (mesh.VertexBufferOffset + bufferSize > stream.Length)
            LogService.Instance.Warn("G4mgReader",
                $"Vertex buffer out of bounds for '{mesh.Name}': end=0x{mesh.VertexBufferOffset + bufferSize:X} > length=0x{stream.Length:X}");

        var buffer = new byte[Math.Min(bufferSize, (int)(stream.Length - mesh.VertexBufferOffset))];
        stream.Seek(mesh.VertexBufferOffset, SeekOrigin.Begin);
        _ = stream.Read(buffer, 0, buffer.Length);
        return buffer;
    }

    // -------------------------------------------------------------------------
    // Index buffer
    // -------------------------------------------------------------------------

    public static byte[] ReadIndexBuffer(string filePath, G4mgParser.MeshEntry mesh)
    {
        using var fs = File.OpenRead(filePath);
        return ReadIndexBuffer(fs, mesh);
    }

    public static byte[] ReadIndexBuffer(Stream stream, G4mgParser.MeshEntry mesh)
    {
        int bufferSize = mesh.IndexCount * sizeof(ushort);

        if (mesh.IndexBufferOffset + bufferSize > stream.Length)
            LogService.Instance.Warn("G4mgReader",
                $"Index buffer out of bounds for '{mesh.Name}': end=0x{mesh.IndexBufferOffset + bufferSize:X} > length=0x{stream.Length:X}");

        var buffer = new byte[Math.Min(bufferSize, (int)(stream.Length - mesh.IndexBufferOffset))];
        stream.Seek(mesh.IndexBufferOffset, SeekOrigin.Begin);
        _ = stream.Read(buffer, 0, buffer.Length);
        return buffer;
    }

    // -------------------------------------------------------------------------
    // Parsing
    // -------------------------------------------------------------------------

    public static G4mgParser.Vertex[] ParseVertices(ReadOnlySpan<byte> vertexData, G4mgParser.VertexFormat format)
        => ParseVertices(vertexData, G4mgParser.GetVertexStride(format));

    /// <summary>
    /// Décode les vertices à partir d'un stride explicite, sans table d'attributs : seule la
    /// position (float3 à +0) est décodée. Normale (0,0,1) et UV (0,0) par défaut faute de
    /// layout pour localiser/décoder le tail packé. Préférer la surcharge avec attributs.
    /// </summary>
    public static G4mgParser.Vertex[] ParseVertices(ReadOnlySpan<byte> vertexData, int stride)
        => ParseVertices(vertexData, stride, []);

    /// <summary>
    /// Décode les vertices avec la table d'attributs réelle du .g4md : position (float3 à +0),
    /// normale (vtype=2, SNORM16/float décodé et normalisé) et UV0 (vtype=10, ushort UNORM /
    /// float décodé) à leur offset/datatype réels. Si un attribut manque, on retombe sur la
    /// valeur par défaut (normale (0,0,1), UV (0,0)) sans rien fabriquer.
    /// </summary>
    public static G4mgParser.Vertex[] ParseVertices(ReadOnlySpan<byte> vertexData, int stride,
        IReadOnlyList<G4mgParser.VertexAttribute> attributes)
    {
        int count = stride >= 12 ? vertexData.Length / stride : 0;
        var result = new G4mgParser.Vertex[count];

        var normalAttr = G4mgParser.FindAttribute(attributes, vtype: 2);
        var uvAttr = G4mgParser.FindAttribute(attributes, vtype: 10);
        bool decodeNormal = normalAttr is { } na && G4mgParser.Vec3ByteSize(na.DataType) > 0
            && na.Offset + G4mgParser.Vec3ByteSize(na.DataType) <= stride;
        bool decodeUv = uvAttr is { } ua && G4mgParser.Vec2ByteSize(ua.DataType) > 0
            && ua.Offset + G4mgParser.Vec2ByteSize(ua.DataType) <= stride;

        for (int i = 0; i < count; i++)
        {
            var s = vertexData.Slice(i * stride, stride);

            float px = Sanitize(BinaryPrimitives.ReadSingleLittleEndian(s));
            float py = Sanitize(BinaryPrimitives.ReadSingleLittleEndian(s[4..]));
            float pz = Sanitize(BinaryPrimitives.ReadSingleLittleEndian(s[8..]));

            float nx = 0f, ny = 0f, nz = 1f, u = 0f, v = 0f;
            if (decodeNormal)
            {
                var n = G4mgParser.DecodeNormal(s, normalAttr!.Value.Offset, normalAttr.Value.DataType);
                nx = n.X; ny = n.Y; nz = n.Z;
            }
            if (decodeUv)
            {
                var uv = G4mgParser.DecodeUv(s, uvAttr!.Value.Offset, uvAttr.Value.DataType);
                u = uv.X; v = uv.Y;
            }

            result[i] = new G4mgParser.Vertex(px, py, pz, nx, ny, nz, u, v);
        }

        return result;
    }

    public static ushort[] ParseIndices(ReadOnlySpan<byte> indexData)
        => MemoryMarshal.Cast<byte, ushort>(indexData).ToArray();

    private static float Sanitize(float f) => float.IsFinite(f) ? f : 0f;
}
