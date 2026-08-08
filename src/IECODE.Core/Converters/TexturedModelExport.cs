using System;
using System.Collections.Generic;
using System.IO;
using System.Numerics;
using IECODE.Core.Formats.Level5;
using SharpGLTF.Geometry;
using SharpGLTF.Geometry.VertexTypes;
using SharpGLTF.Materials;
using SharpGLTF.Memory;
using SharpGLTF.Scenes;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace IECODE.Core.Converters;

/// <summary>
/// Export GLB des modèles chr (G4MG + G4MD) AVEC base-color réelle.
///
/// Réalité vérifiée (chr/_uniform u11130090, chr/_face c01000010) :
/// - le .g4md porte, en queue, les noms de matériau de base (base-color), un par matériau,
///   exposés par <see cref="G4mdParser.MaterialBaseNames"/> ;
/// - la base-color vit dans le .g4tx compagnon (même basename que le modèle), sous une texture
///   HOMONYME du nom de base (ex. matériau "u11130090_10" → texture "u11130090_10" du g4tx) ;
/// - les variantes "…M" (normal/material), "…line", "…oc", "…sp" du g4tx ne sont PAS la base-color.
///
/// Le g4tx réel (2048²) est décodé puis DOWNSCALÉ (côté max paramétrable, défaut 1024) et encodé
/// en WebP (qualité ~85) pour garder un GLB raisonnable. Sans cette réduction un g4tx 5.9 Mo ×
/// 6000 modèles produirait des GLB inexploitables.
///
/// LIMITES HONNÊTES :
/// - Mapping submesh→matériau : le champ d'index matériau du record de sous-maille n'est pas
///   résolu de façon univoque sur tous les persos ; comme material_count == submesh_count pour
///   les chr, on mappe par ORDINAL (sous-maille i → matériau i). Cela donne à chaque sous-maille
///   sa propre texture distincte. C'est exact pour les persos mono-texture et l'ordre observé.
/// - Si la texture homonyme est absente du g4tx (ex. parts "eye_10"/"mouth_10" portées par un
///   AUTRE g4tx de face-part), la sous-maille retombe sur un matériau gris (pas de fabrication).
/// </summary>
public static class TexturedModelExport
{
    /// <summary>Côté max par défaut de la texture embarquée (px). 2048 → 1024 = ÷4 en aire.</summary>
    public const int DefaultMaxTextureSize = 1024;

    /// <summary>Qualité WebP par défaut pour la base-color embarquée.</summary>
    public const int DefaultWebpQuality = 85;

    /// <summary>
    /// Fournit les textures d'un g4tx (déjà décodées en G4txTexture) pour un nom de base donné.
    /// Renvoie null si le g4tx du modèle est introuvable. Permet d'alimenter l'export depuis le
    /// disque comme depuis les CPK (le résolveur de chemin/extraction reste à l'appelant).
    /// </summary>
    public delegate IReadOnlyList<G4txTexture>? G4txProvider();

    /// <summary>
    /// Construit un GLB texturé depuis le .g4mg + son .g4md + le g4tx compagnon.
    /// </summary>
    /// <param name="g4mgData">Octets bruts du .g4mg.</param>
    /// <param name="g4md">.g4md déjà parsé (submeshes + MaterialBaseNames requis).</param>
    /// <param name="g4txProvider">Accès paresseux aux textures du g4tx compagnon.</param>
    /// <param name="totalTris">Nombre total de triangles émis.</param>
    /// <param name="texturedSubmeshes">Nombre de sous-mailles ayant reçu une base-color réelle.</param>
    /// <param name="maxTextureSize">Côté max de la texture embarquée (px).</param>
    /// <param name="webpQuality">Qualité WebP de la base-color embarquée.</param>
    /// <param name="log">Journal optionnel.</param>
    /// <returns>Octets GLB, ou null si aucune géométrie.</returns>
    public static byte[]? BuildTexturedGlb(
        ReadOnlySpan<byte> g4mgData,
        G4mdParser g4md,
        G4txProvider g4txProvider,
        out int totalTris,
        out int texturedSubmeshes,
        int maxTextureSize = DefaultMaxTextureSize,
        int webpQuality = DefaultWebpQuality,
        Action<string>? log = null)
    {
        totalTris = 0;
        texturedSubmeshes = 0;

        var geometry = G4mgParser.ExtractGeometry(g4mgData, g4md);
        if (geometry.Count == 0)
            return null;

        // Décode les textures du g4tx une seule fois ; encode chaque base-color en WebP à la
        // demande (mémoïsé par nom). Lazy : si aucune sous-maille n'a d'UV, on ne décode rien.
        IReadOnlyList<G4txTexture>? textures = null;
        bool texturesQueried = false;
        var materialByName = new Dictionary<string, MaterialBuilder>(StringComparer.OrdinalIgnoreCase);
        var grey = new MaterialBuilder("Default").WithDoubleSide(true).WithMetallicRoughnessShader();

        IReadOnlyList<G4txTexture>? GetTextures()
        {
            if (!texturesQueried)
            {
                textures = g4txProvider();
                texturesQueried = true;
            }
            return textures;
        }

        var scene = new SceneBuilder();

        for (int i = 0; i < geometry.Count; i++)
        {
            var g = geometry[i];
            bool hasNormals = g.Normals.Count == g.Positions.Count && g.Positions.Count > 0;
            bool hasUv = g.UV0.Count == g.Positions.Count && g.Positions.Count > 0;

            // Sous-maille i → matériau i (ordinal). Voir LIMITES HONNÊTES.
            string? baseName = g4md.GetMaterialBaseName(i);

            MaterialBuilder material = grey;
            bool textured = false;

            if (hasUv && !string.IsNullOrEmpty(baseName))
            {
                if (materialByName.TryGetValue(baseName, out var cached))
                {
                    material = cached;
                    textured = true;
                }
                else
                {
                    var tex = FindBaseColorTexture(GetTextures(), baseName);
                    if (tex is { } t)
                    {
                        byte[]? webp = TryEncodeBaseColorWebp(t, maxTextureSize, webpQuality, out int w, out int h, log);
                        if (webp is not null)
                        {
                            var mb = new MaterialBuilder(baseName)
                                .WithDoubleSide(true)
                                .WithMetallicRoughnessShader()
                                .WithChannelImage(KnownChannel.BaseColor, new MemoryImage(webp));
                            materialByName[baseName] = mb;
                            material = mb;
                            textured = true;
                            log?.Invoke($"{g.Name}: base-color « {baseName} » {t.Width}×{t.Height} → {w}×{h} webp {webp.Length:N0} o");
                        }
                    }
                    else
                    {
                        log?.Invoke($"{g.Name}: base-color « {baseName} » absente du g4tx (sous-maille grise)");
                    }
                }
            }

            int added = AddSubmesh(scene, material, g, hasNormals, hasUv);
            totalTris += added;
            if (textured && added > 0)
                texturedSubmeshes++;
        }

        var model = scene.ToGltf2();
        using var ms = new MemoryStream();
        model.WriteGLB(ms);
        return ms.ToArray();
    }

    /// <summary>
    /// Cherche, dans les textures du g4tx, la base-color HOMONYME du nom de matériau. On exclut
    /// explicitement les variantes connues (suffixes M/line/oc/sp/spm) : seule la texture au nom
    /// EXACT est la base-color.
    /// </summary>
    private static G4txTexture? FindBaseColorTexture(IReadOnlyList<G4txTexture>? textures, string baseName)
    {
        if (textures is null)
            return null;
        foreach (var t in textures)
            if (string.Equals(t.Name, baseName, StringComparison.OrdinalIgnoreCase))
                return t;
        return null;
    }

    /// <summary>
    /// Décode la texture g4tx (DDS/NXTCH) en RGBA, la downscale au côté max voulu (préserve le
    /// ratio, ne jamais agrandir) et l'encode en WebP. Renvoie null si le décodage échoue
    /// (format non géré) — la sous-maille retombe alors sur le matériau gris.
    /// </summary>
    private static byte[]? TryEncodeBaseColorWebp(
        G4txTexture texture, int maxSize, int quality, out int outW, out int outH, Action<string>? log)
    {
        outW = 0; outH = 0;
        try
        {
            using Image<Rgba32> img = texture.ToImage();

            int max = Math.Max(img.Width, img.Height);
            if (maxSize > 0 && max > maxSize)
            {
                double scale = (double)maxSize / max;
                int nw = Math.Max(1, (int)Math.Round(img.Width * scale));
                int nh = Math.Max(1, (int)Math.Round(img.Height * scale));
                img.Mutate(c => c.Resize(nw, nh, KnownResamplers.Lanczos3));
            }

            outW = img.Width;
            outH = img.Height;

            using var ms = new MemoryStream();
            img.Save(ms, new WebpEncoder { FileFormat = WebpFileFormatType.Lossy, Quality = quality });
            return ms.ToArray();
        }
        catch (Exception ex)
        {
            log?.Invoke($"  base-color « {texture.Name} » non décodée : {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Ajoute une sous-maille à la scène avec le matériau fourni, en respectant l'UV0 déjà émise.
    /// Copie alignée sur G4mgCommand.AddSubmesh (mêmes types de vertex selon attributs présents).
    /// </summary>
    private static int AddSubmesh(SceneBuilder scene, MaterialBuilder material,
        G4mgParser.SubmeshGeometry g, bool hasNormals, bool hasUv)
    {
        if (hasNormals && hasUv)
        {
            var mb = new MeshBuilder<VertexPositionNormal, VertexTexture1>(g.Name);
            var prim = mb.UsePrimitive(material);
            var verts = new (VertexPositionNormal, VertexTexture1)[g.Positions.Count];
            for (int i = 0; i < g.Positions.Count; i++)
            {
                var p = g.Positions[i]; var n = g.Normals[i]; var uv = g.UV0[i];
                verts[i] = (new VertexPositionNormal(p.X, p.Y, p.Z, n.X, n.Y, n.Z),
                            new VertexTexture1(new Vector2(uv.X, uv.Y)));
            }
            int tris = EmitTriangles(g.Indices, verts.Length, (a, b, c) => prim.AddTriangle(verts[a], verts[b], verts[c]));
            scene.AddRigidMesh(mb, Matrix4x4.Identity);
            return tris;
        }

        if (hasUv)
        {
            var mb = new MeshBuilder<VertexPosition, VertexTexture1>(g.Name);
            var prim = mb.UsePrimitive(material);
            var verts = new (VertexPosition, VertexTexture1)[g.Positions.Count];
            for (int i = 0; i < g.Positions.Count; i++)
            {
                var p = g.Positions[i]; var uv = g.UV0[i];
                verts[i] = (new VertexPosition(p.X, p.Y, p.Z), new VertexTexture1(new Vector2(uv.X, uv.Y)));
            }
            int tris = EmitTriangles(g.Indices, verts.Length, (a, b, c) => prim.AddTriangle(verts[a], verts[b], verts[c]));
            scene.AddRigidMesh(mb, Matrix4x4.Identity);
            return tris;
        }

        if (hasNormals)
        {
            var mb = new MeshBuilder<VertexPositionNormal>(g.Name);
            var prim = mb.UsePrimitive(material);
            var verts = new VertexPositionNormal[g.Positions.Count];
            for (int i = 0; i < g.Positions.Count; i++)
            {
                var p = g.Positions[i]; var n = g.Normals[i];
                verts[i] = new VertexPositionNormal(p.X, p.Y, p.Z, n.X, n.Y, n.Z);
            }
            int tris = EmitTriangles(g.Indices, verts.Length, (a, b, c) => prim.AddTriangle(verts[a], verts[b], verts[c]));
            scene.AddRigidMesh(mb, Matrix4x4.Identity);
            return tris;
        }

        var mbp = new MeshBuilder<VertexPosition>(g.Name);
        var primp = mbp.UsePrimitive(material);
        var vp = new VertexPosition[g.Positions.Count];
        for (int i = 0; i < g.Positions.Count; i++)
            vp[i] = new VertexPosition(g.Positions[i].X, g.Positions[i].Y, g.Positions[i].Z);
        int t = EmitTriangles(g.Indices, vp.Length, (a, b, c) => primp.AddTriangle(vp[a], vp[b], vp[c]));
        scene.AddRigidMesh(mbp, Matrix4x4.Identity);
        return t;
    }

    private static int EmitTriangles(IReadOnlyList<uint> indices, int vertexCount, Action<int, int, int> add)
    {
        int tris = 0;
        for (int i = 0; i + 2 < indices.Count; i += 3)
        {
            uint i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];
            if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount)
                continue;
            add((int)i0, (int)i1, (int)i2);
            tris++;
        }
        return tris;
    }
}
