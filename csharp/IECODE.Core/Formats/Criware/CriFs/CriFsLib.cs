using IECODE.Core.Formats.Criware.CriFs.Definitions;
using IECODE.Core.Formats.Criware.CriFs.Definitions.Interfaces;
using IECODE.Core.Formats.Criware.CriFs.Definitions.Structs;
using IECODE.Core.Formats.Criware.CriFs.Encryption.Game;
using IECODE.Core.Formats.Criware.CriFs.Utilities;
using IECODE.Core.Formats.Criware.CriFs.Utilities.Parsing;

namespace IECODE.Core.Formats.Criware.CriFs;

/// <inheritdoc />
public class CriFsLib : ICriFsLib
{
    /// <summary>
    /// Singleton instance of this class.
    /// </summary>
    public static readonly CriFsLib Instance = new();

    private InPlaceDecryptionFunction? _decrypt;

    /// <inheritdoc />
    public ICriFsLibUtilities Utilities { get; } = new CriFsLibUtilities();

    /// <inheritdoc />
    public void SetDefaultEncryptionFunction(InPlaceDecryptionFunction function) => _decrypt = function;

    /// <inheritdoc />
    public ICpkReader CreateCpkReader(Stream cpkStream, bool ownsStream, InPlaceDecryptionFunction? decrypt = null)
    {
        decrypt ??= _decrypt;
        return new CpkReader(cpkStream, ownsStream, decrypt);
    }

    /// <inheritdoc />
    public IAsyncCpkReader CreateAsyncCpkReader(string cpkPath, InPlaceDecryptionFunction? decrypt = null, int maxConcurrentReads = 4)
    {
        decrypt ??= _decrypt;
        return new AsyncCpkReader(cpkPath, decrypt, maxConcurrentReads);
    }

    /// <inheritdoc />
    public InPlaceDecryptionFunction? GetKnownDecryptionFunction(KnownDecryptionFunction decryptFunc)
    {
        return decryptFunc switch
        {
            KnownDecryptionFunction.P5R => P5RCrypto.DecryptionFunction,
            _ => null
        };
    }

    /// <inheritdoc />
    public IBatchFileExtractor<T> CreateBatchExtractor<T>(string sourceCpkPath, InPlaceDecryptionFunction? decrypt = null) where T : IBatchFileExtractorItem
    {
        decrypt ??= _decrypt;
        return new BatchFileExtractor<T>(sourceCpkPath, decrypt);
    }

    /// <summary>
    /// Creates an optimized batch extractor for large archives.
    /// This extractor uses I/O pipelines and parallel processing for maximum throughput.
    /// </summary>
    /// <param name="sourceCpkPath">Path to the CPK file.</param>
    /// <param name="options">Extraction options.</param>
    /// <param name="decrypt">Decryption function.</param>
    /// <returns>Optimized batch extractor.</returns>
    public OptimizedBatchExtractor CreateOptimizedBatchExtractor(string sourceCpkPath, ExtractionOptions? options = null, InPlaceDecryptionFunction? decrypt = null)
    {
        decrypt ??= _decrypt;
        return new OptimizedBatchExtractor(sourceCpkPath, options, decrypt);
    }
}

/// <inheritdoc />
public class CriFsLibUtilities : ICriFsLibUtilities
{
    /// <inheritdoc />
    public unsafe CpkFile[] GetFiles(byte* dataPtr) => CpkHelper.GetFilesFromFile(dataPtr);
}
