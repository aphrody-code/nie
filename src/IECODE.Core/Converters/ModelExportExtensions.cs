using System;
using System.Collections.Generic;
using System.IO;
using System.Numerics;
using IECODE.Core.Formats.Level5;
using SharpGLTF.Geometry;
using SharpGLTF.Geometry.VertexTypes;
using SharpGLTF.Materials;
using SharpGLTF.Schema2;

namespace IECODE.Core.Converters;

public static class ModelExportExtensions
{
    // -------------------------------------------------------------------------
    // Single mesh — file path
    // -------------------------------------------------------------------------

    public static void SaveAsGlb(this G4mgParser.MeshEntry mesh, string sourceFilePath, string outputPath)
    {
        using var fs = File.OpenRead(sourceFilePath);
        ExportMesh(mesh, fs, outputPath);
    }

    // -------------------------------------------------------------------------
    // All meshes — file path (opens file once, seeks per mesh)
    // -------------------------------------------------------------------------

    public static void SaveAllAsGlb(this List<G4mgParser.MeshEntry> meshes, string sourceFilePath, string outputPath)
    {
        using var fs = File.OpenRead(sourceFilePath);
        ExportAllMeshes(meshes, fs, outputPath);
    }

    // -------------------------------------------------------------------------
    // All meshes — in-memory (zero-copy MemoryStream wrap, no temp file)
    // -------------------------------------------------------------------------

    /// <summary>
    /// Export all meshes from an in-memory buffer.
    /// <see cref="MemoryStream(byte[], bool)"/> wraps the array without copying.
    /// </summary>
    public static void SaveAllAsGlb(this List<G4mgParser.MeshEntry> meshes, byte[] data, string outputPath)
    {
        using var ms = new MemoryStream(data, writable: false);
        ExportAllMeshes(meshes, ms, outputPath);
    }

    // -------------------------------------------------------------------------
    // Core — shared implementation
    // -------------------------------------------------------------------------

    private static void ExportMesh(G4mgParser.MeshEntry mesh, Stream stream, string outputPath)
    {
        var (builder, _) = BuildMesh(mesh, stream);
        var model = ModelRoot.CreateModel();
        model.CreateMeshes(builder);
        model.SaveGLB(outputPath);
    }

    private static void ExportAllMeshes(List<G4mgParser.MeshEntry> meshes, Stream stream, string outputPath)
    {
        var builders = new IMeshBuilder<MaterialBuilder>[meshes.Count];
        for (int i = 0; i < meshes.Count; i++)
            (builders[i], _) = BuildMesh(meshes[i], stream);

        var model = ModelRoot.CreateModel();
        model.CreateMeshes(builders);
        model.SaveGLB(outputPath);
    }

    /// <summary>
    /// Reads vertex/index buffers from <paramref name="stream"/> and builds a SharpGLTF mesh.
    /// Returns the builder and the number of triangles added.
    /// </summary>
    private static (MeshBuilder<VertexPositionNormal, VertexTexture1> builder, int triangles)
        BuildMesh(G4mgParser.MeshEntry mesh, Stream stream)
    {
        var vertexBytes = G4mgReader.ReadVertexBuffer(stream, mesh);
        var indexBytes = G4mgReader.ReadIndexBuffer(stream, mesh);
        int stride = mesh.VertexStride > 0 ? mesh.VertexStride : G4mgParser.GetVertexStride(mesh.Format);
        // Décode normale (vtype=2) et UV0 (vtype=10) via la table d'attributs réelle du .g4md.
        var vertices = G4mgReader.ParseVertices(vertexBytes, stride, mesh.Attributes);
        var indices = G4mgReader.ParseIndices(indexBytes);

        var material = new MaterialBuilder($"{mesh.Name}_Mat")
            .WithDoubleSide(true)
            .WithMetallicRoughnessShader();

        var builder = new MeshBuilder<VertexPositionNormal, VertexTexture1>(mesh.Name);
        var primitive = builder.UsePrimitive(material);

        int triangles = 0;
        for (int i = 0; i + 2 < indices.Length; i += 3)
        {
            int i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];
            if (i0 >= vertices.Length || i1 >= vertices.Length || i2 >= vertices.Length) continue;

            primitive.AddTriangle(
                (Geom(vertices[i0]), UV(vertices[i0])),
                (Geom(vertices[i1]), UV(vertices[i1])),
                (Geom(vertices[i2]), UV(vertices[i2])));
            triangles++;
        }

        return (builder, triangles);
    }

    private static VertexPositionNormal Geom(G4mgParser.Vertex v)
        => new(v.PositionX, v.PositionY, v.PositionZ, v.NormalX, v.NormalY, v.NormalZ);

    private static VertexTexture1 UV(G4mgParser.Vertex v)
        => new(new Vector2(v.U, v.V));
}
