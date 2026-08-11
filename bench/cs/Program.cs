// Harnais C# du banc d'essai inter-langages.
//
// Protocole identique aux harnais Rust / C++ / TypeScript : même générateur xorshift64*,
// même graine, 3 tours de chauffe, 7 mesures, médiane. La chauffe compte double ici : elle
// laisse le JIT atteindre son palier (tiered compilation + PGO).

using System.Diagnostics;
using IECODE.Core.Crypto;
using IECODE.Core.Formats.Criware.CriFs.Compression;

namespace Nie.Bench;

internal static class Program
{
    private const ulong Seed = 0x2545F4914F6CDD1DUL;
    private const int Warmup = 3;
    private const int Runs = 7;

    private static void FillXorshift(byte[] buf)
    {
        ulong x = Seed;
        for (int i = 0; i < buf.Length; i += 8)
        {
            x ^= x >> 12;
            x ^= x << 25;
            x ^= x >> 27;
            ulong v = x * 0x2545F4914F6CDD1DUL;
            int n = Math.Min(8, buf.Length - i);
            for (int k = 0; k < n; k++)
            {
                buf[i + k] = (byte)(v >> (8 * k));
            }
        }
    }

    private static double Median(List<double> v)
    {
        v.Sort();
        return v[v.Count / 2];
    }

    private static int BenchCrc32(int mib)
    {
        byte[] buf = new byte[mib * 1024 * 1024];
        FillXorshift(buf);

        for (int i = 0; i < Warmup; i++)
        {
            _ = Crc32.Compute(buf);
        }

        var times = new List<double>(Runs);
        uint last = 0;
        for (int i = 0; i < Runs; i++)
        {
            long t = Stopwatch.GetTimestamp();
            last = Crc32.Compute(buf);
            times.Add(Stopwatch.GetElapsedTime(t).TotalSeconds);
        }
        double s = Median(times);
        Console.WriteLine(
            $"lang=csharp bench=crc32 mib={mib} median_ms={s * 1000.0:F3} " +
            $"mib_s={mib / s:F1} checksum=0x{last:x8}");
        return 0;
    }

    private static unsafe int BenchCrilayla(string path, int iters)
    {
        if (!File.Exists(path))
        {
            Console.Error.WriteLine($"échantillon absent : {path}");
            return 1;
        }
        byte[] data = File.ReadAllBytes(path);

        int outLen = 0;
        fixed (byte* p = data)
        {
            for (int i = 0; i < Warmup; i++)
            {
                outLen = CriLayla.DecompressToArray(p).Length;
            }

            var times = new List<double>(Runs);
            for (int i = 0; i < Runs; i++)
            {
                long t = Stopwatch.GetTimestamp();
                for (int k = 0; k < iters; k++)
                {
                    outLen = CriLayla.DecompressToArray(p).Length;
                }
                times.Add(Stopwatch.GetElapsedTime(t).TotalSeconds);
            }
            double s = Median(times);
            double mib = (double)outLen * iters / (1024.0 * 1024.0);
            Console.WriteLine(
                $"lang=csharp bench=crilayla in={data.Length} out={outLen} iters={iters} " +
                $"median_ms={s * 1000.0:F3} mib_s={mib / s:F1}");
        }
        return 0;
    }

    private static int Main(string[] args)
    {
        string cmd = args.Length > 0 ? args[0] : "crc32";
        switch (cmd)
        {
            case "crc32":
                return BenchCrc32(args.Length > 1 ? int.Parse(args[1]) : 64);
            case "crilayla":
                return BenchCrilayla(
                    args.Length > 1 ? args[1] : "bench/data/sample.crilayla",
                    args.Length > 2 ? int.Parse(args[2]) : 500);
            default:
                Console.Error.WriteLine("usage: nie-bench-cs [crc32 <mib> | crilayla <blob> <iters>]");
                return 2;
        }
    }
}
