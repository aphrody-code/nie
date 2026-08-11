using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.Text;
using IECODE.Core.Formats.Criware.CriFs.Encryption;

namespace IECODE.Core.Formats.Criware;

/// <summary>
/// Métadonnées d'un flux vidéo USM (issues de VIDEO_HDRINFO).
/// </summary>
public sealed class UsmVideoInfo
{
    public int Width;
    public int Height;
    public int DisplayWidth;
    public int DisplayHeight;
    public int TotalFrames;
    public int FramerateN;
    public int FramerateD;
    public string Codec = "H.264"; // mpeg_codec : 5 = H.264, 1 = MPEG-1, 2 = MPEG-2
    public int AlphaType;
    public double FramerateHz => FramerateD > 0 ? (double)FramerateN / FramerateD : 0;
    public double DurationSeconds => FramerateHz > 0 ? TotalFrames / FramerateHz : 0;
}

/// <summary>
/// Métadonnées d'un flux audio USM (issues de AUDIO_HDRINFO).
/// </summary>
public sealed class UsmAudioInfo
{
    public int SampleRate;
    public int Channels;
    public int TotalSamples;
    public string Codec = "HCA"; // audio_codec : 2 = HCA, 4 = HCA-MX
}

/// <summary>
/// Informations agrégées d'un fichier USM (CRIUSF_DIR_STREAM + HDRINFO).
/// </summary>
public sealed class UsmInfo
{
    public string? Filename;
    public long FileSize;
    public long DataSize;
    public bool Encrypted;
    public UsmVideoInfo? Video;
    public UsmAudioInfo? Audio;
    public bool HasSubtitles;
    public bool HasAlpha;
    public Dictionary<uint, (int chunks, long bytes)> Streams = new();
}

/// <summary>
/// Démuxeur / lecteur USM (CRI Sofdec2). Gère :
///  - le déchiffrement transparent (les USM « loose » du dépôt IEVR sont chiffrés
///    au niveau fichier avec une clé dérivée de leur basename, comme les CPK) ;
///  - l'extraction des flux @SFV (H.264 Annex B) / @SFA (HCA) / @ALP / @SBT ;
///  - la lecture des métadonnées via les tables @UTF du chunk CRID.
/// </summary>
public class UsmDemuxer
{
    private const uint CRID_MAGIC = 0x43524944; // CRID
    private const uint SFV_MAGIC = 0x40534656;  // @SFV
    private const uint SFA_MAGIC = 0x40534641;  // @SFA
    private const uint ALP_MAGIC = 0x40414C50;  // @ALP
    private const uint SBT_MAGIC = 0x40534254;  // @SBT
    private const uint CUE_MAGIC = 0x40435545;  // @CUE
    private const uint UTF_MAGIC = 0x40555446;  // @UTF

    /// <summary>
    /// Charge un USM en mémoire en le déchiffrant si nécessaire. Renvoie le buffer
    /// en clair (magic CRID) et indique s'il a fallu déchiffrer.
    /// </summary>
    public static byte[] LoadDecrypted(string inputPath, out bool wasEncrypted)
    {
        var data = File.ReadAllBytes(inputPath);
        wasEncrypted = false;

        if (data.Length >= 4 && BinaryPrimitives.ReadUInt32BigEndian(data) == CRID_MAGIC)
            return data; // déjà en clair

        // Tentative de déchiffrement avec la clé dérivée du basename (cas dépôt IEVR).
        uint key = CriwareCrypt.CalculateKeyFromFilename(Path.GetFileName(inputPath));
        CriwareCrypt.DecryptBlock(data, 0, key);
        if (data.Length >= 4 && BinaryPrimitives.ReadUInt32BigEndian(data) == CRID_MAGIC)
        {
            wasEncrypted = true;
            return data;
        }

        throw new InvalidDataException(
            "Fichier USM invalide (signature CRID absente, même après déchiffrement par basename)");
    }

    /// <summary>
    /// Lit les métadonnées d'un USM (résolution, codec, durée, flux) sans extraire
    /// les flux. S'appuie sur les tables @UTF embarquées dans le chunk CRID.
    /// </summary>
    public static UsmInfo GetInfo(string inputPath)
    {
        var data = LoadDecrypted(inputPath, out bool wasEncrypted);
        var info = new UsmInfo { Encrypted = wasEncrypted };

        // Parcours des chunks pour le comptage des flux + collecte des tables @UTF.
        int pos = 0;
        while (pos + 8 <= data.Length)
        {
            uint sig = BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(pos, 4));
            int size = BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(pos + 4, 4));
            if (size < 0 || pos + 8 + size > data.Length) break;

            var payload = data.AsSpan(pos + 8, size);

            if (!info.Streams.TryGetValue(sig, out var s)) s = (0, 0);
            info.Streams[sig] = (s.chunks + 1, s.bytes + size);

            if (sig == SFV_MAGIC && info.Video == null) ParseUtfInPayload(payload, info);
            else if (sig == SFA_MAGIC && info.Audio == null) ParseUtfInPayload(payload, info);
            else if (sig == CRID_MAGIC) ParseUtfInPayload(payload, info);
            else if (sig == ALP_MAGIC) info.HasAlpha = true;
            else if (sig == SBT_MAGIC) info.HasSubtitles = true;

            pos += 8 + size;
        }

        return info;
    }

    /// <summary>
    /// Recherche une table @UTF dans le payload d'un chunk (après l'en-tête de 0x18)
    /// et alimente <paramref name="info"/> selon la table trouvée.
    /// </summary>
    private static void ParseUtfInPayload(ReadOnlySpan<byte> payload, UsmInfo info)
    {
        // L'en-tête de chunk fait 0x18 octets ; le @UTF (si présent) suit.
        int utfStart = -1;
        for (int o = 0; o + 4 <= Math.Min(payload.Length, 0x40); o++)
        {
            if (BinaryPrimitives.ReadUInt32BigEndian(payload.Slice(o, 4)) == UTF_MAGIC)
            {
                utfStart = o;
                break;
            }
        }
        if (utfStart < 0) return;

        UtfTable table;
        try { table = new UtfTable(payload.Slice(utfStart).ToArray(), 0); }
        catch { return; }

        // Identification de la table par ses colonnes-signatures (pas de nom de table
        // exposé par l'API UtfTable courante).
        if (table.HasColumn("filename") && table.HasColumn("filesize"))
        {
            for (int r = 0; r < table.RowCount; r++)
            {
                var fn = table.GetString(r, "filename");
                if (!string.IsNullOrEmpty(fn) && fn.EndsWith(".usm", StringComparison.OrdinalIgnoreCase))
                {
                    info.Filename = fn;
                    info.FileSize = table.GetLong(r, "filesize");
                    info.DataSize = table.GetLong(r, "datasize");
                }
            }
        }
        else if (table.HasColumn("width") && table.HasColumn("framerate_n"))
        {
            info.Video = new UsmVideoInfo
            {
                Width = table.GetInt(0, "width"),
                Height = table.GetInt(0, "height"),
                DisplayWidth = table.HasColumn("disp_width") ? table.GetInt(0, "disp_width") : table.GetInt(0, "width"),
                DisplayHeight = table.HasColumn("disp_height") ? table.GetInt(0, "disp_height") : table.GetInt(0, "height"),
                TotalFrames = table.GetInt(0, "total_frames"),
                FramerateN = table.GetInt(0, "framerate_n"),
                FramerateD = table.GetInt(0, "framerate_d"),
                AlphaType = table.HasColumn("alpha_type") ? table.GetInt(0, "alpha_type") : 0,
                Codec = CodecName(table.HasColumn("mpeg_codec") ? table.GetInt(0, "mpeg_codec") : 5),
            };
        }
        else if (table.HasColumn("sampling_rate") && table.HasColumn("num_channels"))
        {
            info.Audio = new UsmAudioInfo
            {
                SampleRate = table.GetInt(0, "sampling_rate"),
                Channels = table.GetInt(0, "num_channels"),
                TotalSamples = table.HasColumn("total_samples") ? table.GetInt(0, "total_samples") : 0,
                Codec = (table.HasColumn("audio_codec") ? table.GetInt(0, "audio_codec") : 2) == 4 ? "HCA-MX" : "HCA",
            };
        }
    }

    private static string CodecName(int mpegCodec) => mpegCodec switch
    {
        1 => "MPEG-1",
        2 => "MPEG-2",
        5 => "H.264",
        9 => "VP9",
        _ => $"codec#{mpegCodec}",
    };

    /// <summary>
    /// Démuxe un USM vers <paramref name="outputDir"/>. Renvoie le chemin de chaque
    /// flux écrit. Gère le déchiffrement transparent et le strip de l'en-tête 0x18.
    /// </summary>
    public static Dictionary<uint, string> Demux(string inputPath, string outputDir)
    {
        Directory.CreateDirectory(outputDir);
        var data = LoadDecrypted(inputPath, out _);

        var streams = new Dictionary<uint, FileStream>();
        var paths = new Dictionary<uint, string>();
        try
        {
            int pos = 0;
            while (pos + 8 <= data.Length)
            {
                uint signature = BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(pos, 4));
                int size = BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(pos + 4, 4));
                if (size < 0 || pos + 8 + size > data.Length)
                {
                    Console.WriteLine($"Warning: Invalid chunk size {size} at {pos}");
                    break;
                }

                var payload = data.AsSpan(pos + 8, size);
                pos += 8 + size;

                if (signature == CRID_MAGIC) continue; // table de tête : pas un flux média

                // Ignorer les chunks de métadonnées par flux (@UTF embarqué / #HEADER END).
                if (IsMetadataChunk(payload)) continue;

                // Données média : strip de l'en-tête 0x18.
                ReadOnlySpan<byte> media =
                    (signature == SFV_MAGIC || signature == SFA_MAGIC || signature == ALP_MAGIC)
                    && payload.Length > 0x18
                        ? payload.Slice(0x18)
                        : payload;

                if (!streams.ContainsKey(signature))
                {
                    // Extension déterminée par sniffing du premier payload réel
                    // (les @SFV IEVR sont en réalité du MPEG-1, pas du H.264).
                    string ext = signature switch
                    {
                        SFV_MAGIC => SniffVideoExt(media),
                        SFA_MAGIC => SniffAudioExt(media),
                        ALP_MAGIC => "alp",
                        SBT_MAGIC => "sbt",
                        CUE_MAGIC => "cue",
                        _ => "bin",
                    };
                    string filename = $"{Path.GetFileNameWithoutExtension(inputPath)}_{signature:X}.{ext}";
                    string path = Path.Combine(outputDir, filename);
                    streams[signature] = File.Create(path);
                    paths[signature] = path;
                }

                streams[signature].Write(media);
            }
        }
        finally
        {
            foreach (var stream in streams.Values) stream.Dispose();
        }

        return paths;
    }

    /// <summary>Devine l'extension vidéo d'après les premiers octets du flux élémentaire.</summary>
    private static string SniffVideoExt(ReadOnlySpan<byte> media)
    {
        if (media.Length >= 4)
        {
            uint w = BinaryPrimitives.ReadUInt32BigEndian(media);
            // MPEG-1/2 sequence_header_code = 0x000001B3, ou GOP 0x000001B8.
            if (w == 0x000001B3 || w == 0x000001B8) return "m1v";
            // H.264 Annex-B : start code 0x00000001 / 0x000001 puis NAL.
            if (w == 0x00000001 || (w >> 8) == 0x000001) return "h264";
        }
        return "m1v";
    }

    /// <summary>Devine l'extension audio d'après le magic du flux élémentaire.</summary>
    private static string SniffAudioExt(ReadOnlySpan<byte> media)
    {
        if (media.Length >= 4)
        {
            // "HCA\0" (ou avec bit de poids fort masqué dans certaines variantes).
            uint m = BinaryPrimitives.ReadUInt32BigEndian(media) & 0x7F7F7F7F;
            if (m == 0x48434100) return "hca"; // 'H''C''A'\0
            if ((m >> 8) == 0x414458) return "adx"; // ADX (rare)
        }
        return "hca";
    }

    private static bool IsMetadataChunk(ReadOnlySpan<byte> payload)
    {
        // Les chunks de métadonnées Sofdec2 portent, après l'en-tête de 0x18 octets,
        // soit une table @UTF (chunk d'en-tête de flux), soit un marqueur ASCII
        // « #HEADER END », « #METADATA END », « #CONTENTS END », « #SEEK INFO »...
        if (payload.Length < 0x1C) return false;

        if (BinaryPrimitives.ReadUInt32BigEndian(payload.Slice(0x18, 4)) == UTF_MAGIC)
            return true;

        // Marqueur ASCII : présent soit en tête de payload, soit après l'en-tête 0x18.
        foreach (int off in stackalloc int[] { 0, 0x18 })
        {
            if (payload.Length < off + 1) continue;
            int n = Math.Min(payload.Length - off, 16);
            if (payload[off] == (byte)'#')
            {
                string start = Encoding.ASCII.GetString(payload.Slice(off, n));
                if (start.Contains("#HEADER") || start.Contains("#METADATA") ||
                    start.Contains("#CONTENTS") || start.Contains("#SEEK"))
                    return true;
            }
        }
        return false;
    }
}
