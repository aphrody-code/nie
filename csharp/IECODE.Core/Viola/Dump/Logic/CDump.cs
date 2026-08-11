using IECODE.Core.Formats.Criware.CriFs;
using IECODE.Core.Formats.Criware.CriFs.Encryption;
using System.Text;
using IECODE.Core.Formats.Criware.CriFs.Definitions.Structs;
using Viola.Core.Launcher.DataClasses;
using Viola.Core.Utils.General.Logic;
using Viola.Core.EncryptDecrypt.Logic.Utils;
using Viola.Core.ViolaLogger.Logic;
using Viola.Core.Settings.Logic;
using IECODE.Core.Formats.Level5.CfgBin;
using System.Runtime;
using System.Collections.Concurrent;
using System.Buffers.Binary;

namespace Viola.Core.Dump.Logic;

sealed class CDump
{
    private string _dirToDump = string.Empty;
    public static string DumpFolder = "dumped";
    private CLaunchOptions _options;

    private Dictionary<string, int>? _smartDumpSizes;
    private Dictionary<string, List<string>>? _cpkContents;
    private ConcurrentDictionary<string, byte> _createdDirs = new();

    public CDump(CLaunchOptions options)
    {
        _options = options;
    }

    public void DumpRomfs()
    {
        _dirToDump = _options.InputPath;
        DumpFolder = _options.OutputPath;
        CLogger.LogInfo("Scanning directory...");

        var folderFiles = CGeneralUtils.GetAllFilesWithNormalSlash(_dirToDump);
        var cpkPaths = new List<string>();
        var filesToCopy = new List<string>();

        foreach (var file in folderFiles)
        {
            if (file.Trim().EndsWith(".cpk", StringComparison.OrdinalIgnoreCase)) cpkPaths.Add(file);
            else filesToCopy.Add(file);
        }

        int totalCpks = cpkPaths.Count;
        var settings = CSettings.Load();

        if (settings.SmartDump)
        {
            LoadSmartDumpData();
        }

        CLogger.LogInfo($"Found {totalCpks} CPK(s) to dump. Starting parallel processing...");

        try
        {
            int processedCount = 0;
            var parallelOptions = new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, Environment.ProcessorCount - 1) };

            Parallel.ForEach(cpkPaths, parallelOptions, (cpkPath) =>
            {
                ProcessCpk(cpkPath);
                int current = Interlocked.Increment(ref processedCount);
                // Report progress periodically to avoid flooding
                if (current % 5 == 0 || current == totalCpks)
                {
                    CGeneralUtils.ReportProgress(current, totalCpks, "Dumping CPKs");
                }
            });

            CopyLooseFiles(filesToCopy, settings.SmartDump);

            CGeneralUtils.ReportProgress(0, 0, "");
            CLogger.LogInfo($"Done. Dumped to `{DumpFolder.Replace("\\", "/")}`");
        }
        finally
        {
            _smartDumpSizes = null;
            _cpkContents = null;
            _createdDirs.Clear();

            GCSettings.LargeObjectHeapCompactionMode = GCLargeObjectHeapCompactionMode.CompactOnce;
            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();
        }
    }

    private void LoadSmartDumpData()
    {
        string cpkListPath = _options.CpkListPath;

        if (string.IsNullOrEmpty(cpkListPath) || !File.Exists(cpkListPath))
        {
            cpkListPath = Path.Combine(_dirToDump, "data", "cpk_list.cfg.bin");
            if (!File.Exists(cpkListPath))
            {
                cpkListPath = Path.Combine(DumpFolder, "data", "cpk_list.cfg.bin");
            }
        }

        if (File.Exists(cpkListPath))
        {
            try
            {
                CLogger.LogInfo($"Loading Smart Dump data from {Path.GetFileName(cpkListPath)}...");
                byte[] fileBytes = File.ReadAllBytes(cpkListPath);
                uint checkHeader = BinaryPrimitives.ReadUInt32LittleEndian(fileBytes);
                if (checkHeader > 10000000)
                {
                    CCriwareCrypt.DecryptBlock(fileBytes, 0, 0x1717E18E);
                }

                CfgBin cpkList = new CfgBin();
#pragma warning disable IL2026 // CfgBin uses unreferenced code
                cpkList.Open(fileBytes);
#pragma warning restore IL2026

                if (cpkList.Entries.Count > 0 && cpkList.Entries[0].Children != null)
                {
                    _smartDumpSizes = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                    _cpkContents = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);

                    foreach (var item in cpkList.Entries[0].Children)
                    {
                        string dir = (string)item.Variables[0].Value!;
                        string name = (string)item.Variables[1].Value!;
                        string fullPath = dir + name;
                        int size = (int)item.Variables[4].Value!;
                        _smartDumpSizes[fullPath] = size;

                        string cpkDir = (string)item.Variables[2].Value!;
                        string cpkName = (string)item.Variables[3].Value!;
                        if (!string.IsNullOrEmpty(cpkName))
                        {
                            string cpkPath = Path.Combine(cpkDir, cpkName).Replace("\\", "/");
                            if (cpkPath.StartsWith('/')) cpkPath = cpkPath[1..];

                            if (!_cpkContents.TryGetValue(cpkPath, out var list))
                            {
                                list = new List<string>();
                                _cpkContents[cpkPath] = list;
                            }
                            list.Add(fullPath);
                        }
                    }
                    CLogger.LogInfo($"Smart Dump enabled. Loaded {_smartDumpSizes.Count} file entries.");
                }
            }
            catch (Exception ex)
            {
                CLogger.AddImportantInfo($"Failed to load Smart Dump data: {ex.Message}. Proceeding with full dump.");
                _smartDumpSizes = null;
                _cpkContents = null;
            }
        }
        else
        {
            CLogger.LogInfo("Smart Dump enabled but cpk_list.cfg.bin not found. Proceeding with full dump.");
        }
    }

    private void ProcessCpk(string cpkPath)
    {
        if (ShouldSkipCpk(cpkPath)) return;

        try
        {
            using var streamToRead = GetCpkStream(cpkPath);
            if (streamToRead != null)
            {
                ExtractFilesFromStream(streamToRead);
            }
        }
        catch (Exception ex)
        {
            CLogger.AddImportantInfo($"Error extracting {Path.GetFileName(cpkPath)}: {ex.Message}");
        }
    }

    private bool ShouldSkipCpk(string cpkPath)
    {
        if (_cpkContents != null && _smartDumpSizes != null)
        {
            string relativeCpk = Path.GetRelativePath(_dirToDump, cpkPath).Replace("\\", "/");
            List<string>? expectedFiles = null;

            if (_cpkContents.TryGetValue(relativeCpk, out expectedFiles))
            {
                // Direct match found
            }
            else
            {
                // Try fuzzy match for folder structure mismatches
                string? matchedKey = null;
                int matchCount = 0;

                foreach (var key in _cpkContents.Keys)
                {
                    if (key.EndsWith(relativeCpk, StringComparison.OrdinalIgnoreCase) ||
                        relativeCpk.EndsWith(key, StringComparison.OrdinalIgnoreCase))
                    {
                        matchedKey = key;
                        matchCount++;
                    }
                }

                if (matchCount == 1 && matchedKey != null)
                {
                    expectedFiles = _cpkContents[matchedKey];
                }
            }

            if (expectedFiles != null)
            {
                bool allExist = true;
                foreach (var file in expectedFiles)
                {
                    string checkPath = Path.Combine(DumpFolder, file.StartsWith('/') ? file[1..] : file);
                    if (!File.Exists(checkPath))
                    {
                        allExist = false;
                        break;
                    }
                    if (new FileInfo(checkPath).Length != _smartDumpSizes[file])
                    {
                        allExist = false;
                        break;
                    }
                }

                if (allExist)
                {
                    // CLogger.LogInfo($"Skipping {Path.GetFileName(cpkPath)} (Smart Dump)");
                    return true;
                }
            }
        }
        return false;
    }

    private static Stream GetCpkStream(string cpkPath)
    {
        // Check if file is encrypted by reading magic bytes
        Span<byte> magic = stackalloc byte[4];
        using (var checkFs = new FileStream(cpkPath, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            if (checkFs.Read(magic) < 4)
                throw new InvalidDataException($"File too small: {Path.GetFileName(cpkPath)}");
        }

        // If already decrypted (CPK magic), return plain FileStream
        if (Encoding.UTF8.GetString(magic) == "CPK ")
        {
            return new FileStream(cpkPath, FileMode.Open, FileAccess.Read, FileShare.Read,
              bufferSize: 128 * 1024, FileOptions.SequentialScan);
        }

        // Use IECODE.Core.Formats.Criware.CriFs's optimized CpkDecryptionStream
        var decryptStream = CpkDecryptionStream.FromFile(cpkPath);

        // Verify decryption worked
        Span<byte> check = stackalloc byte[4];
        decryptStream.ReadExactly(check);
        string headerStr = Encoding.UTF8.GetString(check);

        if (headerStr != "CPK " && check[0] != 0x82) // 0x82 is CRILAYLA compressed
        {
            decryptStream.Dispose();

            // Try lowercase filename key
            string filename = Path.GetFileName(cpkPath).ToLower();
            uint key = CriwareCrypt.CalculateKeyFromFilename(filename);
            var fs = new FileStream(cpkPath, FileMode.Open, FileAccess.Read, FileShare.Read,
              bufferSize: 128 * 1024, FileOptions.SequentialScan);
            decryptStream = new CpkDecryptionStream(fs, key, ownsStream: true);

            decryptStream.ReadExactly(check);
            headerStr = Encoding.UTF8.GetString(check);

            if (headerStr != "CPK " && check[0] != 0x82)
            {
                decryptStream.Dispose();
                throw new InvalidOperationException($"Decryption failed for {Path.GetFileName(cpkPath)}. Header: {BitConverter.ToString(check.ToArray())}");
            }
        }

        decryptStream.Position = 0;
        return decryptStream;
    }

    private void ExtractFilesFromStream(Stream stream)
    {
        // CriFsLib is thread-safe for reading?
        // We are creating a new reader per stream (per thread), so its fine.
        using var reader = new CriFsLib().CreateCpkReader(stream, true);
        var files = reader.GetFiles(); // IEnumerable

        foreach (CpkFile file in files)
        {
            if (_smartDumpSizes != null)
            {
                string relativePath = string.IsNullOrEmpty(file.Directory)
                    ? file.FileName
                    : $"{file.Directory}/{file.FileName}";

                if (_smartDumpSizes.TryGetValue(relativePath, out int expectedSize))
                {
                    var checkPath = Path.Combine(DumpFolder, relativePath);
                    if (File.Exists(checkPath))
                    {
                        long currentSize = new FileInfo(checkPath).Length;
                        if (currentSize == expectedSize)
                        {
                            continue;
                        }
                    }
                }
            }

            using var extractedFile = reader.ExtractFile(file);
            var filePath = $"{DumpFolder}/{file.Directory}/{file.FileName}";

            string dirPath = Path.GetDirectoryName(filePath)!;

            // Thread-safe directory creation check
            if (!_createdDirs.ContainsKey(dirPath))
            {
                Directory.CreateDirectory(dirPath);
                _createdDirs.TryAdd(dirPath, 0);
            }

            // Optimization: 1MB buffer + SequentialScan hint for OS prefetching
            using var outFs = new FileStream(
              filePath,
              FileMode.Create,
              FileAccess.Write,
              FileShare.None,
              bufferSize: 1024 * 1024,
              FileOptions.SequentialScan);
            outFs.Write(extractedFile.Span);
        }
    }

    private void CopyLooseFiles(List<string> filesToCopy, bool smartDump)
    {
        int processed = 0;
        int total = filesToCopy.Count;

        Parallel.ForEach(filesToCopy, new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount }, (file) =>
        {
            var destFile = $"{DumpFolder}/{file.Substring(_dirToDump.Length)}";

            if (smartDump && File.Exists(destFile))
            {
                long srcLen = new FileInfo(file).Length;
                long dstLen = new FileInfo(destFile).Length;
                if (srcLen == dstLen)
                {
                    return;
                }
            }

            var destDir = Path.GetDirectoryName(destFile);
            if (!_createdDirs.ContainsKey(destDir!))
            {
                Directory.CreateDirectory(destDir!);
                _createdDirs.TryAdd(destDir!, 0);
            }

            // Use CopyTo with large buffer + SequentialScan for OS prefetching
            using var sourceStream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read,
          bufferSize: 1024 * 1024, FileOptions.SequentialScan);
            using var destStream = new FileStream(destFile, FileMode.Create, FileAccess.Write, FileShare.None,
          bufferSize: 1024 * 1024, FileOptions.SequentialScan);
            sourceStream.CopyTo(destStream);

            int current = Interlocked.Increment(ref processed);
            if (current % 10 == 0)
            {
                CGeneralUtils.ReportProgress(current, total, "Copying files");
            }
        });
    }
}

