using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace IECODE.Core.Steam;

/// <summary>
/// Encrypted app ticket context structure for Steam DRM validation.
/// Discovered through reverse engineering of nie.exe (lines 698515-698560).
/// </summary>
/// <remarks>
/// Source: docs/nie-analysis/STEAM_API_INTEGRATION.md
/// Used for DRM protection, user authentication, and save validation.
/// </remarks>
[StructLayout(LayoutKind.Sequential, Pack = 1)]
[SupportedOSPlatform("windows")]
public struct EncryptedTicketContext
{
    /// <summary>
    /// Offset 0x28: Custom save data pointer.
    /// </summary>
    public IntPtr UserVariableDataPointer;

    /// <summary>
    /// Offset 0x30: Size of custom data.
    /// </summary>
    public uint UserDataSize;

    /// <summary>
    /// Offset 0x38: Encrypted ticket blob pointer.
    /// </summary>
    public IntPtr EncryptedDataPointer;

    /// <summary>
    /// Offset 0x3C: Size of encrypted data.
    /// </summary>
    public uint EncryptedSize;

    /// <summary>
    /// Offset 0x40: 32-byte decryption key pointer.
    /// </summary>
    public IntPtr DecryptionKeyPointer;

    /// <summary>
    /// Offset 0x54: Decrypted output buffer (max 32 bytes).
    /// </summary>
    private unsafe fixed byte _decryptedBuffer[32];

    /// <summary>
    /// Offset 0xAA0: Steam App ID.
    /// </summary>
    public uint AppId;

    /// <summary>
    /// Offset 0xAA4: Expected Steam ID (64-bit).
    /// </summary>
    public ulong ExpectedSteamId;

    /// <summary>
    /// Gets the decrypted buffer as a span.
    /// </summary>
    public readonly unsafe Span<byte> DecryptedBuffer
    {
        get
        {
            fixed (byte* ptr = _decryptedBuffer)
            {
                return new Span<byte>(ptr, 32);
            }
        }
    }
}
