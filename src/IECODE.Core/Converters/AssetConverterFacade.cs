using System;
using System.Buffers;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using System.Threading;
using System.Threading.Tasks;
using IECODE.Core.Formats;
using IECODE.Core.Serialization;
using IECODE.Core.Formats.Level5;
using IECODE.Core.Formats.Criware;
using IECODE.Core.Formats.Criware.CriFs;
using IECODE.Core.Formats.Criware.CriFs.Encryption;
using IECODE.Core.Crypto;
using IECODE.Core.Native;
using IECODE.Core.Formats.Level5.CfgBin;
using IECODE.Core.Logging;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.PixelFormats;

namespace IECODE.Core.Converters;

/// <summary>
/// Unified facade for converting game assets to standard formats.
/// Supports all Level-5 formats (G4TX, G4MG, G4MD, G4SK, G4MT, cfg.bin) and Criware (USM, ADX, HCA).
/// </summary>
public class AssetConverterFacade
{
    private readonly VideoConverter _videoConverter;

    /// <summary>
    /// All supported Level-5 extensions for Windows file associations.
    /// </summary>
    public static readonly string[] SupportedExtensions =
    [
        ".g4tx", ".g4mg", ".g4md", ".g4sk", ".g4mt", ".g4pk", ".g4ra",
        ".cfg.bin", ".xfsa", ".xpck", ".agi", ".objb", ".pxcl",
        ".cpk", ".usm", ".acb", ".awb", ".adx", ".hca",
        ".dds"
    ];

    public AssetConverterFacade(string ffmpegPath = "ffmpeg")
    {
        _videoConverter = new VideoConverter(ffmpegPath);
    }

    /// <summary>
    /// Converts a G4TX texture file to PNG or WebP.
    /// Uses source filename as prefix to avoid conflicts in parallel conversion.
    /// </summary>
    public void ConvertTexture(string inputPath, string outputPath, bool asWebp = false)
    {
        var textures = G4txParser.ParseFile(inputPath);

        // G4TX can contain multiple textures, but usually we want the main one or all.
        // For simplicity, if output path is a file, we convert the first one.
        // If it's a directory, we convert all.

        bool isDirectory = string.IsNullOrEmpty(Path.GetExtension(outputPath));

        if (isDirectory)
        {
            Directory.CreateDirectory(outputPath);
            // Use source filename as prefix to avoid conflicts when textures have same internal names
            string sourceBaseName = Path.GetFileNameWithoutExtension(inputPath);
            foreach (var tex in textures)
            {
                string ext = asWebp ? "webp" : "png";
                // Prefix with source filename to ensure uniqueness across parallel conversion
                string file = Path.Combine(outputPath, $"{sourceBaseName}_{tex.Name}.{ext}");
                if (asWebp) tex.SaveAsWebp(file);
                else tex.SaveAsPng(file);
            }
        }
        else
        {
            if (textures.Count > 0)
            {
                if (asWebp) textures[0].SaveAsWebp(outputPath);
                else textures[0].SaveAsPng(outputPath);
            }
        }
    }

    /// <summary>
    /// Converts a DDS texture file to PNG or WebP.
    /// </summary>
    public void ConvertDds(string inputPath, string outputPath, bool asWebp = false)
    {
        using var image = IECODE.Core.Graphics.TextureConverter.LoadDdsToImage(inputPath);
        if (asWebp)
            image.Save(outputPath, new WebpEncoder { FileFormat = WebpFileFormatType.Lossless });
        else
            image.Save(outputPath, new PngEncoder { CompressionLevel = PngCompressionLevel.BestCompression, ColorType = PngColorType.RgbWithAlpha });
    }

    /// <summary>
    /// Converts a G4MG model file to GLB.
    /// </summary>
    public void ConvertModel(string inputPath, string outputPath)
    {
        // Les .g4mg sont sans en-tête : le .g4md compagnon est obligatoire.
        string g4mdPath = Path.ChangeExtension(inputPath, ".g4md");
        if (!File.Exists(g4mdPath))
            throw new FileNotFoundException(
                $"G4MG sans en-tête : .g4md compagnon requis, introuvable à '{g4mdPath}'.", g4mdPath);

        var g4md = new G4mdParser();
        g4md.Parse(g4mdPath);

        var g4mgData = File.ReadAllBytes(inputPath);
        var meshes = G4mgParser.ParseRawGeometry(g4mgData, g4md);

        // Try to find associated textures
        // Heuristic: Look in data/dx11 mirror path
        string? texturePath = FindTextureForModel(inputPath);

        if (texturePath != null && File.Exists(texturePath))
            LogService.Instance.Info("Converter", $"Found associated texture: {texturePath}");

        meshes.SaveAllAsGlb(g4mgData, outputPath);
    }

    /// <summary>
    /// Converts a G4MD model file (with associated G4MG) to GLB.
    /// </summary>
    public void ConvertG4md(string inputPath, string outputPath)
    {
        var g4mdParser = new G4mdParser();
        g4mdParser.Parse(inputPath);

        string g4mgPath = Path.ChangeExtension(inputPath, ".g4mg");
        if (!File.Exists(g4mgPath))
            throw new FileNotFoundException($"Associated G4MG file not found: {g4mgPath}");

        // Read once; all decryption attempts restore from this copy.
        var originalData = File.ReadAllBytes(g4mgPath);
        var g4mgData = (byte[])originalData.Clone();

        uint magic = BinaryPrimitives.ReadUInt32LittleEndian(g4mgData);
        if (magic != 0x474D4734) // Not G4MG — try decryption
        {
            LogService.Instance.Warn("Converter", $"Invalid G4MG magic: 0x{magic:X8}. Attempting decryption...");

            // Attempt 1: key derived from full path
            uint key = NativeCrypto.CalculateKeyFromPath(g4mgPath);
            NativeCrypto.DecryptBlock(g4mgData.AsSpan(), 0, key);
            magic = BinaryPrimitives.ReadUInt32LittleEndian(g4mgData);

            if (magic != 0x474D4734)
            {
                // Attempt 2+: key derived from filename variants — read original once, copy per attempt
                string fileName = Path.GetFileName(g4mgPath);
                var variants = new[]
                {
                    fileName,
                    fileName.ToLowerInvariant(),
                    Path.GetFileNameWithoutExtension(g4mgPath),
                    Path.GetFileNameWithoutExtension(g4mgPath).ToLowerInvariant(),
                };

                bool decrypted = false;
                foreach (var variant in variants)
                {
                    originalData.CopyTo(g4mgData.AsSpan());
                    key = NativeCrypto.CalculateKeyFromFilename(variant);
                    NativeCrypto.DecryptBlock(g4mgData.AsSpan(), 0, key);
                    magic = BinaryPrimitives.ReadUInt32LittleEndian(g4mgData);
                    if (magic == 0x474D4734)
                    {
                        LogService.Instance.Success("Converter", $"Decrypted G4MG with key from '{variant}' (Key: 0x{key:X8})");
                        decrypted = true;
                        break;
                    }
                }

                if (!decrypted)
                    LogService.Instance.Warn("Converter", $"Failed to decrypt G4MG. Magic is still 0x{magic:X8}");
            }
            else
            {
                LogService.Instance.Success("Converter", "Decrypted G4MG with path key.");
            }
        }

        var meshes = G4mgParser.ParseRawGeometry(g4mgData, g4mdParser);

        string? texturePath = FindTextureForModel(inputPath);
        if (texturePath != null && File.Exists(texturePath))
            LogService.Instance.Info("Converter", $"Found associated texture: {texturePath}");

        // Pass the in-memory buffer directly — no temp file, no extra I/O.
        meshes.SaveAllAsGlb(g4mgData, outputPath);
    }

    private string? FindTextureForModel(string modelPath)
    {
        // Convert common path to dx11 path
        // e.g. data/common/chr/... -> data/dx11/chr/...
        string? dir = Path.GetDirectoryName(modelPath);
        string name = Path.GetFileNameWithoutExtension(modelPath);

        if (dir == null) return null;

        // Check if we are in data/common
        if (dir.Contains("data\\common") || dir.Contains("data/common"))
        {
            string dx11Dir = dir.Replace("data\\common", "data\\dx11")
                                .Replace("data/common", "data/dx11");

            // Texture usually has same name as model but .g4tx extension
            string texturePath = Path.Combine(dx11Dir, $"{name}.g4tx");
            if (File.Exists(texturePath)) return texturePath;

            // Sometimes texture has suffix like _00, _10
            // Check for files starting with name
            if (Directory.Exists(dx11Dir))
            {
                var candidates = Directory.GetFiles(dx11Dir, $"{name}*.g4tx");
                if (candidates.Length > 0) return candidates[0];
            }
        }

        return null;
    }

    /// <summary>
    /// Converts a CFG.BIN file to JSON.
    /// </summary>
    public void ConvertCfgBin(string inputPath, string outputPath)
    {
        var cfg = new CfgBin();
#pragma warning disable IL2026
        cfg.Open(File.ReadAllBytes(inputPath));
#pragma warning restore IL2026
        cfg.ToJson(outputPath);
    }

    /// <summary>
    /// Converts a G4SK skeleton file to JSON.
    /// </summary>
    public void ConvertSkeleton(string inputPath, string outputPath)
    {
        var parser = new G4skParser();
        parser.Parse(inputPath);

        var skeletonData = new SkeletonData
        {
            BoneCount = parser.Header.BoneCount,
            Bones = parser.Bones.Select(b => new BoneData
            {
                Index = b.Index,
                Name = b.Name,
                ParentIndex = b.ParentIndex
            }).ToList()
        };

        var json = AppJsonContext.SerializeSkeletonData(skeletonData);
        File.WriteAllText(outputPath, json);
    }

    /// <summary>
    /// Converts a G4MT material file to JSON (data block info).
    /// </summary>
    public void ConvertMaterial(string inputPath, string outputPath)
    {
        var blocks = G4mtParser.ParseFile(inputPath);

        var materialData = new MaterialData
        {
            BlockCount = blocks.Count,
            Blocks = blocks.Select(b => new MaterialBlockData
            {
                Index = b.Index,
                Offset = $"0x{b.Offset:X8}",
                Size = b.Size,
                ContainsFloats = G4mtParser.ContainsFloatData(b.Data.Span)
            }).ToList()
        };

        var json = AppJsonContext.SerializeMaterialData(materialData);
        File.WriteAllText(outputPath, json);
    }

    /// <summary>
    /// Extracts a G4PK package to a directory, decompressing each embedded file.
    /// </summary>
    public void ExtractG4pk(string inputPath, string outputDir)
    {
        Directory.CreateDirectory(outputDir);
        var files = G4pkParser.ParseFile(inputPath);
        foreach (var file in files)
        {
            string dest = Path.Combine(outputDir, file.Name);
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            File.WriteAllBytes(dest, file.Data.ToArray());
        }
        LogService.Instance.Info("Converter", $"G4PK: extracted {files.Count} files to {outputDir}");
    }

    /// <summary>
    /// Extracts a G4RA resource archive to a directory.
    /// </summary>
    public void ExtractG4ra(string inputPath, string outputDir)
    {
        var archive = G4raParser.ParseFile(inputPath);
        archive.ExtractAll(outputDir);
        LogService.Instance.Info("Converter", $"G4RA: extracted {archive.Resources.Count} resources to {outputDir}");
    }

    /// <summary>
    /// Extracts a CPK archive to a directory using CriFsLib.
    /// Handles encrypted CPKs (IEVR uses 0x1717E18E key).
    /// </summary>
    public async Task ExtractCpkAsync(string inputPath, string outputDir, CancellationToken ct = default)
    {
        Directory.CreateDirectory(outputDir);
        outputDir = Path.GetFullPath(outputDir);
        if (!outputDir.EndsWith(Path.DirectorySeparatorChar))
            outputDir += Path.DirectorySeparatorChar;

        using var stream = OpenCpkStream(inputPath);
        using var reader = CriFsLib.Instance.CreateCpkReader(stream, ownsStream: true);

        var files = reader.GetFiles().ToArray();
        int extracted = 0;
        var readerLock = new object();

        await Parallel.ForEachAsync(files,
            new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount, CancellationToken = ct },
            async (file, token) =>
            {
                string relative = string.IsNullOrEmpty(file.Directory)
                    ? file.FileName
                    : $"{file.Directory}/{file.FileName}";
                string dest = Path.GetFullPath(Path.Combine(outputDir, relative.Replace('/', Path.DirectorySeparatorChar)));
                if (!dest.StartsWith(outputDir, StringComparison.Ordinal))
                    return; // path traversal guard

                Directory.CreateDirectory(Path.GetDirectoryName(dest)!);

                // Rent a pooled buffer, copy the extracted span into it, write async, then return it.
                byte[] rented;
                int dataLen;
                lock (readerLock)
                {
                    using var span = reader.ExtractFile(file);
                    dataLen = span.Span.Length;
                    rented = ArrayPool<byte>.Shared.Rent(dataLen);
                    span.Span.CopyTo(rented);
                }
                try
                {
                    await File.WriteAllBytesAsync(dest, rented.AsMemory(0, dataLen), token);
                }
                finally
                {
                    ArrayPool<byte>.Shared.Return(rented);
                }
                Interlocked.Increment(ref extracted);
            });

        LogService.Instance.Success("Converter", $"CPK: extracted {extracted}/{files.Length} files to {outputDir}");
    }

    private static Stream OpenCpkStream(string cpkPath)
    {
        // Peek at the magic to decide whether decryption is needed
        Span<byte> header = stackalloc byte[4];
        using (var peek = new FileStream(cpkPath, FileMode.Open, FileAccess.Read, FileShare.Read))
            peek.ReadExactly(header);

        // "CPK " = 0x43504B20 — not encrypted
        if (header[0] == 'C' && header[1] == 'P' && header[2] == 'K' && header[3] == ' ')
            return new FileStream(cpkPath, FileMode.Open, FileAccess.Read, FileShare.Read, 128 * 1024, FileOptions.SequentialScan);

        return CpkDecryptionStream.FromFile(cpkPath);
    }

    /// <summary>
    /// Converts a USM video file to MP4 or WebM.
    /// </summary>
    public async Task ConvertVideoAsync(string inputPath, string outputPath, bool asWebp = false, CancellationToken ct = default)
    {
        if (_videoConverter.IsAvailable())
        {
            if (asWebp)
            {
                await _videoConverter.ConvertToWebmAsync(inputPath, outputPath, ct: ct);
            }
            else
            {
                await _videoConverter.ConvertToMp4Async(inputPath, outputPath, ct: ct);
            }
        }
        else
        {
            LogService.Instance.Warn("Converter", "FFmpeg not found. Falling back to USM demuxing (extracting raw streams).");
            string outputDir = Path.GetDirectoryName(outputPath) ?? ".";
            Directory.CreateDirectory(outputDir);
            UsmDemuxer.Demux(inputPath, outputDir);
        }
    }

    /// <summary>
    /// Converts a single file based on its extension.
    /// Supports all Level-5 formats.
    /// </summary>
    public async Task<string?> ConvertFileAsync(string inputPath, string outputDir, string? format = null)
    {
        string ext = Path.GetExtension(inputPath).ToLowerInvariant();
        string fileName = Path.GetFileNameWithoutExtension(inputPath);
        string? outputPath = null;

        try
        {
            Directory.CreateDirectory(outputDir);

            bool asWebp = format == "webp";
            outputPath = ext switch
            {
                ".g4tx" => ConvertTextureToDir(inputPath, outputDir, asWebp),
                ".dds" => ConvertDdsToFile(inputPath, outputDir, fileName, asWebp),
                ".g4mg" => ConvertModelToFile(inputPath, outputDir, fileName),
                ".g4md" => ConvertG4mdToFile(inputPath, outputDir, fileName),
                ".g4sk" => ConvertSkeletonToFile(inputPath, outputDir, fileName),
                ".g4mt" => ConvertMaterialToFile(inputPath, outputDir, fileName),
                ".g4pk" => ExtractG4pkToDir(inputPath, outputDir, fileName),
                ".g4ra" => ExtractG4raToDir(inputPath, outputDir, fileName),
                ".cpk" => await ExtractCpkToDir(inputPath, outputDir, fileName),
                ".objbin" => ConvertCfgBinToFile(inputPath, outputDir, fileName),
                ".usm" => await ConvertVideoToFileAsync(inputPath, outputDir, fileName, format),
                ".agi" or ".objb" or ".pxcl" => ExportBinaryInfoToFile(inputPath, outputDir, fileName),
                _ when inputPath.EndsWith(".cfg.bin", StringComparison.OrdinalIgnoreCase)
                    => ConvertCfgBinToFile(inputPath, outputDir, fileName),
                _ => null
            };

            return outputPath;
        }
        catch (Exception ex)
        {
            LogService.Instance.Error("Converter", $"Failed to convert {inputPath}: {ex.Message}");
            return null;
        }
    }

    // --- Switch-expression helpers for ConvertFileAsync ---

    private string ConvertTextureToDir(string inputPath, string outputDir, bool asWebp)
    {
        ConvertTexture(inputPath, outputDir, asWebp);
        return outputDir;
    }

    private string ConvertDdsToFile(string inputPath, string outputDir, string fileName, bool asWebp)
    {
        string outPath = Path.Combine(outputDir, $"{fileName}.{(asWebp ? "webp" : "png")}");
        ConvertDds(inputPath, outPath, asWebp);
        return outPath;
    }

    private string ConvertModelToFile(string inputPath, string outputDir, string fileName)
    {
        string outPath = Path.Combine(outputDir, $"{fileName}.glb");
        ConvertModel(inputPath, outPath);
        return outPath;
    }

    private string ConvertG4mdToFile(string inputPath, string outputDir, string fileName)
    {
        string outPath = Path.Combine(outputDir, $"{fileName}.glb");
        ConvertG4md(inputPath, outPath);
        return outPath;
    }

    private string ConvertSkeletonToFile(string inputPath, string outputDir, string fileName)
    {
        string outPath = Path.Combine(outputDir, $"{fileName}.skeleton.json");
        ConvertSkeleton(inputPath, outPath);
        return outPath;
    }

    private string ConvertMaterialToFile(string inputPath, string outputDir, string fileName)
    {
        string outPath = Path.Combine(outputDir, $"{fileName}.material.json");
        ConvertMaterial(inputPath, outPath);
        return outPath;
    }

    private string ExtractG4pkToDir(string inputPath, string outputDir, string fileName)
    {
        string outPath = Path.Combine(outputDir, fileName);
        ExtractG4pk(inputPath, outPath);
        return outPath;
    }

    private string ExtractG4raToDir(string inputPath, string outputDir, string fileName)
    {
        string outPath = Path.Combine(outputDir, fileName);
        ExtractG4ra(inputPath, outPath);
        return outPath;
    }

    private async Task<string> ExtractCpkToDir(string inputPath, string outputDir, string fileName)
    {
        string outPath = Path.Combine(outputDir, fileName);
        await ExtractCpkAsync(inputPath, outPath);
        return outPath;
    }

    private string ConvertCfgBinToFile(string inputPath, string outputDir, string fileName)
    {
        // Strip trailing ".cfg" from names like "foo.cfg.bin" → outputting "foo.json"
        string name = fileName.EndsWith(".cfg", StringComparison.OrdinalIgnoreCase)
            ? Path.GetFileNameWithoutExtension(fileName)
            : fileName;
        string outPath = Path.Combine(outputDir, $"{name}.json");
        ConvertCfgBin(inputPath, outPath);
        return outPath;
    }

    private async Task<string> ConvertVideoToFileAsync(string inputPath, string outputDir, string fileName, string? format)
    {
        bool asWebm = format == "webm";
        string outPath = Path.Combine(outputDir, $"{fileName}.{(asWebm ? "webm" : "mp4")}");
        await ConvertVideoAsync(inputPath, outPath, asWebm);
        return outPath;
    }

    private string ExportBinaryInfoToFile(string inputPath, string outputDir, string fileName)
    {
        string outPath = Path.Combine(outputDir, $"{fileName}.info.json");
        ExportBinaryInfo(inputPath, outPath);
        return outPath;
    }

    /// <summary>
    /// Export binary file info (for formats without full parser yet).
    /// </summary>
    private void ExportBinaryInfo(string inputPath, string outputPath)
    {
        // Read only the first 16 bytes — enough for magic detection.
        // File size comes from FileInfo (no need to load the entire file).
        Span<byte> header = stackalloc byte[16];
        int headerRead;
        using (var fs = new FileStream(inputPath, FileMode.Open, FileAccess.Read, FileShare.Read))
            headerRead = fs.Read(header);

        var fileSize = new FileInfo(inputPath).Length;
        var detected = FormatDetector.Detect(header[..headerRead]);

        var info = new BinaryFileInfo
        {
            File = Path.GetFileName(inputPath),
            Size = (int)fileSize,
            Format = detected.Format.ToString(),
            Description = detected.Description,
            Magic = $"0x{BinaryPrimitives.ReadUInt32LittleEndian(header):X8}",
            Extension = detected.Extension
        };

        File.WriteAllText(outputPath, AppJsonContext.SerializeBinaryFileInfo(info));
    }

    /// <summary>
    /// Creates a ZIP archive from a directory.
    /// </summary>
    /// <param name="sourceDir">Directory to archive.</param>
    /// <param name="archivePath">
    /// Output ZIP path. Defaults to <c>&lt;sourceDir&gt;.zip</c> next to the source directory.
    /// </param>
    /// <param name="level">Compression level (default: optimal).</param>
    /// <returns>Path of the created archive.</returns>
    public string ArchiveDirectory(string sourceDir, string? archivePath = null,
        CompressionLevel level = CompressionLevel.Optimal)
    {
        if (!Directory.Exists(sourceDir))
            throw new DirectoryNotFoundException($"Source directory not found: {sourceDir}");

        archivePath ??= sourceDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + ".zip";

        if (File.Exists(archivePath))
            File.Delete(archivePath);

        ZipFile.CreateFromDirectory(sourceDir, archivePath, level, includeBaseDirectory: false);

        var info = new FileInfo(archivePath);
        LogService.Instance.Success("Converter", $"Archive created: {archivePath} ({info.Length / 1024:N0} KB)");

        return archivePath;
    }

    /// <summary>
    /// Converts all supported files in a directory.
    /// Supports all Level-5 and Criware formats.
    /// Uses parallel processing for faster conversion.
    /// </summary>
    public Task<List<string>> ConvertDirectoryAsync(
        string inputDir, string outputDir, bool recursive, string? format = null)
        => ConvertDirectoryAsync(inputDir, outputDir, recursive, new ConvertOptions { Format = format });

    /// <summary>
    /// Converts all supported files in a directory with full options.
    /// </summary>
    public async Task<List<string>> ConvertDirectoryAsync(
        string inputDir, string outputDir, bool recursive, ConvertOptions options)
    {
        var results      = new System.Collections.Concurrent.ConcurrentBag<string>();
        var searchOption = recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;

        // EnumerateFiles streams lazily — only the filtered set is materialized into memory.
        var supportedFiles = Directory.EnumerateFiles(inputDir, "*.*", searchOption)
            .Where(file =>
            {
                // Language folder filter: skip 2-letter language segments not in the allowed set.
                if (options.IncludedLanguages is { Count: > 0 } langs && IsExcludedLanguagePath(file, langs))
                    return false;

                string ext = Path.GetExtension(file).ToLowerInvariant();
                return ext switch
                {
                    ".g4tx" or ".g4mg" or ".g4md" or ".g4sk" or ".g4mt" or ".g4pk" or ".g4ra" => true,
                    ".usm" or ".dds" or ".cpk" => true,
                    ".agi" or ".objb" or ".pxcl" or ".objbin" => true,
                    _ => file.EndsWith(".cfg.bin", StringComparison.OrdinalIgnoreCase)
                };
            })
            .ToArray();

        int total     = supportedFiles.Length;
        int processed = 0;
        int failed    = 0;
        int skipped   = 0;

        LogService.Instance.Info("Converter", $"Found {total} files to convert. Starting parallel conversion...");

        var parallelOptions = new ParallelOptions
        {
            MaxDegreeOfParallelism = Math.Min(Environment.ProcessorCount * 2, 32)
        };

        // Dedup registry: output path → already queued. StringComparer.OrdinalIgnoreCase for Windows paths.
        var seenOutputs = options.SkipDuplicates
            ? new System.Collections.Concurrent.ConcurrentDictionary<string, byte>(StringComparer.OrdinalIgnoreCase)
            : null;

        int reportEvery = Math.Max(1, total / 20);

        await Parallel.ForEachAsync(supportedFiles, parallelOptions, async (file, ct) =>
        {
            string relativePath = Path.GetRelativePath(inputDir, Path.GetDirectoryName(file)!);
            string targetDir    = Path.Combine(outputDir, relativePath);

            // Dedup check — compute expected output path before doing any work.
            bool wasSkipped = false;
            if (seenOutputs != null)
            {
                string dedupeKey = PredictOutputKey(file, targetDir, options.Format);
                if (!seenOutputs.TryAdd(dedupeKey, 0))
                {
                    Interlocked.Increment(ref skipped);
                    wasSkipped = true;
                }
            }

            if (!wasSkipped)
            {
                try
                {
                    Directory.CreateDirectory(targetDir);
                    var result = await ConvertFileAsync(file, targetDir, options.Format);
                    if (result != null)
                        results.Add(result);
                    else
                        Interlocked.Increment(ref failed);
                }
                catch (Exception ex)
                {
                    LogService.Instance.Error("Converter", $"{Path.GetFileName(file)}: {ex.Message}");
                    Interlocked.Increment(ref failed);
                }
            }

            // Always report progress — skipped files count towards completion too.
            int current = Interlocked.Increment(ref processed);
            if (current % reportEvery == 0 || current == total)
                LogService.Instance.Info("Converter", $"Progress: {current}/{total} ({current * 100 / total}%)");
        });

        if (skipped > 0)
            LogService.Instance.Info("Converter", $"Skipped {skipped} duplicate(s).");
        LogService.Instance.Success("Converter", $"Batch complete: {results.Count} succeeded, {failed} failed, {skipped} skipped out of {total} files");
        return results.ToList();
    }

    // -------------------------------------------------------------------------
    // Language filter
    // -------------------------------------------------------------------------

    /// <summary>
    /// Known 2-letter language folder codes used in IEVR game data.
    /// Any path segment matching one of these (case-insensitive) is treated as a language folder.
    /// </summary>
    private static readonly System.Collections.Frozen.FrozenSet<string> KnownLanguageCodes =
        System.Collections.Frozen.FrozenSet.Create(StringComparer.OrdinalIgnoreCase,
        [
            // 2-letter ISO 639-1
            "de", "en", "es", "fr", "it", "pt", "ja", "zh", "ko",
            "nl", "pl", "ru", "ar", "tr", "cn", "tw", "sv", "da",
            // Regional variants used by Level-5 / IEVR
            "zh_hans", "zh_hant", "pt_br", "zh_cn", "zh_tw",
        ]);

    /// <summary>
    /// Returns true if any path segment is a known language code
    /// NOT present in <paramref name="includedLanguages"/>.
    /// </summary>
    private static bool IsExcludedLanguagePath(string filePath, IReadOnlySet<string> includedLanguages)
    {
        var path = filePath.AsSpan();
        while (path.Length > 0)
        {
            int sep = path.IndexOfAny(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            ReadOnlySpan<char> segment = sep < 0 ? path : path[..sep];

            if (segment.Length >= 2)
            {
                string seg = segment.ToString();
                if (KnownLanguageCodes.Contains(seg) && !includedLanguages.Contains(seg))
                    return true;
            }

            path = sep < 0 ? default : path[(sep + 1)..];
        }
        return false;
    }

    // -------------------------------------------------------------------------
    // Duplicate detection
    // -------------------------------------------------------------------------

    /// <summary>
    /// Predicts the output key for a given input file.
    /// For formats that output a single file, this is the output path.
    /// For directory outputs (.g4tx, .g4pk, .g4ra), uses source filename as key within targetDir.
    /// </summary>
    private static string PredictOutputKey(string inputPath, string targetDir, string? format)
    {
        string ext      = Path.GetExtension(inputPath).ToLowerInvariant();
        string fileName = Path.GetFileNameWithoutExtension(inputPath);
        bool   asWebp   = format == "webp";

        return ext switch
        {
            ".g4tx"                  => Path.Combine(targetDir, fileName), // dir output, key by source name
            ".dds"                   => Path.Combine(targetDir, $"{fileName}.{(asWebp ? "webp" : "png")}"),
            ".g4mg"                  => Path.Combine(targetDir, $"{fileName}.glb"),
            ".g4md"                  => Path.Combine(targetDir, $"{fileName}.glb"),
            ".g4sk"                  => Path.Combine(targetDir, $"{fileName}.skeleton.json"),
            ".g4mt"                  => Path.Combine(targetDir, $"{fileName}.material.json"),
            ".g4pk" or ".g4ra"       => Path.Combine(targetDir, fileName),
            ".usm"                   => Path.Combine(targetDir, $"{fileName}.{(format == "webm" ? "webm" : "mp4")}"),
            ".cpk"                   => Path.Combine(targetDir, fileName),
            ".objbin"                => Path.Combine(targetDir, $"{fileName}.json"),
            ".agi" or ".objb" or ".pxcl" => Path.Combine(targetDir, $"{fileName}.info.json"),
            _ when inputPath.EndsWith(".cfg.bin", StringComparison.OrdinalIgnoreCase)
                => Path.Combine(targetDir, $"{(fileName.EndsWith(".cfg", StringComparison.OrdinalIgnoreCase) ? Path.GetFileNameWithoutExtension(fileName) : fileName)}.json"),
            _ => inputPath // unknown — use source path itself as key
        };
    }
}

/// <summary>
/// Options for <see cref="AssetConverterFacade.ConvertDirectoryAsync(string,string,bool,ConvertOptions)"/>.
/// </summary>
public sealed class ConvertOptions
{
    /// <summary>Target format: png, webp, glb, mp4, webm. Null = default per format.</summary>
    public string? Format { get; init; }

    /// <summary>
    /// Language folders to include (e.g. <c>["fr"]</c>).
    /// Any 2-letter path segment matching a known language code but NOT in this set is skipped.
    /// Null or empty = include all languages.
    /// </summary>
    public IReadOnlySet<string>? IncludedLanguages { get; init; }

    /// <summary>
    /// Skip files whose predicted output path has already been queued in this batch.
    /// Prevents processing the same logical asset twice (e.g. after language filtering).
    /// </summary>
    public bool SkipDuplicates { get; init; } = true;

    /// <summary>French-only preset.</summary>
    public static ConvertOptions FrenchOnly(string? format = null) => new()
    {
        Format = format,
        IncludedLanguages = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "fr" },
        SkipDuplicates = true
    };
}

#region AOT-Compatible Data Models

/// <summary>
/// Package info metadata for G4PK extraction.
/// </summary>
public sealed class PackageInfo
{
    public string Source { get; set; } = string.Empty;
    public int Size { get; set; }
    public string Magic { get; set; } = string.Empty;
    public string Note { get; set; } = string.Empty;
}

/// <summary>
/// Skeleton data for G4SK export.
/// </summary>
public sealed class SkeletonData
{
    public ushort BoneCount { get; set; }
    public List<BoneData> Bones { get; set; } = [];
}

/// <summary>
/// Bone data for skeleton export.
/// </summary>
public sealed class BoneData
{
    public int Index { get; set; }
    public string Name { get; set; } = string.Empty;
    public short ParentIndex { get; set; }
}

/// <summary>
/// Material data for G4MT export.
/// </summary>
public sealed class MaterialData
{
    public int BlockCount { get; set; }
    public List<MaterialBlockData> Blocks { get; set; } = [];
}

/// <summary>
/// Material block data.
/// </summary>
public sealed class MaterialBlockData
{
    public int Index { get; set; }
    public string Offset { get; set; } = string.Empty;
    public int Size { get; set; }
    public bool ContainsFloats { get; set; }
}

/// <summary>
/// Binary file info for unknown format export.
/// </summary>
public sealed class BinaryFileInfo
{
    public string File { get; set; } = string.Empty;
    public int Size { get; set; }
    public string Format { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Magic { get; set; } = string.Empty;
    public string Extension { get; set; } = string.Empty;
}

#endregion

