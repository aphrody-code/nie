using System.Diagnostics.CodeAnalysis;
using IECODE.Core;
using IECODE.Core.Formats.Level5;
using IECODE.Core.Formats.Level5.CfgBin;
using IECODE.Core.Formats.Level5.CfgBin.Encryption;
using IECODE.Core.Formats.Level5.CfgBin.Logic;
using IECODE.Core.Formats.Level5.CfgBin.Rdbn;
using IECODE.Core.Serialization;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande config - Lecture/écriture des fichiers cfg.bin.
/// </summary>
public static class ConfigCommand
{
    public static async Task ReadAsync(string? gamePath, string file, string? output, bool verbose)
    {
        try
        {
            using var game = new IEVRGame(gamePath);

            if (!File.Exists(file))
            {
                Console.Error.WriteLine($"Error: File not found: {file}");
                Environment.ExitCode = 1;
                return;
            }

            if (verbose)
            {
                Console.WriteLine($"Reading: {file}");
            }

            string json = game.CfgBin.ExportToJson(file);

            if (!string.IsNullOrEmpty(output))
            {
                await File.WriteAllTextAsync(output, json);
                Console.WriteLine($"Exported to: {output}");
            }
            else
            {
                Console.WriteLine(json);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            if (verbose)
            {
                Console.Error.WriteLine(ex.StackTrace);
            }
            Environment.ExitCode = 1;
        }
    }

    public static async Task ReadCpkListAsync(string? gamePath, string? output, bool verbose)
    {
        try
        {
            using var game = new IEVRGame(gamePath);

            if (!game.IsValid)
            {
                Console.Error.WriteLine($"Error: Game not found at: {game.GamePath}");
                Environment.ExitCode = 1;
                return;
            }

            if (!File.Exists(game.CpkListPath))
            {
                Console.Error.WriteLine($"Error: cpk_list.cfg.bin not found: {game.CpkListPath}");
                Environment.ExitCode = 1;
                return;
            }

            if (verbose)
            {
                Console.WriteLine($"Reading: {game.CpkListPath}");
            }

            var data = game.CfgBin.ReadCpkList();

            Console.WriteLine($"Total entries: {data.Files.Count}");
            Console.WriteLine();

            if (!string.IsNullOrEmpty(output))
            {
                string json = System.Text.Json.JsonSerializer.Serialize(data,
                    AppJsonContext.Default.CpkListData);
                await File.WriteAllTextAsync(output, json);
                Console.WriteLine($"Exported to: {output}");
            }
            else
            {
                // Summary output
                var looseFiles = data.Files.Where(f => f.IsLoose).ToList();
                var cpkFiles = data.Files.Where(f => !f.IsLoose).ToList();
                var cpkNames = cpkFiles.Select(f => f.CpkName).Distinct().ToList();

                Console.WriteLine($"  Loose files: {looseFiles.Count}");
                Console.WriteLine($"  CPK files: {cpkFiles.Count}");
                Console.WriteLine($"  Unique CPKs: {cpkNames.Count}");
                Console.WriteLine();
                Console.WriteLine("Use --output to export full data as JSON.");
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            if (verbose)
            {
                Console.Error.WriteLine(ex.StackTrace);
            }
            Environment.ExitCode = 1;
        }
    }

    public static async Task DecryptAsync(string file, string? output, bool verbose)
    {
        try
        {
            if (!File.Exists(file))
            {
                Console.Error.WriteLine($"Error: File not found: {file}");
                Environment.ExitCode = 1;
                return;
            }

            if (verbose)
            {
                Console.WriteLine($"Decrypting: {file}");
            }

            byte[] data = await File.ReadAllBytesAsync(file);
            string fileName = Path.GetFileName(file);

            byte[] decrypted = CriwareCrypt.Decrypt(data, fileName);

            string outPath = output ?? file + ".dec";
            await File.WriteAllBytesAsync(outPath, decrypted);
            Console.WriteLine($"Decrypted to: {outPath}");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            if (verbose)
            {
                Console.Error.WriteLine(ex.StackTrace);
            }
            Environment.ExitCode = 1;
        }
    }

    public static async Task EncryptAsync(string file, string? keyName, string? output, bool verbose)
    {
        try
        {
            if (!File.Exists(file))
            {
                Console.Error.WriteLine($"Error: File not found: {file}");
                Environment.ExitCode = 1;
                return;
            }

            string key = keyName ?? Path.GetFileName(file);
            if (verbose)
            {
                Console.WriteLine($"Encrypting: {file} with key: {key}");
            }

            byte[] data = await File.ReadAllBytesAsync(file);
            byte[] encrypted = CriwareCrypt.Encrypt(data, key);

            string outPath = output ?? file + ".enc";
            await File.WriteAllBytesAsync(outPath, encrypted);
            Console.WriteLine($"Encrypted to: {outPath}");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            if (verbose)
            {
                Console.Error.WriteLine(ex.StackTrace);
            }
            Environment.ExitCode = 1;
        }
    }

    public static async Task SearchAsync(string? gamePath, string file, string pattern, bool verbose)
    {
        await Task.CompletedTask;
        try
        {
            using var game = new IEVRGame(gamePath);

            if (!File.Exists(file))
            {
                Console.Error.WriteLine($"Error: File not found: {file}");
                Environment.ExitCode = 1;
                return;
            }

            if (verbose)
            {
                Console.WriteLine($"Searching in: {file}");
                Console.WriteLine($"Pattern: {pattern}");
            }

            var entries = game.CfgBin.FindEntries(file, pattern);

            if (entries.Count == 0)
            {
                Console.WriteLine("No entries found.");
                return;
            }

            Console.WriteLine($"Found {entries.Count} entries:");
            Console.WriteLine();

            foreach (var entry in entries)
            {
                Console.WriteLine($"  [{entry.Name}]");
                foreach (var variable in entry.Variables)
                {
                    Console.WriteLine($"    {variable.Name} = {variable.Value}");
                }
                Console.WriteLine();
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            if (verbose)
            {
                Console.Error.WriteLine(ex.StackTrace);
            }
            Environment.ExitCode = 1;
        }
    }

    public static async Task ListAsync(string? gamePath, bool verbose)
    {
        await Task.CompletedTask;
        try
        {
            using var game = new IEVRGame(gamePath);

            if (!game.IsValid)
            {
                Console.Error.WriteLine($"Error: Game not found at: {game.GamePath}");
                Environment.ExitCode = 1;
                return;
            }

            Console.WriteLine($"Scanning: {game.DataPath}");
            Console.WriteLine();

            var files = game.CfgBin.GetAllCfgBinFiles().ToList();

            Console.WriteLine($"Found {files.Count} cfg.bin files:");
            Console.WriteLine();

            foreach (var file in files)
            {
                string relativePath = Path.GetRelativePath(game.DataPath, file);
                var fileInfo = new FileInfo(file);
                Console.WriteLine($"  {relativePath,-60} {fileInfo.Length,10:N0} bytes");
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            if (verbose)
            {
                Console.Error.WriteLine(ex.StackTrace);
            }
            Environment.ExitCode = 1;
        }
    }

    [UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode",
        Justification = "CfgBin types are preserved by IECODE.Core and the external library")]
    public static async Task InfoAsync(string? gamePath, string file, bool verbose)
    {
        await Task.CompletedTask;
        try
        {
            using var game = new IEVRGame(gamePath);

            if (!File.Exists(file))
            {
                Console.Error.WriteLine($"Error: File not found: {file}");
                Environment.ExitCode = 1;
                return;
            }

            byte[] data = File.ReadAllBytes(file);
            string fileName = Path.GetFileName(file);
            var fileInfo = new FileInfo(file);

            Console.WriteLine($"File: {fileName}");
            Console.WriteLine($"Size: {fileInfo.Length:N0} bytes");

            // Detect format using the improved service
            var format = game.CfgBin.DetectFormat(file);
            Console.WriteLine($"Format: {format.Type}");
            Console.WriteLine($"Encrypted: {(format.IsEncrypted ? "Yes" : "No")}");

            if (format.IsEncrypted)
            {
                data = CriwareCrypt.Decrypt(data, fileName);
            }

            Console.WriteLine();

            // Handle based on format type
            if (format.Type == "RDBN")
            {
                var rdbn = RdbnReader.Read(data);
                if (rdbn != null)
                {
                    Console.WriteLine("RDBN Structure:");
                    Console.WriteLine($"  Version: {rdbn.Version}");
                    Console.WriteLine($"  Lists: {rdbn.Lists.Count}");

                    int totalValues = rdbn.Lists.Sum(l => l.Values.Count);
                    Console.WriteLine($"  Total entries: {totalValues}");

                    if (verbose && rdbn.Lists.Count > 0)
                    {
                        Console.WriteLine();
                        Console.WriteLine("Lists:");
                        foreach (var list in rdbn.Lists.Take(20))
                        {
                            Console.WriteLine($"  - {list.Name} ({list.Values.Count} entries, type: {list.TypeName})");
                        }
                        if (rdbn.Lists.Count > 20)
                        {
                            Console.WriteLine($"  ... and {rdbn.Lists.Count - 20} more");
                        }
                    }
                }
            }
            else if (format.Type == "T2B")
            {
                var cfgBin = new CfgBin();
                cfgBin.Open(data);

                Console.WriteLine("T2B Structure:");
                Console.WriteLine($"  Entries: {cfgBin.Entries.Count}");

                int totalVars = 0;
                foreach (var entry in cfgBin.Entries)
                {
                    totalVars += CountVariables(entry);
                }
                Console.WriteLine($"  Variables: {totalVars}");

                if (verbose && cfgBin.Entries.Count > 0)
                {
                    Console.WriteLine();
                    Console.WriteLine("Root entries:");
                    foreach (var entry in cfgBin.Entries.Take(20))
                    {
                        Console.WriteLine($"  - {entry.Name} ({entry.Variables.Count} vars, {entry.Children.Count} children)");
                    }
                    if (cfgBin.Entries.Count > 20)
                    {
                        Console.WriteLine($"  ... and {cfgBin.Entries.Count - 20} more");
                    }
                }
            }
            else
            {
                Console.WriteLine("Unknown format - cannot parse structure");
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            if (verbose)
            {
                Console.Error.WriteLine(ex.StackTrace);
            }
            Environment.ExitCode = 1;
        }
    }

    private static int CountVariables(Entry entry)
    {
        int count = entry.Variables.Count;
        foreach (var child in entry.Children)
        {
            count += CountVariables(child);
        }
        return count;
    }

    /// <summary>
    /// Convertit récursivement tous les fichiers cfg.bin en JSON.
    /// </summary>
    public static async Task ConvertAsync(string? gamePath, string path, bool recursive, bool verbose)
    {
        try
        {
            using var game = new IEVRGame(gamePath);

            // Determine if path is file or directory
            bool isDirectory = Directory.Exists(path);
            bool isFile = File.Exists(path);

            if (!isDirectory && !isFile)
            {
                Console.Error.WriteLine($"Error: Path not found: {path}");
                Environment.ExitCode = 1;
                return;
            }

            var stopwatch = System.Diagnostics.Stopwatch.StartNew();
            int successCount = 0;
            int errorCount = 0;
            int skippedCount = 0;
            long totalBytes = 0;
            long processedBytes = 0;
            var errors = new List<(string File, string Error)>();

            // State file for smart tracking
            string stateFilePath = isDirectory
                ? Path.Combine(path, ".cfg_convert_state")
                : path + ".convert_state";
            var convertedFiles = await LoadConvertStateAsync(stateFilePath);
            var newlyConverted = new HashSet<string>();

            if (isFile)
            {
                // Single file conversion
                var result = await ConvertSingleFileAsync(game, path, convertedFiles, verbose);
                if (result.Success)
                {
                    successCount++;
                    newlyConverted.Add(path);
                }
                else if (result.Skipped) skippedCount++;
                else errorCount++;
                totalBytes = result.Bytes;
            }
            else
            {
                // Directory conversion
                var searchOption = recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
                var allFiles = Directory.EnumerateFiles(path, "*.cfg.bin", searchOption)
                    .Select(f => new FileInfo(f))
                    .OrderBy(f => f.Length) // Smallest first
                    .ToList();

                if (allFiles.Count == 0)
                {
                    Console.WriteLine("No cfg.bin files found.");
                    return;
                }

                // Filter out already converted files (smart skip)
                var filesToProcess = new List<FileInfo>();
                foreach (var f in allFiles)
                {
                    totalBytes += f.Length;
                    if (IsAlreadyConverted(f.FullName, convertedFiles))
                        skippedCount++;
                    else
                        filesToProcess.Add(f);
                }

                Console.WriteLine($"Found {allFiles.Count:N0} cfg.bin files ({totalBytes / 1024.0 / 1024.0:F2} MB)");
                if (skippedCount > 0)
                    Console.WriteLine($"Skipping {skippedCount:N0} already converted files");

                if (filesToProcess.Count == 0)
                {
                    Console.WriteLine("All files already converted!");
                    return;
                }

                Console.WriteLine($"Converting {filesToProcess.Count:N0} files ({filesToProcess.Sum(f => f.Length) / 1024.0 / 1024.0:F2} MB)");
                Console.WriteLine();

                int processed = 0;
                var lastUpdate = DateTime.MinValue;

                foreach (var fileInfo in filesToProcess)
                {
                    processed++;
                    processedBytes += fileInfo.Length;

                    // Progress update (every 100ms or every 100 files)
                    if (verbose || (DateTime.Now - lastUpdate).TotalMilliseconds > 100 || processed % 100 == 0)
                    {
                        double percent = (double)processed / filesToProcess.Count * 100;
                        string relativePath = Path.GetRelativePath(path, fileInfo.FullName);
                        if (relativePath.Length > 60)
                            relativePath = "..." + relativePath[^57..];

                        Console.Write($"\r[{processed:N0}/{filesToProcess.Count:N0}] {percent:F1}% - {relativePath,-60}");
                        lastUpdate = DateTime.Now;
                    }

                    var result = await ConvertSingleFileAsync(game, fileInfo.FullName, convertedFiles, verbose: false);

                    if (result.Success)
                    {
                        successCount++;
                        newlyConverted.Add(fileInfo.FullName);
                    }
                    else if (result.Skipped)
                        skippedCount++;
                    else
                    {
                        errorCount++;
                        errors.Add((fileInfo.FullName, result.Error ?? "Unknown error"));
                        if (verbose)
                        {
                            Console.WriteLine();
                            Console.Error.WriteLine($"  Error: {result.Error}");
                        }
                    }
                }

                Console.WriteLine(); // New line after progress

                // Update state file with newly converted files
                if (newlyConverted.Count > 0)
                {
                    foreach (var f in newlyConverted)
                        convertedFiles.Add(f);
                    await SaveConvertStateAsync(stateFilePath, convertedFiles);
                }

                // Write error log if there were errors
                if (errors.Count > 0)
                {
                    string errorLogPath = Path.Combine(path, "convert_errors.log");
                    var errorLines = errors.Select(e => $"{e.File}: {e.Error}");
                    await File.WriteAllLinesAsync(errorLogPath, errorLines);
                }
            }

            stopwatch.Stop();

            // Summary
            Console.WriteLine();
            Console.WriteLine("═══════════════════════════════════════════════════════════════");
            Console.WriteLine($"  Converted: {successCount:N0} files");
            if (skippedCount > 0)
                Console.WriteLine($"  Skipped:   {skippedCount:N0} files (already done)");
            if (errorCount > 0)
            {
                Console.WriteLine($"  Errors:    {errorCount:N0} files");
                if (isDirectory)
                    Console.WriteLine($"             See: {Path.Combine(path, "convert_errors.log")}");
            }
            Console.WriteLine($"  Total:     {totalBytes / 1024.0 / 1024.0:F2} MB");
            Console.WriteLine($"  Time:      {stopwatch.Elapsed.TotalSeconds:F1}s");
            if (stopwatch.Elapsed.TotalSeconds > 0 && processedBytes > 0)
                Console.WriteLine($"  Speed:     {processedBytes / 1024.0 / 1024.0 / stopwatch.Elapsed.TotalSeconds:F2} MB/s");
            Console.WriteLine("═══════════════════════════════════════════════════════════════");

            if (errorCount > 0)
                Environment.ExitCode = 1;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            if (verbose)
            {
                Console.Error.WriteLine(ex.StackTrace);
            }
            Environment.ExitCode = 1;
        }
    }

    private static async Task<HashSet<string>> LoadConvertStateAsync(string stateFilePath)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (File.Exists(stateFilePath))
        {
            var lines = await File.ReadAllLinesAsync(stateFilePath);
            foreach (var line in lines)
            {
                if (!string.IsNullOrWhiteSpace(line))
                    result.Add(line.Trim());
            }
        }
        return result;
    }

    private static async Task SaveConvertStateAsync(string stateFilePath, HashSet<string> convertedFiles)
    {
        await File.WriteAllLinesAsync(stateFilePath, convertedFiles.Order());
    }

    private static bool IsAlreadyConverted(string filePath, HashSet<string> convertedFiles)
    {
        // Check if in state file AND json exists
        if (!convertedFiles.Contains(filePath))
            return false;

        string jsonPath = filePath + ".json";
        if (!File.Exists(jsonPath))
            return false;

        // Verify json is newer than source
        var srcInfo = new FileInfo(filePath);
        var jsonInfo = new FileInfo(jsonPath);
        return jsonInfo.LastWriteTime >= srcInfo.LastWriteTime;
    }

    /// <summary>
    /// Marks a file entry in cpk_list.cfg.bin as loose (not in a CPK).
    /// This allows the game to load the file directly from the data/ directory.
    /// Uses the same approach as Viola CPack.
    /// </summary>
    [UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode",
        Justification = "CfgBin types are preserved by IECODE.Core")]
    public static async Task SetLooseAsync(string? gamePath, string relativePath, long fileSize, bool verbose)
    {
        try
        {
            using var game = new IEVRGame(gamePath);

            if (!game.IsValid)
            {
                Console.Error.WriteLine($"Error: Game not found at: {game.GamePath}");
                Environment.ExitCode = 1;
                return;
            }

            string cpkListPath = game.CpkListPath;
            if (!File.Exists(cpkListPath))
            {
                Console.Error.WriteLine($"Error: cpk_list.cfg.bin not found: {cpkListPath}");
                Environment.ExitCode = 1;
                return;
            }

            // Normalize path separators
            relativePath = relativePath.Replace('\\', '/');

            if (verbose)
            {
                Console.WriteLine($"cpk_list: {cpkListPath}");
                Console.WriteLine($"Setting loose: {relativePath}");
            }

            // Read and decrypt cpk_list.cfg.bin (same approach as Viola CPack)
            byte[] fileBytes = await File.ReadAllBytesAsync(cpkListPath);
            bool wasEncrypted = false;

            uint checkHeader = System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(fileBytes);
            if (checkHeader > 10000000)
            {
                wasEncrypted = true;
                if (verbose) Console.WriteLine("Decrypting cpk_list...");
                CriwareCrypt.DecryptBlock(fileBytes, 0, fileBytes.Length, 0, 0x1717E18E);
            }

            // Parse CfgBin structure
            var cpkList = new CfgBin();
            cpkList.Open(fileBytes);

            if (cpkList.Entries.Count == 0 || cpkList.Entries[0].Children == null)
            {
                Console.Error.WriteLine("Error: Invalid cpk_list structure.");
                Environment.ExitCode = 1;
                return;
            }

            var cpkItems = cpkList.Entries[0].Children;

            // Find the entry matching the relative path
            bool found = false;
            for (int i = 0; i < cpkItems.Count; i++)
            {
                var item = cpkItems[i];
                if (item.Variables.Count < 5) continue;

                string dir = (string)(item.Variables[0].Value ?? "");
                string name = (string)(item.Variables[1].Value ?? "");
                string fullPath = dir + name;

                if (fullPath.Equals(relativePath, StringComparison.OrdinalIgnoreCase))
                {
                    string oldCpk = (string)(item.Variables[3].Value ?? "");
                    bool alreadyLoose = string.IsNullOrEmpty(oldCpk);

                    if (alreadyLoose)
                    {
                        Console.WriteLine($"Already loose: {relativePath}");
                        return;
                    }

                    // Set to loose mode (clear CPK directory and name)
                    item.Variables[2].Value = ""; // CpkDirectory
                    item.Variables[3].Value = ""; // CpkName
                    if (fileSize > 0)
                    {
                        item.Variables[4].Value = (int)fileSize; // FileSize
                    }

                    Console.WriteLine($"[OK] {relativePath} (was in {oldCpk})");
                    found = true;
                    break;
                }
            }

            if (!found)
            {
                // Entry not found — add a new one using the last entry as template
                if (cpkItems.Count == 0)
                {
                    Console.Error.WriteLine("Error: cpk_list is empty, cannot add new entry.");
                    Environment.ExitCode = 1;
                    return;
                }

                var templateEntry = cpkItems[cpkItems.Count - 1];
                var newEntry = templateEntry.Clone();

                string fileName = Path.GetFileName(relativePath);
                string dirName = Path.GetDirectoryName(relativePath)?.Replace('\\', '/') ?? "";
                if (!string.IsNullOrEmpty(dirName) && !dirName.EndsWith('/')) dirName += "/";

                newEntry.Variables[0].Value = dirName;
                newEntry.Variables[1].Value = fileName;
                newEntry.Variables[2].Value = "";
                newEntry.Variables[3].Value = "";
                newEntry.Variables[4].Value = (int)fileSize;

                cpkItems.Add(newEntry);
                cpkList.Entries[0].Variables[0].Value = cpkItems.Count;

                Console.WriteLine($"[ADD] {relativePath} (new loose entry)");
            }

            // Backup original
            string bakPath = cpkListPath + ".loose_bak";
            if (!File.Exists(bakPath))
            {
                File.Copy(cpkListPath, bakPath, true);
                if (verbose) Console.WriteLine($"Backup: {bakPath}");
            }

            // Save modified cpk_list
            byte[] savedBytes = cpkList.Save();

            if (wasEncrypted)
            {
                if (verbose) Console.WriteLine("Re-encrypting cpk_list...");
                CriwareCrypt.DecryptBlock(savedBytes, 0, savedBytes.Length, 0, 0x1717E18E);
            }

            await File.WriteAllBytesAsync(cpkListPath, savedBytes);
            Console.WriteLine("cpk_list.cfg.bin updated.");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            if (verbose)
            {
                Console.Error.WriteLine(ex.StackTrace);
            }
            Environment.ExitCode = 1;
        }
    }

    /// <summary>
    /// Restores cpk_list.cfg.bin from .loose_bak backup.
    /// </summary>
    public static Task RestoreLooseAsync(string? gamePath, bool verbose)
    {
        try
        {
            using var game = new IEVRGame(gamePath);

            if (!game.IsValid)
            {
                Console.Error.WriteLine($"Error: Game not found at: {game.GamePath}");
                Environment.ExitCode = 1;
                return Task.CompletedTask;
            }

            string cpkListPath = game.CpkListPath;
            string bakPath = cpkListPath + ".loose_bak";

            if (!File.Exists(bakPath))
            {
                Console.Error.WriteLine("No backup found. Nothing to restore.");
                Environment.ExitCode = 1;
                return Task.CompletedTask;
            }

            if (File.Exists(cpkListPath))
                File.Delete(cpkListPath);
            File.Move(bakPath, cpkListPath);

            Console.WriteLine("cpk_list.cfg.bin restored from backup.");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            if (verbose) Console.Error.WriteLine(ex.StackTrace);
            Environment.ExitCode = 1;
        }
        return Task.CompletedTask;
    }

    // ── cfg decode ───────────────────────────────────────────────────────────

    /// <summary>
    /// Décode un cfg.bin (T2B ou RDBN) en arbre typé générique et l'affiche/écrit en JSON.
    /// Compatible déchiffrement automatique via le nom de fichier.
    /// </summary>
    [UnconditionalSuppressMessage("AOT", "IL2026:RequiresUnreferencedCode",
        Justification = "CfgBinDocument.Decode uses CfgBin types preserved by IECODE.Core.")]
    public static async Task DecodeGenericAsync(string file, string? output, bool json, bool verbose)
    {
        try
        {
            if (!File.Exists(file))
            {
                Console.Error.WriteLine($"Error: File not found: {file}");
                Environment.ExitCode = 1;
                return;
            }

            if (verbose)
                Console.WriteLine($"Decoding: {file}");

            var data = await File.ReadAllBytesAsync(file);
            var doc  = IECODE.Core.Formats.Level5.CfgBinDocument.Decode(data, Path.GetFileName(file));

            if (verbose)
                Console.WriteLine($"Format: {doc.Format}  Encoding: {doc.Encoding}");

            // Résumé texte (sans --json ni --output)
            if (!json && string.IsNullOrEmpty(output))
            {
                Console.WriteLine($"Format:   {doc.Format}");
                Console.WriteLine($"Encoding: {doc.Encoding}");
                if (doc.Format == "RDBN")
                {
                    Console.WriteLine($"Tables:   {doc.Tables.Count}");
                    foreach (var t in doc.Tables)
                        Console.WriteLine($"  {t.Name} ({t.Rows.Count} rows, type: {t.TypeName})");
                }
                else
                {
                    Console.WriteLine($"Records:  {doc.Records.Count}");
                    foreach (var r in doc.Records)
                        Console.WriteLine($"  {r.Name} ({r.Fields.Count} fields, {r.Children.Count} children)");
                }
                return;
            }

            var jsonStr = doc.ToJson(indented: true);

            if (!string.IsNullOrEmpty(output))
            {
                await File.WriteAllTextAsync(output, jsonStr, new System.Text.UTF8Encoding(false));
                if (verbose || !json)
                    Console.WriteLine($"Exported to: {output}");
            }
            else
            {
                Console.WriteLine(jsonStr);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            if (verbose)
                Console.Error.WriteLine(ex.StackTrace);
            Environment.ExitCode = 1;
        }
    }

    private record struct ConvertResult(bool Success, bool Skipped, long Bytes, string? Error);

    private static Task<ConvertResult> ConvertSingleFileAsync(IEVRGame game, string filePath, HashSet<string> convertedFiles, bool verbose)
    {
        try
        {
            var fileInfo = new FileInfo(filePath);
            string outputPath = filePath + ".json";

            // Skip if already converted (double-check)
            if (IsAlreadyConverted(filePath, convertedFiles))
            {
                if (verbose)
                    Console.WriteLine($"  Skipped (up to date): {Path.GetFileName(filePath)}");
                return Task.FromResult(new ConvertResult(false, true, fileInfo.Length, null));
            }

            // Use file-based export to handle very large files
            game.CfgBin.ExportToJsonFile(filePath, outputPath);

            if (verbose)
                Console.WriteLine($"  Converted: {Path.GetFileName(filePath)} -> {Path.GetFileName(outputPath)}");

            return Task.FromResult(new ConvertResult(true, false, fileInfo.Length, null));
        }
        catch (Exception ex)
        {
            return Task.FromResult(new ConvertResult(false, false, 0, ex.Message));
        }
    }
}

