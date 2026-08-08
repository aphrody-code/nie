using IECODE.Core.Native;
// Flux de déchiffrement CPK canonique (déchiffrement complet basé sur l'offset) — partagé
// avec CpkService. Remplace l'ancien CpkDecryptionStream interne (buggé : en-tête seul).
using IECODE.Core.Formats.Criware.CriFs.Encryption;

namespace IECODE.Core.Crypto;

/// <summary>
/// Service de cryptographie pour les fichiers CRI Middleware.
/// Gère le décryptage/chiffrement des CPK, AWB, ACB et cfg.bin.
/// Utilise NativeCrypto optimisé avec SIMD.
/// </summary>
public sealed class CriCryptoService
{
    private readonly IEVRGame _game;

    /// <summary>
    /// Clé de décryptage par défaut pour IEVR (découverte par Viola).
    /// </summary>
    public const uint DefaultKey = NativeCrypto.IEVRCriKey;

    public CriCryptoService(IEVRGame game)
    {
        _game = game;
    }

    /// <summary>
    /// Ouvre un stream CPK décrypté.
    /// </summary>
    /// <param name="cpkPath">Chemin vers le fichier CPK</param>
    /// <param name="key">Clé de décryptage (optionnel, calcule depuis le nom de fichier)</param>
    public Stream OpenDecryptedCpkStream(string cpkPath, uint? key = null)
    {
        uint decryptKey = key ?? NativeCrypto.CalculateKeyFromPath(cpkPath);

        var fs = new FileStream(cpkPath, FileMode.Open, FileAccess.Read, FileShare.Read,
            bufferSize: 128 * 1024, FileOptions.SequentialScan);

        return new CpkDecryptionStream(fs, decryptKey, ownsStream: true);
    }

    /// <summary>
    /// Décrypte un bloc de données cfg.bin en place.
    /// </summary>
    /// <param name="data">Données à décrypter</param>
    /// <param name="key">Clé de décryptage</param>
    public void DecryptCfgBinInPlace(byte[] data, uint key = DefaultKey)
    {
        // Utilise NativeCrypto optimisé
        NativeCrypto.DecryptBlock(data.AsSpan(), 0, key);
    }

    /// <summary>
    /// Décrypte un fichier Criware (AWB, ACB, etc.).
    /// </summary>
    /// <param name="inputPath">Fichier d'entrée</param>
    /// <param name="outputPath">Fichier de sortie</param>
    /// <returns>Clé utilisée pour le décryptage</returns>
    public uint DecryptCriwareFile(string inputPath, string outputPath)
    {
        byte[] data = File.ReadAllBytes(inputPath);
        uint key = NativeCrypto.CalculateKeyFromPath(inputPath);

        // Decrypt avec NativeCrypto optimisé
        NativeCrypto.DecryptBlock(data.AsSpan(), 0, key);

        // Verify magic after decryption
        if (!NativeCrypto.IsEncrypted(data))
        {
            // Fichier correctement décrypté
        }
        else
        {
            // Try with lowercase filename
            key = NativeCrypto.CalculateKeyFromFilename(Path.GetFileName(inputPath).ToLowerInvariant());

            // Re-read and decrypt
            data = File.ReadAllBytes(inputPath);
            NativeCrypto.DecryptBlock(data.AsSpan(), 0, key);

            if (NativeCrypto.IsEncrypted(data))
            {
                // Try variations
                var variations = new[]
                {
                    Path.GetFileName(inputPath),
                    Path.GetFileNameWithoutExtension(inputPath),
                    Path.GetFileName(inputPath).ToLowerInvariant(),
                    Path.GetFileNameWithoutExtension(inputPath).ToLowerInvariant(),
                    "c03030110",
                    "c03030110.g4mg",
                    "03_IE3/c03030110.g4mg",
                    "data/common/chr/_face/03_IE3/c03030110/c03030110.g4mg",
                    "common/chr/_face/03_IE3/c03030110/c03030110.g4mg",
                    "chr/_face/03_IE3/c03030110/c03030110.g4mg",
                    "_face/03_IE3/c03030110/c03030110.g4mg",
                    "face/03_IE3/c03030110/c03030110.g4mg",
                    "03_IE3/c03030110/c03030110.g4mg"
                };

                foreach (var variant in variations)
                {
                    key = NativeCrypto.CalculateKeyFromFilename(variant);
                    // Console.WriteLine($"Trying key from '{variant}': 0x{key:X8}");

                    data = File.ReadAllBytes(inputPath);
                    NativeCrypto.DecryptBlock(data.AsSpan(), 0, key);

                    // Check magic manually
                    uint magic = System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(data);
                    // Console.WriteLine($"Variant '{variant}' -> Magic: 0x{magic:X8}");

                    if (!NativeCrypto.IsEncrypted(data))
                    {
                        Console.WriteLine($"Success! Key found from '{variant}'");
                        goto Success;
                    }
                }

                throw new InvalidOperationException($"Failed to decrypt file: {inputPath}. Unknown encryption.");
            }
        }

    Success:
        var dir = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrEmpty(dir))
        {
            Directory.CreateDirectory(dir);
        }

        File.WriteAllBytes(outputPath, data);
        return key;
    }

    /// <summary>
    /// Décrypte un fichier de manière asynchrone avec rapport de progression.
    /// </summary>
    public async Task<uint> DecryptCriwareFileAsync(string inputPath, string outputPath,
        IProgress<(long current, long total)>? progress = null, CancellationToken ct = default)
    {
        uint key = NativeCrypto.CalculateKeyFromPath(inputPath);

        var dir = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrEmpty(dir))
        {
            Directory.CreateDirectory(dir);
        }

        await using var input = new FileStream(inputPath, FileMode.Open, FileAccess.Read, FileShare.Read,
            bufferSize: 4 * 1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        await using var output = new FileStream(outputPath, FileMode.Create, FileAccess.Write, FileShare.None,
            bufferSize: 4 * 1024 * 1024, FileOptions.Asynchronous);

        await NativeCrypto.DecryptStreamAsync(input, output, key, progress, ct);
        return key;
    }

    /// <summary>
    /// Chiffre un fichier Criware.
    /// </summary>
    /// <param name="inputPath">Fichier d'entrée (décrypté)</param>
    /// <param name="outputPath">Fichier de sortie</param>
    /// <param name="key">Clé de chiffrement</param>
    public void EncryptCriwareFile(string inputPath, string outputPath, uint key)
    {
        byte[] data = File.ReadAllBytes(inputPath);

        // XOR encryption is symmetric - utilise NativeCrypto
        NativeCrypto.DecryptBlock(data.AsSpan(), 0, key);

        var dir = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrEmpty(dir))
        {
            Directory.CreateDirectory(dir);
        }

        File.WriteAllBytes(outputPath, data);
    }

    /// <summary>
    /// Calcule la clé de décryptage à partir du nom de fichier.
    /// Algorithme CRI standard basé sur CRC32.
    /// </summary>
    public static uint CalculateKeyFromFilename(string filePath)
        => NativeCrypto.CalculateKeyFromPath(filePath);
}
