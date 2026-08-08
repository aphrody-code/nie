using System.CommandLine;
using System.CommandLine.Invocation;
using System.Numerics;
using IECODE.Core.Converters;
using IECODE.Core.Formats.Level5;
using SharpGLTF.Geometry;
using SharpGLTF.Geometry.VertexTypes;
using SharpGLTF.Materials;
using SharpGLTF.Scenes;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande de parsing/conversion des fichiers G4MG (géométrie Level-5).
///
/// Les .g4mg sont SANS en-tête : aucun magic, pas de header. La métadonnée géométrique
/// (offsets/comptes vertex et index, stride, sous-mailles) vit dans le .g4md compagnon de
/// même basename. Sans .g4md → erreur explicite + code de sortie non nul.
/// </summary>
public static class G4mgCommand
{
    public static Command Create()
    {
        var command = new Command("g4mg", "Parse and convert G4MG geometry files (headerless, requires companion .g4md)");

        // Sous-commande : info
        var infoCommand = new Command("info", "Inspect G4MG geometry via its companion .g4md");
        var infoFileArg = new Argument<string>("file", "Path to G4MG file");
        infoCommand.AddArgument(infoFileArg);
        infoCommand.SetHandler((InvocationContext ctx) =>
        {
            string file = ctx.ParseResult.GetValueForArgument(infoFileArg);
            ctx.ExitCode = Info(file);
        });
        command.AddCommand(infoCommand);

        // Sous-commande : to-glb
        var toGlbCommand = new Command("to-glb", "Convert G4MG to GLB (positions + indices, base-color optionnelle)");
        var fileArg = new Argument<string>("file", "Path to G4MG file");
        toGlbCommand.AddArgument(fileArg);
        var outputOption = new Option<string?>(["--output", "-o"], "Output GLB file");
        toGlbCommand.AddOption(outputOption);
        var texturesOption = new Option<bool>(["--textures", "-t"], () => false,
            "Embarquer la base-color réelle depuis le .g4tx compagnon (downscale + WebP)");
        toGlbCommand.AddOption(texturesOption);
        var g4txOption = new Option<string?>(["--g4tx"], () => null,
            "Chemin explicite du .g4tx (sinon résolu : data/common→data/dx11, même basename)");
        toGlbCommand.AddOption(g4txOption);
        var maxTexOption = new Option<int>(["--max-tex"], () => TexturedModelExport.DefaultMaxTextureSize,
            "Côté max de la texture embarquée en px (0 = pas de downscale)");
        toGlbCommand.AddOption(maxTexOption);
        toGlbCommand.SetHandler((InvocationContext ctx) =>
        {
            string file = ctx.ParseResult.GetValueForArgument(fileArg);
            string? output = ctx.ParseResult.GetValueForOption(outputOption);
            bool textures = ctx.ParseResult.GetValueForOption(texturesOption);
            string? g4tx = ctx.ParseResult.GetValueForOption(g4txOption);
            int maxTex = ctx.ParseResult.GetValueForOption(maxTexOption);
            ctx.ExitCode = ConvertToGlb(file, output, textures, g4tx, maxTex);
        });
        command.AddCommand(toGlbCommand);

        return command;
    }

    /// <summary>
    /// Charge le .g4mg et son .g4md compagnon, ou écrit une erreur claire et renvoie un code non nul.
    /// </summary>
    private static bool TryLoad(string g4mgPath, out byte[] g4mgData, out G4mdParser g4md)
    {
        g4mgData = [];
        g4md = new G4mdParser();

        if (!File.Exists(g4mgPath))
        {
            Console.Error.WriteLine($"File not found: {g4mgPath}");
            return false;
        }

        string g4mdPath = Path.ChangeExtension(g4mgPath, ".g4md");
        if (!File.Exists(g4mdPath))
        {
            Console.Error.WriteLine(
                $"G4MG headerless: companion .g4md required, none found at {g4mdPath}");
            return false;
        }

        g4mgData = File.ReadAllBytes(g4mgPath);
        g4md.Parse(g4mdPath);
        return true;
    }

    private static int Info(string g4mgPath)
    {
        if (!TryLoad(g4mgPath, out var g4mgData, out var g4md))
            return 1;

        Console.WriteLine($"G4MG: {Path.GetFileName(g4mgPath)} ({g4mgData.Length} bytes, headerless)");
        Console.WriteLine($"Companion G4MD: submeshes={g4md.Header.SubmeshCount} materials={g4md.Header.MaterialCount} " +
                          $"vlayout={g4md.Header.VLayoutCount} faceDataBase=0x{g4md.Header.FaceDataBase:X}");

        var geometry = G4mgParser.ExtractGeometry(g4mgData, g4md);
        if (geometry.Count == 0)
        {
            Console.Error.WriteLine("No submesh geometry extracted.");
            return 1;
        }

        foreach (var g in geometry)
        {
            Console.WriteLine($"  {g.Name}: V={g.VertexCount} I={g.Indices.Count} stride={g.VertexStride} " +
                              $"index32={g.Index32} vOff=0x{g.VertexBufferOffset:X} iOff=0x{g.IndexBufferOffset:X}");

            if (g.Positions.Count > 0)
            {
                var p = g.Positions[0];
                Console.WriteLine($"    vtx0 pos = ({p.X:0.####}, {p.Y:0.####}, {p.Z:0.####})");
            }
            if (g.Indices.Count >= 6)
            {
                Console.WriteLine($"    idx[0..6] = [{string.Join(", ", g.Indices.Take(6))}]");
            }
            if (g.Attributes.Count > 0)
            {
                var a = g.Attributes
                    .Select(x => $"vtype={x.VType}@{x.Offset}/dt{x.DataType}");
                Console.WriteLine($"    attrs = {string.Join(", ", a)}");
            }
        }

        return 0;
    }

    private static int ConvertToGlb(string g4mgPath, string? outputPath,
        bool textures = false, string? g4txPath = null, int maxTex = TexturedModelExport.DefaultMaxTextureSize)
    {
        if (!TryLoad(g4mgPath, out var g4mgData, out var g4md))
            return 1;

        outputPath = string.IsNullOrEmpty(outputPath) ? Path.ChangeExtension(g4mgPath, ".glb") : outputPath;
        Console.WriteLine($"Converting: {Path.GetFileName(g4mgPath)} -> {Path.GetFileName(outputPath)}" +
                          (textures ? " (+base-color)" : ""));

        byte[]? glb;
        int totalTris;
        if (textures)
        {
            string? resolvedG4tx = g4txPath ?? ResolveG4txOnDisk(g4mgPath);
            if (resolvedG4tx is null || !File.Exists(resolvedG4tx))
            {
                Console.Error.WriteLine($"  .g4tx introuvable ({resolvedG4tx ?? "non résolu"}) ; export sans texture.");
                glb = BuildGlb(g4mgData, g4md, out totalTris, line => Console.WriteLine($"  {line}"));
            }
            else
            {
                Console.WriteLine($"  g4tx : {resolvedG4tx}");
                var loadedTextures = G4txParser.ParseFile(resolvedG4tx);
                glb = TexturedModelExport.BuildTexturedGlb(
                    g4mgData, g4md,
                    g4txProvider: () => loadedTextures,
                    out totalTris, out int texturedCount,
                    maxTextureSize: maxTex,
                    log: line => Console.WriteLine($"  {line}"));
                Console.WriteLine($"  sous-mailles texturées : {texturedCount}");
            }
        }
        else
        {
            glb = BuildGlb(g4mgData, g4md, out totalTris, line => Console.WriteLine($"  {line}"));
        }

        if (glb is null)
        {
            Console.Error.WriteLine("No submesh geometry extracted; nothing to export.");
            return 1;
        }

        File.WriteAllBytes(outputPath, glb);
        Console.WriteLine($"OK: {outputPath} ({totalTris} triangles, {glb.Length:N0} octets)");
        return 0;
    }

    /// <summary>
    /// Résout le chemin disque du .g4tx base-color compagnon d'un .g4mg. Convention IEVR vérifiée :
    /// le modèle vit sous data/common/chr/… alors que le g4tx vit sous data/dx11/chr/… avec le
    /// MÊME basename (ex. …/common/chr/_uniform/u11130090/u11130090.g4mg →
    /// …/dx11/chr/_uniform/u11130090/u11130090.g4tx). À défaut de "common" dans le chemin, tente
    /// un .g4tx homonyme à côté du .g4mg.
    /// </summary>
    public static string? ResolveG4txOnDisk(string g4mgPath)
    {
        string sameDir = Path.ChangeExtension(g4mgPath, ".g4tx");
        if (File.Exists(sameDir))
            return sameDir;

        // data/common/… → data/dx11/… (insensible au séparateur)
        string norm = g4mgPath.Replace('\\', '/');
        int idx = norm.IndexOf("/common/", StringComparison.OrdinalIgnoreCase);
        if (idx >= 0)
        {
            string dx11 = norm[..idx] + "/dx11/" + norm[(idx + "/common/".Length)..];
            dx11 = Path.ChangeExtension(dx11, ".g4tx");
            if (File.Exists(dx11))
                return dx11;
            return dx11; // renvoyé même si absent : l'appelant logge l'échec
        }

        return sameDir;
    }

    /// <summary>
    /// Construit les octets GLB depuis les données g4mg + son g4md déjà parsé.
    /// Réutilisable hors fichier (ex: export par lot depuis les CPK). Renvoie null si
    /// aucune géométrie n'est extraite. Émet POSITION + (si décodés depuis la table d'attributs
    /// réelle du .g4md) NORMAL (normalisé) et TEXCOORD_0. Aucune valeur fabriquée : si une
    /// sous-maille n'a pas de normale/UV résoluble, elle retombe sur POSITION seule.
    /// </summary>
    public static byte[]? BuildGlb(ReadOnlySpan<byte> g4mgData, G4mdParser g4md, out int totalTris, Action<string>? log = null)
    {
        totalTris = 0;
        var geometry = G4mgParser.ExtractGeometry(g4mgData, g4md);
        if (geometry.Count == 0)
            return null;

        var scene = new SceneBuilder();
        var material = new MaterialBuilder("Default").WithDoubleSide(true).WithMetallicRoughnessShader();

        foreach (var g in geometry)
        {
            bool hasNormals = g.Normals.Count == g.Positions.Count && g.Positions.Count > 0;
            bool hasUv = g.UV0.Count == g.Positions.Count && g.Positions.Count > 0;
            log?.Invoke($"{g.Name}: V={g.VertexCount} I={g.Indices.Count} stride={g.VertexStride} " +
                        $"normals={(hasNormals ? "oui" : "non")} uv0={(hasUv ? "oui" : "non")}");

            int added = AddSubmesh(scene, material, g, hasNormals, hasUv);
            totalTris += added;
        }

        var model = scene.ToGltf2();
        using var ms = new MemoryStream();
        model.WriteGLB(ms);
        return ms.ToArray();
    }

    /// <summary>
    /// Ajoute une sous-maille à la scène en choisissant le type de vertex selon les attributs
    /// réellement décodés : position+normale+UV, position+UV, position+normale, ou position seule.
    /// Renvoie le nombre de triangles ajoutés.
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

    /// <summary>
    /// Itère les triangles (triplets d'indices), saute ceux hors limites, et délègue l'ajout.
    /// Renvoie le nombre de triangles effectivement émis.
    /// </summary>
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
