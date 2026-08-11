using System;
using System.Buffers.Binary;
using IECODE.Core.Audio;
using Xunit;

namespace IECODE.Core.Tests;

/// <summary>
/// Tests du décodeur ADX (CRI ADX ADPCM) contre des buffers synthétiques big-endian
/// fabriqués à la main (aucun fichier de jeu réel disponible sur cette machine).
/// </summary>
public class AdxDecoderTests
{
    /// <summary>
    /// Construit un en-tête ADX standard (type 0x02) avec un copyrightOffset menant
    /// à une chaîne "(c)CRI", suivi de <paramref name="blocks"/> octets de données.
    /// </summary>
    private static byte[] BuildAdx(
        byte encoding,
        byte blockSize,
        byte bitsPerSample,
        byte channels,
        uint sampleRate,
        uint totalSamples,
        ushort highpass,
        byte version,
        byte flags,
        byte[]? blocks = null)
    {
        // copyrightOffset doit placer "(c)CRI" (à copyrightOffset-2) APRÈS les champs
        // highpass(0x10), version(0x12) et flags(0x13) — sinon la chaîne les écrase
        // (subtilité réelle du format : un en-tête minimal 0x12 clobbe ces octets).
        // copyrightOffset = 0x16 => "(c)CRI" à 0x14..0x19, headerSize = 0x1a.
        const ushort copyrightOffset = 0x16;
        int headerSize = copyrightOffset + 4; // 0x1a
        blocks ??= Array.Empty<byte>();

        var buf = new byte[headerSize + blocks.Length];
        BinaryPrimitives.WriteUInt16BigEndian(buf.AsSpan(0), 0x8000);
        BinaryPrimitives.WriteUInt16BigEndian(buf.AsSpan(2), copyrightOffset);
        buf[4] = encoding;
        buf[5] = blockSize;
        buf[6] = bitsPerSample;
        buf[7] = channels;
        BinaryPrimitives.WriteUInt32BigEndian(buf.AsSpan(8), sampleRate);
        BinaryPrimitives.WriteUInt32BigEndian(buf.AsSpan(12), totalSamples);
        BinaryPrimitives.WriteUInt16BigEndian(buf.AsSpan(16), highpass);
        buf[18] = version;
        buf[19] = flags;

        // "(c)CRI" à copyrightOffset-2 = 0x10.
        ReadOnlySpan<byte> cri = "(c)CRI"u8;
        cri.CopyTo(buf.AsSpan(copyrightOffset - 2));

        blocks.CopyTo(buf, headerSize);
        return buf;
    }

    [Fact]
    public void IsAdx_AcceptsMagic_RejectsOther()
    {
        Assert.True(AdxDecoder.IsAdx(new byte[] { 0x80, 0x00, 0x12, 0x00 }));
        Assert.False(AdxDecoder.IsAdx(new byte[] { 0x80, 0x01 }));
        Assert.False(AdxDecoder.IsAdx(new byte[] { 0x00, 0x80 }));
        Assert.False(AdxDecoder.IsAdx(new byte[] { 0x80 })); // trop court
    }

    [Fact]
    public void Parse_ReadsHeaderFields()
    {
        var adx = BuildAdx(
            encoding: 0x03,
            blockSize: 18,
            bitsPerSample: 4,
            channels: 2,
            sampleRate: 48000,
            totalSamples: 12345,
            highpass: 500,
            version: 3,
            flags: 0x00);

        var info = AdxDecoder.Parse(adx);

        Assert.Equal(AdxEncodingType.Standard, info.EncodingType);
        Assert.Equal(18, info.BlockSize);
        Assert.Equal(4, info.BitsPerSample);
        Assert.Equal(2, info.ChannelCount);
        Assert.Equal(48000, info.SampleRate);
        Assert.Equal(12345, info.TotalSamples);
        Assert.Equal(500, info.HighpassFrequency);
        Assert.Equal(3, info.Version);
        Assert.Equal(0x1a, info.HeaderSize);
        Assert.True(info.HasCriCopyright);
        Assert.True(info.IsDecodable);
    }

    [Fact]
    public void Parse_RejectsBadMagic()
    {
        var bad = new byte[0x20];
        bad[0] = 0x12; // pas 0x80
        Assert.Throws<System.IO.InvalidDataException>(() => AdxDecoder.Parse(bad));
    }

    [Fact]
    public void Parse_DetectsNonDecodableEncodingTypes()
    {
        var fixedAdx = BuildAdx(0x02, 18, 4, 1, 44100, 100, 0, 4, 0);
        var infoFixed = AdxDecoder.Parse(fixedAdx);
        Assert.Equal(AdxEncodingType.Fixed, infoFixed.EncodingType);
        Assert.False(infoFixed.IsDecodable);

        var exp = BuildAdx(0x04, 18, 4, 1, 44100, 100, 0, 4, 0);
        var infoExp = AdxDecoder.Parse(exp);
        Assert.Equal(AdxEncodingType.Exponential, infoExp.EncodingType);
        Assert.False(infoExp.IsDecodable);
    }

    [Fact]
    public void DecodePcm16_ThrowsOnNonStandard()
    {
        // Type exponentiel (0x04) : non décodable -> NotSupportedException.
        var exp = BuildAdx(0x04, 18, 4, 1, 44100, 32, 0, 4, 0,
            blocks: new byte[18]);
        var dec = AdxDecoder.FromBytes(exp);
        Assert.Throws<NotSupportedException>(() => dec.DecodePcm16());
    }

    [Fact]
    public void DecodePcm16_MonoStandard_ProducesExpectedSamples()
    {
        // 1 canal, blockSize 18 => 32 échantillons par bloc, 4 bits/échantillon.
        // scale brut = 1 ; type standard => échelle effective = scale + 1 = 2 (vgmstream).
        // premier nibble = 1 (delta +1).
        var block = new byte[18];
        // scale (u16 BE) = 1
        block[0] = 0x00;
        block[1] = 0x01;
        // premier octet de données : nibble haut = 1 (premier échantillon), bas = 0.
        block[2] = 0x10;

        var adx = BuildAdx(
            encoding: 0x03,
            blockSize: 18,
            bitsPerSample: 4,
            channels: 1,
            sampleRate: 48000,
            totalSamples: 4, // on ne décode que les premiers échantillons
            highpass: 0,
            version: 3,
            flags: 0,
            blocks: block);

        var dec = AdxDecoder.FromBytes(adx);
        Assert.True(dec.Info.IsDecodable);

        var pcm = dec.DecodePcm16();
        Assert.Equal(4, pcm.Length); // 4 échantillons mono

        // Premier échantillon : prediction = 0 (historique nul), scale(2)*delta(1) = 2.
        Assert.Equal(2, pcm[0]);
        // Deuxième échantillon : nibble bas = 0 -> delta 0. highpass=0 => coeff1=8192,
        // coeff2=-4096. prediction = (8192*hist1(2) + (-4096)*hist2(0)) >> 12 = 16384>>12 = 4.
        Assert.Equal(4, pcm[1]);
    }

    [Fact]
    public void ComputeCoefficients_ZeroHighpass_GivesPositiveCoeff1()
    {
        var (c1, c2) = AdxDecoder.ComputeCoefficients(0, 48000);
        // highpass 0 => z = cos(0) = 1 ; coeff1 doit être positif et proche de 8192 (Q12 ~ 2.0).
        Assert.True(c1 > 0);
        Assert.True(c2 <= 0);
    }
}
