using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Numerics;
using IECODE.Core.Formats.Level5;
using SharpGLTF.Geometry;
using SharpGLTF.Geometry.VertexTypes;
using SharpGLTF.Materials;
using SharpGLTF.Scenes;
using SharpGLTF.Schema2;

using VPosNorm = SharpGLTF.Geometry.VertexTypes.VertexPositionNormal;
using VTex = SharpGLTF.Geometry.VertexTypes.VertexTexture1;
using VJoints = SharpGLTF.Geometry.VertexTypes.VertexJoints4;

namespace IECODE.Core.Converters;

/// <summary>
/// Converts Level-5 G4MG models to GLTF/GLB format.
/// </summary>
public static class ModelConverter
{
    /// <summary>
    /// Converts a G4MG file to a GLB file.
    /// </summary>
    /// <param name="g4mgPath">Path to the .g4mg file</param>
    /// <param name="outputPath">Path to save the .glb file</param>
    public static void ConvertToGlb(string g4mgPath, string outputPath)
    {
        // Les .g4mg sont SANS en-tête : toute la métadonnée géométrique vit dans le .g4md
        // compagnon (même basename). On l'exige, sinon erreur explicite.
        string g4mdPath = Path.ChangeExtension(g4mgPath, ".g4md");
        if (!File.Exists(g4mdPath))
            throw new FileNotFoundException(
                $"G4MG sans en-tête : .g4md compagnon requis, introuvable à '{g4mdPath}'.", g4mdPath);

        var g4md = new G4mdParser();
        g4md.Parse(g4mdPath);

        var g4mgData = File.ReadAllBytes(g4mgPath);

        // 1. Parse géométrie brute pilotée par le .g4md
        var meshes = G4mgParser.ParseRawGeometry(g4mgData, g4md);

        // 2. Create Scene Builder
        var sceneBuilder = new SceneBuilder();

        // 3. Create Material (Default)
        var material = new MaterialBuilder("DefaultMaterial")
            .WithMetallicRoughnessShader()
            .WithBaseColor(new Vector4(1, 1, 1, 1));

        // 4. Process each mesh
        foreach (var meshEntry in meshes)
        {
            // Read buffers
            var vertexBytes = G4mgReader.ReadVertexBuffer(g4mgPath, meshEntry);
            var indexBytes = G4mgReader.ReadIndexBuffer(g4mgPath, meshEntry);

            // Parse data (stride réel dérivé du .g4md)
            int stride = meshEntry.VertexStride > 0 ? meshEntry.VertexStride : G4mgParser.GetVertexStride(meshEntry.Format);
            var vertices = G4mgReader.ParseVertices(vertexBytes, stride);
            var indices = G4mgReader.ParseIndices(indexBytes);

            // Create MeshBuilder
            // We use Position, Normal, and UV1 (Texture 0)
            var meshBuilder = new MeshBuilder<VPosNorm, VTex, VJoints>(meshEntry.Name);

            var primitive = meshBuilder.UsePrimitive(material);

            // Add vertices to primitive
            // We need to map indices to the new vertices we add
            // But SharpGLTF handles indexing automatically if we add triangles.

            // Convert vertices to SharpGLTF format
            var gltfVertices = new (VPosNorm, VTex, VJoints)[vertices.Length];

            for (int i = 0; i < vertices.Length; i++)
            {
                var v = vertices[i];

                // Coordinate system conversion:
                // Level-5 is likely Y-up or Z-up right-handed. GLTF is Y-up right-handed.
                // Often game engines use different axes.
                // Assuming standard mapping for now: X->X, Y->Y, Z->Z

                var pos = new Vector3(v.PositionX, v.PositionY, v.PositionZ);
                var norm = new Vector3(v.NormalX, v.NormalY, v.NormalZ);
                var uv = new Vector2(v.U, v.V);

                // Joints (placeholder for now)
                var joints = new VJoints(
                    (0, 1f),
                    (0, 0f),
                    (0, 0f),
                    (0, 0f));

                gltfVertices[i] = (new VPosNorm(pos, norm), new VTex(uv), joints);
            }

            // Add triangles
            for (int i = 0; i < indices.Length; i += 3)
            {
                var idx0 = indices[i];
                var idx1 = indices[i + 1];
                var idx2 = indices[i + 2];

                var v0 = gltfVertices[idx0];
                var v1 = gltfVertices[idx1];
                var v2 = gltfVertices[idx2];

                primitive.AddTriangle(v0, v1, v2);
            }

            // Add mesh to scene
            sceneBuilder.AddRigidMesh(meshBuilder, Matrix4x4.Identity);
        }

        // 5. Save to GLB
        var model = sceneBuilder.ToGltf2();
        model.SaveGLB(outputPath);
    }
}
