// Format: ADX (.adx) — CRI ADX ADPCM audio
// Source: spec publique CRI ADX + vgmstream (meta/adx_header.c, coding/adx_decoder.c).
//   En-tête big-endian : magic 0x8000, copyrightOffset (u16) -> headerSize = copyrightOffset+4,
//   la chaîne ASCII "(c)CRI" apparaît à copyrightOffset-2. EncodingType 0x02 = ADX-ADPCM standard,
//   0x03 = AHX, 0x04 = ADX exponentiel (delta). Coefficients dérivés de highpassFreq + sampleRate.
//   Boucle (version 3/4) : bloc d'en-tête étendu après le champ flags.
//
// Cette classe fournit (1) le parsing complet et vérifiable de l'en-tête (record AdxInfo),
// et (2) le décodage PCM16 du type 0x02 (ADX-ADPCM standard) par canal, fidèle à
// l'algorithme public (historique par canal, prédicteur LMS à 2 coefficients).

using System;
using System.Buffers.Binary;
using System.IO;

namespace IECODE.Core.Audio;

/// <summary>Type d'encodage d'un flux ADX (champ encodingType de l'en-tête).</summary>
public enum AdxEncodingType : byte
{
    /// <summary>ADX à coefficients fixes (type XA, 4 jeux de coefs prédéfinis, sélection par frame).
    /// Rare / encodeur seulement. Décodage non supporté (en-tête seul).</summary>
    Fixed = 0x02,

    /// <summary>ADX-ADPCM standard (coefs dérivés de la fréquence de coupure). Décodage supporté.
    /// C'est le type décodable courant (vgmstream adx.c : encoding_type 0x03 = CRI_ADX).</summary>
    Standard = 0x03,

    /// <summary>ADX exponentiel (échelle = 1&lt;&lt;(12-scale)). Décodage non supporté (en-tête seul).</summary>
    Exponential = 0x04,

    /// <summary>Type inconnu.</summary>
    Unknown = 0x00
}

/// <summary>Informations de boucle d'un ADX version 3/4 (si présentes).</summary>
public readonly record struct AdxLoopInfo(
    bool Enabled,
    int LoopStartSample,
    int LoopStartByte,
    int LoopEndSample,
    int LoopEndByte
);

/// <summary>En-tête ADX décodé.</summary>
public readonly record struct AdxInfo(
    AdxEncodingType EncodingType,
    int BlockSize,
    int BitsPerSample,
    int ChannelCount,
    int SampleRate,
    int TotalSamples,
    int HighpassFrequency,
    int Version,
    int Flags,
    int HeaderSize,
    bool HasCriCopyright,
    AdxLoopInfo Loop
)
{
    /// <summary>Vrai si le type d'encodage est décodable en PCM16 par cette classe (0x02).</summary>
    public bool IsDecodable => EncodingType == AdxEncodingType.Standard;
}

/// <summary>
/// Lecteur/décodeur ADX (CRI ADX ADPCM). Expose <see cref="IsAdx"/> (vérif du magic),
/// <see cref="Parse(ReadOnlySpan{byte})"/> (en-tête -> <see cref="AdxInfo"/>) et
/// <see cref="DecodePcm16"/> (décodage du type 0x02 en PCM16 entrelacé).
/// </summary>
public sealed class AdxDecoder
{
    /// <summary>Magic ADX (2 octets big-endian) : 0x80 0x00.</summary>
    public const ushort MAGIC = 0x8000;

    private readonly byte[] _data;

    /// <summary>En-tête décodé.</summary>
    public AdxInfo Info { get; }

    private AdxDecoder(byte[] data, AdxInfo info)
    {
        _data = data;
        Info = info;
    }

    /// <summary>Vérifie le magic ADX (0x80 0x00).</summary>
    public static bool IsAdx(ReadOnlySpan<byte> data)
        => data.Length >= 2 && BinaryPrimitives.ReadUInt16BigEndian(data) == MAGIC;

    /// <summary>Charge et parse un fichier ADX depuis le disque.</summary>
    public static AdxDecoder FromFile(string path)
    {
        var bytes = File.ReadAllBytes(path);
        var info = Parse(bytes);
        return new AdxDecoder(bytes, info);
    }

    /// <summary>Construit un décodeur à partir d'un buffer ADX complet en mémoire.</summary>
    public static AdxDecoder FromBytes(byte[] data)
    {
        var info = Parse(data);
        return new AdxDecoder(data, info);
    }

    /// <summary>
    /// Parse l'en-tête ADX (big-endian) en <see cref="AdxInfo"/>.
    /// </summary>
    /// <exception cref="InvalidDataException">Magic absent ou buffer trop court.</exception>
    public static AdxInfo Parse(ReadOnlySpan<byte> data)
    {
        if (data.Length < 0x14)
            throw new InvalidDataException($"ADX invalide : buffer trop court ({data.Length} octets)");

        if (!IsAdx(data))
            throw new InvalidDataException(
                $"ADX invalide : magic 0x{BinaryPrimitives.ReadUInt16BigEndian(data):X4} (attendu 0x{MAGIC:X4})");

        int copyrightOffset = BinaryPrimitives.ReadUInt16BigEndian(data[2..]);
        int headerSize = copyrightOffset + 4;

        var encodingType = (AdxEncodingType)data[4];
        int blockSize = data[5];
        int bitsPerSample = data[6];
        int channelCount = data[7];
        int sampleRate = (int)BinaryPrimitives.ReadUInt32BigEndian(data[8..]);
        int totalSamples = (int)BinaryPrimitives.ReadUInt32BigEndian(data[12..]);
        int highpassFreq = BinaryPrimitives.ReadUInt16BigEndian(data[16..]);
        // Version : u16 big-endian @0x12 (ex. 0x0400). Octet haut = version majeure (3/4/5),
        // octet bas = sous-drapeau (0x08/0x09 = chiffré). (vgmstream adx.c)
        int versionFull = BinaryPrimitives.ReadUInt16BigEndian(data[18..]);
        int version = versionFull >> 8;
        int flags = versionFull & 0xFF;

        // Vérifie la chaîne "(c)CRI" à copyrightOffset-2 (= 6 octets avant headerSize).
        bool hasCriCopyright = false;
        int copyrightPos = copyrightOffset - 2;
        if (copyrightPos >= 0 && copyrightPos + 6 <= data.Length)
        {
            ReadOnlySpan<byte> cri = data.Slice(copyrightPos, 6);
            hasCriCopyright = cri[0] == (byte)'(' && cri[1] == (byte)'c' && cri[2] == (byte)')'
                && cri[3] == (byte)'C' && cri[4] == (byte)'R' && cri[5] == (byte)'I';
        }

        var loop = ParseLoop(data, version, channelCount, headerSize);

        return new AdxInfo(
            encodingType,
            blockSize,
            bitsPerSample,
            channelCount,
            sampleRate,
            totalSamples,
            highpassFreq,
            version,
            flags,
            headerSize,
            hasCriCopyright,
            loop);
    }

    /// <summary>
    /// Lit le bloc de boucle des versions 3 (0x03) et 4 (0x04) si l'en-tête est assez grand.
    /// La disposition diffère légèrement : v4 réserve un padding d'historique avant le bloc.
    /// </summary>
    private static AdxLoopInfo ParseLoop(ReadOnlySpan<byte> data, int version, int channelCount, int headerSize)
    {
        // Base du bloc de boucle après le champ aux flags (offset 0x14).
        // v4 : 4 octets réservés + (4 octets d'historique par canal) avant le bloc de boucle.
        int loopBase = version switch
        {
            0x03 => 0x14,
            0x04 => 0x18 + 4 * channelCount,
            _ => -1
        };

        if (loopBase < 0)
            return default;

        // Le bloc de boucle fait 0x18 octets : alignmentSamples(u16), loopCount(u16),
        // loopType(u32)?, loopEnabled(u32), loopStartSample(u32), loopStartByte(u32),
        // loopEndSample(u32), loopEndByte(u32). On lit la forme canonique vgmstream.
        if (loopBase + 0x18 > headerSize || loopBase + 0x18 > data.Length)
            return default;

        // alignmentSamples (u16) puis loopCount (u16) ignorés ; le flag d'activation suit.
        int enabledFlag = (int)BinaryPrimitives.ReadUInt32BigEndian(data[(loopBase + 0x04)..]);
        int loopStartSample = (int)BinaryPrimitives.ReadUInt32BigEndian(data[(loopBase + 0x08)..]);
        int loopStartByte = (int)BinaryPrimitives.ReadUInt32BigEndian(data[(loopBase + 0x0C)..]);
        int loopEndSample = (int)BinaryPrimitives.ReadUInt32BigEndian(data[(loopBase + 0x10)..]);
        int loopEndByte = (int)BinaryPrimitives.ReadUInt32BigEndian(data[(loopBase + 0x14)..]);

        bool enabled = enabledFlag != 0;
        if (!enabled && loopStartSample == 0 && loopEndSample == 0)
            return default;

        return new AdxLoopInfo(enabled, loopStartSample, loopStartByte, loopEndSample, loopEndByte);
    }

    /// <summary>
    /// Calcule la paire de coefficients du prédicteur (a, b) en virgule fixe (Q12),
    /// dérivée de highpassFrequency et sampleRate selon la spec CRI publique.
    /// </summary>
    public static (int Coeff1, int Coeff2) ComputeCoefficients(int highpassFreq, int sampleRate)
    {
        if (sampleRate <= 0)
            return (0, 0);

        const double sqrt2 = 1.41421356237309504880; // sqrt(2)
        double z = Math.Cos(2.0 * Math.PI * highpassFreq / sampleRate);
        double a = sqrt2 - z;
        double b = sqrt2 - 1.0;
        double c = (a - Math.Sqrt((a + b) * (a - b))) / b;

        // Coefficients Q12 EXACTEMENT comme vgmstream adx.c : coef1 = (short)(c*8192),
        // coef2 = (short)(c*c*-4096). Le cast (short) tronque vers zéro (sémantique C).
        int coeff1 = (short)(c * 8192.0);
        int coeff2 = (short)(c * c * -4096.0);
        return (coeff1, coeff2);
    }

    /// <summary>
    /// Décode un flux ADX-ADPCM standard (type 0x02) en PCM16 entrelacé (little-endian
    /// dans le tableau retourné, échantillons par canal entrelacés L,R,L,R...).
    /// </summary>
    /// <exception cref="NotSupportedException">Type d'encodage non décodable (AHX / exponentiel).</exception>
    public short[] DecodePcm16()
    {
        if (Info.EncodingType != AdxEncodingType.Standard)
            throw new NotSupportedException(
                $"Décodage ADX non supporté pour encodingType 0x{(byte)Info.EncodingType:X2} (seul 0x02 ADX-ADPCM l'est)");

        return DecodeStandard(_data, Info);
    }

    private static short[] DecodeStandard(byte[] data, AdxInfo info)
    {
        int channels = info.ChannelCount;
        int blockSize = info.BlockSize;          // octets par bloc et par canal (souvent 18)
        int total = info.TotalSamples;
        int samplesPerBlock = (blockSize - 2) * 8 / info.BitsPerSample; // 4 bits -> 32 échantillons

        if (channels <= 0 || blockSize < 3 || samplesPerBlock <= 0)
            return Array.Empty<short>();

        var (coeff1, coeff2) = ComputeCoefficients(info.HighpassFrequency, info.SampleRate);

        var output = new short[checked(total * channels)];

        // Historique du prédicteur par canal (2 échantillons précédents).
        var hist1 = new int[channels];
        var hist2 = new int[channels];

        int offset = info.HeaderSize;
        int sampleIndex = 0; // index d'échantillon (par canal) déjà produit

        while (sampleIndex < total)
        {
            // Un "frame" = un bloc par canal, consécutifs.
            for (int ch = 0; ch < channels; ch++)
            {
                int blockStart = offset + ch * blockSize;
                if (blockStart + blockSize > data.Length)
                    return output; // flux tronqué : on retourne ce qui est décodé

                // L'échelle (scale) est un u16 big-endian en tête de bloc.
                int scaleRaw = BinaryPrimitives.ReadUInt16BigEndian(data.AsSpan(blockStart, 2));
                if (scaleRaw == 0x8001) return output;     // marqueur de fin de flux ADX
                int scale = scaleRaw + 1;                  // type standard : échelle = scale + 1 (vgmstream)

                int h1 = hist1[ch];
                int h2 = hist2[ch];

                for (int s = 0; s < samplesPerBlock; s++)
                {
                    int globalSample = sampleIndex + s;
                    if (globalSample >= total)
                        break;

                    int byteIndex = blockStart + 2 + (s >> 1);
                    int nibble;
                    if ((s & 1) == 0)
                        nibble = (data[byteIndex] >> 4) & 0x0F; // nibble haut en premier
                    else
                        nibble = data[byteIndex] & 0x0F;

                    // Nibble signé sur 4 bits (-8..7).
                    int delta = nibble >= 8 ? nibble - 16 : nibble;

                    int prediction = (coeff1 * h1 + coeff2 * h2) >> 12;
                    int sample = scale * delta + prediction;

                    // Clamp PCM16.
                    if (sample > short.MaxValue) sample = short.MaxValue;
                    else if (sample < short.MinValue) sample = short.MinValue;

                    output[globalSample * channels + ch] = (short)sample;

                    h2 = h1;
                    h1 = sample;
                }

                hist1[ch] = h1;
                hist2[ch] = h2;
            }

            offset += channels * blockSize;
            sampleIndex += samplesPerBlock;
        }

        return output;
    }

    /// <summary>Résumé lisible de l'en-tête (debug/CLI).</summary>
    public string GetSummary()
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("ADX (CRI ADX ADPCM)");
        sb.AppendLine($"  Encoding     : 0x{(byte)Info.EncodingType:X2} ({Info.EncodingType})");
        sb.AppendLine($"  BlockSize    : {Info.BlockSize}");
        sb.AppendLine($"  BitsPerSample: {Info.BitsPerSample}");
        sb.AppendLine($"  Channels     : {Info.ChannelCount}");
        sb.AppendLine($"  SampleRate   : {Info.SampleRate} Hz");
        sb.AppendLine($"  TotalSamples : {Info.TotalSamples}");
        sb.AppendLine($"  HighpassFreq : {Info.HighpassFrequency} Hz");
        sb.AppendLine($"  Version      : {Info.Version}");
        sb.AppendLine($"  Flags        : 0x{Info.Flags:X2}");
        sb.AppendLine($"  HeaderSize   : {Info.HeaderSize}");
        sb.AppendLine($"  (c)CRI       : {Info.HasCriCopyright}");
        sb.AppendLine($"  Decodable    : {Info.IsDecodable}");
        if (Info.Loop.Enabled)
            sb.AppendLine($"  Loop         : {Info.Loop.LoopStartSample}..{Info.Loop.LoopEndSample}");
        return sb.ToString();
    }
}
