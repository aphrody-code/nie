// Format: HCA (.hca) — CRI High Compression Audio
// Source: RE des blocs HCA réels extraits des AWB (data/common/sound_asset).
//   En-tête big-endian, tags masqués 0x7F : HCA / fmt / comp|dec / ciph / loop / ...
//   Validé : v3.0, mono 48 kHz, frame_count + frame_size cohérents avec la taille du bloc.
//
// Le DÉCODAGE PCM complet (MDCT inverse + bandes + ATH) est un port lourd depuis
// vgmstream/clHca. Cette classe fournit (1) le parsing d'en-tête réel et vérifiable,
// et (2) un chemin de décodage WAV via vgmstream-cli en sous-processus quand il est
// disponible (recommandation du plan). Le port C# pur du codec viendra ensuite.

using System;
using System.Buffers.Binary;
using System.Diagnostics;
using System.IO;

namespace IECODE.Core.Audio;

/// <summary>Type de chiffrement d'un flux HCA (chunk ciph).</summary>
public enum HcaCipherType
{
    None = 0,        // pas de chiffrement
    Static = 1,      // table statique
    Key = 56,        // clé 56 bits
    Unknown = -1
}

/// <summary>Métadonnées d'un en-tête HCA décodé.</summary>
public readonly record struct HcaInfo(
    int Version,
    int HeaderSize,
    int Channels,
    int SampleRate,
    int FrameCount,
    int FrameSize,
    int EncoderDelay,
    int EncoderPadding,
    HcaCipherType Cipher,
    bool HasLoop,
    int LoopStart,
    int LoopEnd
)
{
    /// <summary>Nombre total d'échantillons (1024 par frame, hors delay/padding).</summary>
    public long TotalSamples => (long)FrameCount * 1024;
    public bool IsEncrypted => Cipher is HcaCipherType.Static or HcaCipherType.Key;
}

/// <summary>
/// Décodeur HCA : parsing d'en-tête réel + décodage WAV via vgmstream (sous-processus).
/// </summary>
public static class HcaDecoder
{
    private const uint MAGIC = 0x48434100; // "HCA\0" big-endian (avant masquage)

    /// <summary>Vrai si le bloc commence par un magic HCA (avec ou sans bit de poids fort).</summary>
    public static bool IsHca(ReadOnlySpan<byte> data)
    {
        if (data.Length < 4) return false;
        Span<byte> m = stackalloc byte[4];
        for (int i = 0; i < 4; i++) m[i] = (byte)(data[i] & 0x7F);
        return m[0] == (byte)'H' && m[1] == (byte)'C' && m[2] == (byte)'A' && m[3] == 0;
    }

    private static ReadOnlySpan<byte> Tag(ReadOnlySpan<byte> data, int o, Span<byte> buf)
    {
        for (int i = 0; i < 4; i++) buf[i] = (byte)(data[o + i] & 0x7F);
        return buf;
    }

    private static bool TagIs(ReadOnlySpan<byte> data, int o, string name)
    {
        Span<byte> buf = stackalloc byte[4];
        Tag(data, o, buf);
        for (int i = 0; i < name.Length; i++) if (buf[i] != (byte)name[i]) return false;
        for (int i = name.Length; i < 4; i++) if (buf[i] != 0) return false;
        return true;
    }

    /// <summary>
    /// Parse l'en-tête HCA. Big-endian, tags masqués 0x7F.
    /// </summary>
    public static HcaInfo ParseHeader(ReadOnlySpan<byte> data)
    {
        if (!IsHca(data))
            throw new InvalidDataException("Bloc HCA invalide : magic absent");

        int version = BinaryPrimitives.ReadUInt16BigEndian(data.Slice(4, 2));
        int headerSize = BinaryPrimitives.ReadUInt16BigEndian(data.Slice(6, 2));

        int channels = 0, sampleRate = 0, frameCount = 0, frameSize = 0;
        int encDelay = 0, encPadding = 0;
        var cipher = HcaCipherType.None;
        bool hasLoop = false; int loopStart = 0, loopEnd = 0;

        int o = 8;
        while (o < headerSize - 2 && o + 4 <= data.Length)
        {
            if (TagIs(data, o, "fmt"))
            {
                channels = data[o + 4];
                sampleRate = (data[o + 5] << 16) | (data[o + 6] << 8) | data[o + 7];
                frameCount = BinaryPrimitives.ReadInt32BigEndian(data.Slice(o + 8, 4));
                encDelay = BinaryPrimitives.ReadUInt16BigEndian(data.Slice(o + 12, 2));
                encPadding = BinaryPrimitives.ReadUInt16BigEndian(data.Slice(o + 14, 2));
                o += 16;
            }
            else if (TagIs(data, o, "comp"))
            {
                frameSize = BinaryPrimitives.ReadUInt16BigEndian(data.Slice(o + 4, 2));
                o += 16;
            }
            else if (TagIs(data, o, "dec"))
            {
                frameSize = BinaryPrimitives.ReadUInt16BigEndian(data.Slice(o + 4, 2));
                o += 12;
            }
            else if (TagIs(data, o, "vbr")) { o += 8; } // vbr = tag + max_frame_size u16 + noise_level u16 (vgmstream clhca.c)
            else if (TagIs(data, o, "ath")) { o += 6; }
            else if (TagIs(data, o, "loop"))
            {
                hasLoop = true;
                loopStart = BinaryPrimitives.ReadInt32BigEndian(data.Slice(o + 4, 4));
                loopEnd = BinaryPrimitives.ReadInt32BigEndian(data.Slice(o + 8, 4));
                o += 16;
            }
            else if (TagIs(data, o, "ciph"))
            {
                int ct = BinaryPrimitives.ReadUInt16BigEndian(data.Slice(o + 4, 2));
                cipher = ct switch { 0 => HcaCipherType.None, 1 => HcaCipherType.Static, 56 => HcaCipherType.Key, _ => HcaCipherType.Unknown };
                o += 6;
            }
            else if (TagIs(data, o, "rva")) { o += 8; }
            else if (TagIs(data, o, "comm")) { o += 5 + data[o + 4]; }
            else if (TagIs(data, o, "pad")) { break; }
            else { break; }
        }

        return new HcaInfo(version, headerSize, channels, sampleRate, frameCount,
            frameSize, encDelay, encPadding, cipher, hasLoop, loopStart, loopEnd);
    }

    /// <summary>Vrai si vgmstream-cli est disponible dans le PATH.</summary>
    public static bool VgmstreamAvailable(out string? path)
    {
        path = null;
        foreach (var exe in new[] { "vgmstream-cli", "vgmstream123", "test.exe" })
        {
            try
            {
                using var p = Process.Start(new ProcessStartInfo
                {
                    FileName = exe,
                    Arguments = "-V",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false
                });
                if (p is null) continue;
                p.WaitForExit(5000);
                path = exe;
                return true;
            }
            catch { /* binaire absent */ }
        }
        return false;
    }

    /// <summary>
    /// Décode un fichier HCA en WAV via vgmstream-cli (si disponible).
    /// Retourne true en cas de succès. Aucune dépendance native requise pour l'échec.
    /// </summary>
    public static bool DecodeToWavViaVgmstream(string hcaPath, string wavPath)
    {
        if (!VgmstreamAvailable(out var exe) || exe is null)
            return false;
        try
        {
            using var p = Process.Start(new ProcessStartInfo
            {
                FileName = exe,
                Arguments = $"-o \"{wavPath}\" \"{hcaPath}\"",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            });
            if (p is null) return false;
            p.WaitForExit(60000);
            return p.ExitCode == 0 && File.Exists(wavPath);
        }
        catch { return false; }
    }
}
