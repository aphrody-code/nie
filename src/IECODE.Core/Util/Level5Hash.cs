using System.Text;

namespace IECODE.Core.Util;

/// <summary>
/// Algorithme de hash LEVEL-5 utilisé dans les identifiants IEVR.
///
/// Algo confirmé : CRC32 standard réfléchi (ISO 3309 / IEEE 802.3).
///   Polynôme : 0xEDB88320 (réfléchi de 0x04C11DB7)
///   Graine    : 0xFFFFFFFF
///   XOR final : 0xFFFFFFFF (bitwise NOT du résultat brut)
///   Encodage  : UTF-8
///
/// C'est le même CRC32 que ZIP/PKZIP/PNG — identique à
/// <c>System.IO.Hashing.Crc32.HashToUInt32</c> et à l'implémentation
/// déjà présente dans <c>IECODE.Core.Formats.Level5.CfgBin.Tools.Crc32</c>
/// (polynomial 0xEDB88320, seed 0xFFFFFFFF, résultat = ~hash).
///
/// Utilisations connues :
///   • Clés de records cfg.bin et objbin (table de clés : (uint hash, int strOffset))
///   • Hashes de noms dans les fichiers RDBN (StringHashOffset / string pairs)
///   • Certains arguments de funcLuaMenuCommand (hashes de noms d'objets, clés texte)
/// </summary>
public static class Level5Hash
{
    private const uint Polynomial = 0xEDB88320u;
    private const uint Seed = 0xFFFFFFFFu;

    private static readonly uint[] Table = BuildTable();

    private static uint[] BuildTable()
    {
        var t = new uint[256];
        for (int i = 0; i < 256; i++)
        {
            uint entry = (uint)i;
            for (int j = 0; j < 8; j++)
            {
                if ((entry & 1u) != 0)
                    entry = (entry >> 1) ^ Polynomial;
                else
                    entry >>= 1;
            }
            t[i] = entry;
        }
        return t;
    }

    /// <summary>
    /// Calcule le hash LEVEL-5 d'une chaîne encodée en UTF-8.
    /// Équivalent à CRC32(Encoding.UTF8.GetBytes(name)).
    /// </summary>
    public static uint Hash(string name)
    {
        var bytes = Encoding.UTF8.GetBytes(name);
        return Hash(bytes);
    }

    /// <summary>
    /// Calcule le hash LEVEL-5 d'une séquence d'octets.
    /// </summary>
    public static uint Hash(ReadOnlySpan<byte> data)
    {
        uint h = Seed;
        foreach (byte b in data)
            h = (h >> 8) ^ Table[(h ^ b) & 0xFF];
        return ~h;
    }

    /// <summary>
    /// Convertit un hash 32-bit en sa représentation hexadécimale LEVEL-5 (ex. "0F39B619").
    /// </summary>
    public static string ToHex(uint hash) => hash.ToString("X8");

    /// <summary>
    /// Tente de parser un hash hexadécimal LEVEL-5 (avec ou sans préfixe "0x").
    /// </summary>
    public static bool TryParseHex(string hex, out uint hash)
    {
        var s = hex.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? hex[2..] : hex;
        return uint.TryParse(s, System.Globalization.NumberStyles.HexNumber, null, out hash);
    }
}
