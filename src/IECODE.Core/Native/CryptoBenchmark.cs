using System.Diagnostics;
using System.Runtime.Intrinsics.X86;

namespace IECODE.Core.Native;

/// <summary>
/// Benchmark utilities for NativeCrypto performance testing.
/// </summary>
public static class CryptoBenchmark
{
    /// <summary>
    /// Gets information about available SIMD optimizations.
    /// </summary>
    public static CryptoCapabilities GetCapabilities() => new()
    {
        HasAvx2 = Avx2.IsSupported,
        HasSse2 = Sse2.IsSupported,
        HasAvx = Avx.IsSupported,
        HasAesNi = System.Runtime.Intrinsics.X86.Aes.IsSupported
    };

    /// <summary>
    /// Benchmarks decryption speed.
    /// </summary>
    /// <param name="dataSizeMB">Size of test data in MB</param>
    /// <param name="iterations">Number of iterations</param>
    /// <returns>Benchmark results</returns>
    public static BenchmarkResult RunDecryptBenchmark(int dataSizeMB = 10, int iterations = 5)
    {
        int dataSize = dataSizeMB * 1024 * 1024;
        byte[] data = new byte[dataSize];
        Random.Shared.NextBytes(data);

        uint key = NativeCrypto.IEVRCriKey;

        // Warmup
        NativeCrypto.DecryptBlock(data.AsSpan(), 0, key);
        NativeCrypto.DecryptBlock(data.AsSpan(), 0, key); // Decrypt back

        var sw = Stopwatch.StartNew();

        for (int i = 0; i < iterations; i++)
        {
            NativeCrypto.DecryptBlock(data.AsSpan(), 0, key);
        }

        sw.Stop();

        double totalMB = (double)dataSize * iterations / (1024 * 1024);
        double seconds = sw.Elapsed.TotalSeconds;
        double throughputMBps = totalMB / seconds;

        return new BenchmarkResult
        {
            DataSizeMB = dataSizeMB,
            Iterations = iterations,
            TotalTimeMs = sw.Elapsed.TotalMilliseconds,
            ThroughputMBps = throughputMBps,
            Capabilities = GetCapabilities()
        };
    }

    /// <summary>
    /// Benchmarks table decryption speed (UTF tables).
    /// </summary>
    public static BenchmarkResult RunTableDecryptBenchmark(int dataSizeMB = 2, int iterations = 10)
    {
        int dataSize = dataSizeMB * 1024 * 1024;
        byte[] data = new byte[dataSize];
        Random.Shared.NextBytes(data);

        // Warmup
        NativeCrypto.DecryptTableInPlace(data.AsSpan());
        NativeCrypto.DecryptTableInPlace(data.AsSpan()); // Decrypt back

        var sw = Stopwatch.StartNew();

        for (int i = 0; i < iterations; i++)
        {
            NativeCrypto.DecryptTableInPlace(data.AsSpan());
        }

        sw.Stop();

        double totalMB = (double)dataSize * iterations / (1024 * 1024);
        double seconds = sw.Elapsed.TotalSeconds;
        double throughputMBps = totalMB / seconds;

        return new BenchmarkResult
        {
            DataSizeMB = dataSizeMB,
            Iterations = iterations,
            TotalTimeMs = sw.Elapsed.TotalMilliseconds,
            ThroughputMBps = throughputMBps,
            Capabilities = GetCapabilities()
        };
    }
}

/// <summary>
/// CPU SIMD capabilities.
/// </summary>
public record CryptoCapabilities
{
    public bool HasAvx2 { get; init; }
    public bool HasSse2 { get; init; }
    public bool HasAvx { get; init; }
    public bool HasAesNi { get; init; }

    public override string ToString()
    {
        var features = new List<string>();
        if (HasAvx2) features.Add("AVX2");
        if (HasAvx) features.Add("AVX");
        if (HasSse2) features.Add("SSE2");
        if (HasAesNi) features.Add("AES-NI");
        return features.Count > 0 ? string.Join(", ", features) : "None";
    }
}

/// <summary>
/// Benchmark result.
/// </summary>
public record BenchmarkResult
{
    public int DataSizeMB { get; init; }
    public int Iterations { get; init; }
    public double TotalTimeMs { get; init; }
    public double ThroughputMBps { get; init; }
    public CryptoCapabilities Capabilities { get; init; } = new();

    public override string ToString() =>
        $"Data: {DataSizeMB} MB x {Iterations} iterations\n" +
        $"Time: {TotalTimeMs:F2} ms\n" +
        $"Throughput: {ThroughputMBps:F2} MB/s\n" +
        $"SIMD: {Capabilities}";
}
