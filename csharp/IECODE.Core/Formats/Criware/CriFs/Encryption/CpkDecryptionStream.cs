namespace IECODE.Core.Formats.Criware.CriFs.Encryption;

/// <summary>
/// A stream wrapper that decrypts CRI Middleware encrypted data on-the-fly.
/// Supports seeking because the encryption is position-based.
/// </summary>
public sealed class CpkDecryptionStream : Stream
{
    private readonly Stream _baseStream;
    private readonly uint _key;
    private readonly bool _ownsStream;

    public CpkDecryptionStream(Stream baseStream, uint key, bool ownsStream = true)
    {
        _baseStream = baseStream;
        _key = key;
        _ownsStream = ownsStream;
    }

    /// <summary>
    /// Creates a decryption stream using the CPK filename to derive the key.
    /// </summary>
    public static CpkDecryptionStream FromFile(string cpkPath)
    {
        var key = CriwareCrypt.CalculateKeyFromFilename(Path.GetFileName(cpkPath));
        var stream = new FileStream(cpkPath, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.SequentialScan);
        return new CpkDecryptionStream(stream, key, ownsStream: true);
    }

    public override bool CanRead => true;
    public override bool CanSeek => _baseStream.CanSeek;
    public override bool CanWrite => false;
    public override long Length => _baseStream.Length;
    public override long Position
    {
        get => _baseStream.Position;
        set => _baseStream.Position = value;
    }

    public override void Flush() => _baseStream.Flush();

    public override int Read(byte[] buffer, int offset, int count)
    {
        long currentPos = _baseStream.Position;
        int bytesRead = _baseStream.Read(buffer, offset, count);
        if (bytesRead > 0)
            CriwareCrypt.DecryptBlock(buffer.AsSpan(offset, bytesRead), currentPos, _key);
        return bytesRead;
    }

    public override long Seek(long offset, SeekOrigin origin) => _baseStream.Seek(offset, origin);
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing && _ownsStream)
            _baseStream.Dispose();
        base.Dispose(disposing);
    }
}
