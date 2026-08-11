using System.CommandLine;
using IECODE.Core.Native;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande pour benchmarker les performances de décryptage.
/// </summary>
public static class BenchmarkCommand
{
    public static Command Create()
    {
        var sizeOption = new Option<int>("--size", () => 10, "Data size in MB");
        var iterationsOption = new Option<int>("--iterations", () => 5, "Number of iterations");

        var command = new Command("benchmark", "Benchmark decryption performance")
        {
            sizeOption,
            iterationsOption
        };

        command.SetHandler((size, iterations) =>
        {
            Console.WriteLine("╔══════════════════════════════════════════════════════════════════╗");
            Console.WriteLine("║           IECODE - Crypto Benchmark (NativeCrypto)               ║");
            Console.WriteLine("╚══════════════════════════════════════════════════════════════════╝");
            Console.WriteLine();

            // Afficher les capacités CPU
            var caps = CryptoBenchmark.GetCapabilities();
            Console.WriteLine($"  CPU SIMD Support: {caps}");
            Console.WriteLine();

            // Benchmark bloc CRI
            Console.WriteLine("  [1] CRI Block Decryption (CPK files)...");
            var blockResult = CryptoBenchmark.RunDecryptBenchmark(size, iterations);
            Console.WriteLine($"      Data: {blockResult.DataSizeMB} MB x {blockResult.Iterations} iterations");
            Console.WriteLine($"      Time: {blockResult.TotalTimeMs:F2} ms");
            Console.WriteLine($"      Throughput: {blockResult.ThroughputMBps:F2} MB/s");
            Console.WriteLine();

            // Benchmark table UTF
            Console.WriteLine("  [2] UTF Table Decryption (metadata)...");
            var tableResult = CryptoBenchmark.RunTableDecryptBenchmark(Math.Min(size, 2), iterations * 2);
            Console.WriteLine($"      Data: {tableResult.DataSizeMB} MB x {tableResult.Iterations} iterations");
            Console.WriteLine($"      Time: {tableResult.TotalTimeMs:F2} ms");
            Console.WriteLine($"      Throughput: {tableResult.ThroughputMBps:F2} MB/s");
            Console.WriteLine();

            // Key calculation benchmark
            Console.WriteLine("  [3] Key Calculation (CRC32)...");
            var sw = System.Diagnostics.Stopwatch.StartNew();
            for (int i = 0; i < 100000; i++)
            {
                NativeCrypto.CalculateKeyFromFilename("003468ca3af3d748aa79a5ef06ba38a6.cpk");
            }
            sw.Stop();
            Console.WriteLine($"      100,000 keys: {sw.Elapsed.TotalMilliseconds:F2} ms");
            Console.WriteLine($"      Rate: {100000 / sw.Elapsed.TotalSeconds:F0} keys/s");
            Console.WriteLine();

            Console.WriteLine("  Benchmark complete!");
        }, sizeOption, iterationsOption);

        return command;
    }
}
