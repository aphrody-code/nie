using System.Runtime.InteropServices;
using System.Text;
using IECODE.Core.EOS;

namespace IECODE.Core.EOS;

/// <summary>
/// High-level manager for Epic Online Services SDK integration.
/// Provides async-friendly wrappers for PlayerDataStorage (cloud saves).
/// </summary>
/// <remarks>
/// EOS SDK Lifecycle:
/// 1. EOS_Initialize() - Called once at application start
/// 2. EOS_Platform_Create() - Creates platform handle with credentials
/// 3. EOS_Auth_Login() - Authenticates user
/// 4. EOS_Platform_Tick() - Must be called every 100ms for callback processing
/// 5. EOS_Platform_Release() + EOS_Shutdown() - Cleanup on app exit
/// 
/// Thread Safety: EOS callbacks must not be invoked from multiple threads simultaneously.
/// The tick loop runs on a dedicated background thread.
/// 
/// References:
/// - https://dev.epicgames.com/docs/game-services/eos-platform-interface
/// - https://dev.epicgames.com/docs/game-services/player-data-storage
/// </remarks>
[System.Runtime.Versioning.SupportedOSPlatform("windows")]
public class EOSManager : IDisposable
{
    #region Fields

    private EOSSDK.EOS_HPlatform _platformHandle;
    private EOSSDK.EOS_HPlayerDataStorage _storageHandle;
    private EOSSDK.EOS_ProductUserId _localUserId;
    private EOSSDK.EOS_HAuth _authHandle;

    private CancellationTokenSource? _tickCts;
    private Task? _tickTask;
    private bool _isDisposed;

    /// <summary>
    /// Tick interval in milliseconds. EOS recommends calling Tick every frame.
    /// 100ms is a good default for non-game applications.
    /// </summary>
    private const int TickIntervalMs = 100;

    #endregion

    #region Constructors

    /// <summary>
    /// Creates an EOSManager from an existing platform handle (for injection/game context).
    /// </summary>
    /// <param name="platformHandle">Existing EOS_HPlatform from the game process.</param>
    /// <param name="userHandle">Existing EOS_ProductUserId from the game process.</param>
    public EOSManager(IntPtr platformHandle, IntPtr userHandle)
    {
        ArgumentNullException.ThrowIfNull(platformHandle == IntPtr.Zero ? null : platformHandle, nameof(platformHandle));

        _platformHandle = new EOSSDK.EOS_HPlatform(platformHandle);
        _localUserId = new EOSSDK.EOS_ProductUserId(userHandle);
        _storageHandle = EOSSDK.EOS_Platform_GetPlayerDataStorageInterface(_platformHandle);
        _authHandle = new EOSSDK.EOS_HAuth(EOSSDK.EOS_Platform_GetAuthInterface(_platformHandle));
    }

    /// <summary>
    /// Creates an EOSManager for standalone initialization.
    /// Call <see cref="InitializePlatformAsync"/> to complete setup.
    /// </summary>
    public EOSManager()
    {
    }

    #endregion

    #region Properties

    /// <summary>
    /// Indicates if the EOS SDK has been initialized and platform created.
    /// </summary>
    public bool IsInitialized => _platformHandle.IsValid;

    /// <summary>
    /// Indicates if a user is currently logged in.
    /// </summary>
    public bool IsLoggedIn => _localUserId.IsValid;

    #endregion

    #region Initialization

    /// <summary>
    /// Initializes the EOS SDK and creates a platform instance.
    /// </summary>
    /// <param name="productName">Your product name (for logging).</param>
    /// <param name="productVersion">Your product version (for logging).</param>
    /// <param name="productId">EOS Product ID from Developer Portal.</param>
    /// <param name="sandboxId">EOS Sandbox ID (Dev/Stage/Live).</param>
    /// <param name="deploymentId">EOS Deployment ID.</param>
    /// <param name="clientId">EOS Client ID from Developer Portal.</param>
    /// <param name="clientSecret">EOS Client Secret from Developer Portal.</param>
    /// <returns>Task that completes when initialization is done.</returns>
    /// <exception cref="InvalidOperationException">Thrown if initialization fails.</exception>
    /// <remarks>
    /// EOS SDK Initialization Flow:
    /// 1. EOS_Initialize() - Global SDK initialization
    /// 2. EOS_Platform_Create() - Create platform with credentials
    /// 3. Start tick loop for callback processing
    /// </remarks>
    public Task InitializePlatformAsync(
        string productName,
        string productVersion,
        string productId,
        string sandboxId,
        string deploymentId,
        string clientId,
        string clientSecret)
    {
        ObjectDisposedException.ThrowIf(_isDisposed, this);

        // 1. Initialize SDK
        var productNamePtr = StringToUtf8(productName);
        var productVersionPtr = StringToUtf8(productVersion);

        try
        {
            var initOptions = new EOSSDK.EOS_InitializeOptions
            {
                ApiVersion = 4, // EOS SDK 1.16+
                ProductName = productNamePtr,
                ProductVersion = productVersionPtr,
                AllocateMemoryFunction = IntPtr.Zero, // Use default allocator
                ReallocateMemoryFunction = IntPtr.Zero,
                ReleaseMemoryFunction = IntPtr.Zero,
                Reserved = IntPtr.Zero,
                SystemInitializeOptions = IntPtr.Zero,
                OverrideThreadAffinity = IntPtr.Zero
            };

            var initResult = EOSSDK.EOS_Initialize(ref initOptions);

            // AlreadyConfigured is OK - means we've already initialized
            if (initResult != EOSSDK.EOS_EResult.Success && initResult != EOSSDK.EOS_EResult.AlreadyConfigured)
            {
                throw new InvalidOperationException($"EOS_Initialize failed: {initResult}");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(productNamePtr);
            Marshal.FreeHGlobal(productVersionPtr);
        }

        // 2. Create Platform
        var productIdPtr = StringToUtf8(productId);
        var sandboxIdPtr = StringToUtf8(sandboxId);
        var deploymentIdPtr = StringToUtf8(deploymentId);
        var clientIdPtr = StringToUtf8(clientId);
        var clientSecretPtr = StringToUtf8(clientSecret);

        try
        {
            var platformOptions = new EOSSDK.EOS_Platform_Options
            {
                ApiVersion = 12, // EOS SDK 1.16+
                ProductId = productIdPtr,
                SandboxId = sandboxIdPtr,
                DeploymentId = deploymentIdPtr,
                ClientCredentials_ApiVersion = 1,
                ClientId = clientIdPtr,
                ClientSecret = clientSecretPtr,
                bIsServer = 0, // Client mode
                EncryptionKey = IntPtr.Zero,
                OverrideCountryCode = IntPtr.Zero,
                OverrideLocaleCode = IntPtr.Zero,
                Flags = 0, // EOS_PF_NONE
                CacheDirectory = IntPtr.Zero
            };

            _platformHandle = EOSSDK.EOS_Platform_Create(ref platformOptions);

            if (!_platformHandle.IsValid)
            {
                throw new InvalidOperationException("EOS_Platform_Create failed - check your credentials in Developer Portal");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(productIdPtr);
            Marshal.FreeHGlobal(sandboxIdPtr);
            Marshal.FreeHGlobal(deploymentIdPtr);
            Marshal.FreeHGlobal(clientIdPtr);
            Marshal.FreeHGlobal(clientSecretPtr);
        }

        _storageHandle = EOSSDK.EOS_Platform_GetPlayerDataStorageInterface(_platformHandle);
        _authHandle = new EOSSDK.EOS_HAuth(EOSSDK.EOS_Platform_GetAuthInterface(_platformHandle));

        // 3. Start Tick Loop - CRITICAL for EOS callback processing
        StartTicking();

        return Task.CompletedTask;
    }

    /// <summary>
    /// Starts the EOS_Platform_Tick background loop.
    /// This is required for all EOS async callbacks to be processed.
    /// </summary>
    private void StartTicking()
    {
        if (_tickTask != null)
            return; // Already running

        _tickCts = new CancellationTokenSource();
        _tickTask = Task.Run(async () =>
        {
            while (!_tickCts.Token.IsCancellationRequested)
            {
                if (_platformHandle.IsValid)
                {
                    // EOS_Platform_Tick processes all pending callbacks
                    // Must be called regularly (every frame or ~100ms)
                    EOSSDK.EOS_Platform_Tick(_platformHandle);
                }

                try
                {
                    await Task.Delay(TickIntervalMs, _tickCts.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }, _tickCts.Token);
    }

    /// <summary>
    /// Stops the tick loop gracefully.
    /// </summary>
    private async Task StopTickingAsync()
    {
        if (_tickCts == null || _tickTask == null)
            return;

        _tickCts.Cancel();

        try
        {
            await _tickTask.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Expected
        }

        _tickCts.Dispose();
        _tickCts = null;
        _tickTask = null;
    }

    #endregion

    #region Authentication

    /// <summary>
    /// Authenticates a user with EOS.
    /// </summary>
    /// <param name="id">Login ID (email, exchange code, etc. depending on type).</param>
    /// <param name="token">Login token (password, code, etc. depending on type).</param>
    /// <param name="type">The type of credentials being provided.</param>
    /// <returns>The authenticated user's Product User ID.</returns>
    /// <exception cref="InvalidOperationException">Thrown if login fails.</exception>
    public Task<EOSSDK.EOS_ProductUserId> LoginAsync(string id, string token, EOSSDK.EOS_ELoginCredentialType type)
    {
        ObjectDisposedException.ThrowIf(_isDisposed, this);

        if (!_platformHandle.IsValid)
            throw new InvalidOperationException("Platform not initialized. Call InitializePlatformAsync first.");

        var tcs = new TaskCompletionSource<EOSSDK.EOS_ProductUserId>();
        var context = new LoginContext { Tcs = tcs, Manager = this };
        var handle = GCHandle.Alloc(context);

        var idPtr = StringToUtf8(id);
        var tokenPtr = StringToUtf8(token);

        try
        {
            var credentials = new EOSSDK.EOS_Auth_Credentials
            {
                ApiVersion = 3,
                Id = idPtr,
                Token = tokenPtr,
                Type = type,
                SystemAuthCredentialsOptions = IntPtr.Zero,
                ExternalType = 0
            };

            var options = new EOSSDK.EOS_Auth_LoginOptions
            {
                ApiVersion = 2,
                Credentials = IntPtr.Zero,
                ScopeFlags = EOSSDK.EOS_EAuthScopeFlags.BasicProfile
            };

            var credentialsPtr = Marshal.AllocHGlobal(Marshal.SizeOf<EOSSDK.EOS_Auth_Credentials>());
            Marshal.StructureToPtr(credentials, credentialsPtr, false);
            options.Credentials = credentialsPtr;

            EOSSDK.EOS_Auth_Login(
                _authHandle.Value,
                ref options,
                GCHandle.ToIntPtr(handle),
                Marshal.GetFunctionPointerForDelegate(OnLoginComplete)
            );

            Marshal.FreeHGlobal(credentialsPtr);
        }
        finally
        {
            Marshal.FreeHGlobal(idPtr);
            Marshal.FreeHGlobal(tokenPtr);
        }

        return tcs.Task;
    }

    private sealed class LoginContext
    {
        public required TaskCompletionSource<EOSSDK.EOS_ProductUserId> Tcs;
        public required EOSManager Manager;
    }

    private static void OnLoginCompleteCallback(ref EOSSDK.EOS_Auth_LoginCallbackInfo data)
    {
        var handle = GCHandle.FromIntPtr(data.ClientData);
        var context = (LoginContext)handle.Target!;

        try
        {
            if (data.ResultCode == EOSSDK.EOS_EResult.Success)
            {
                context.Manager._localUserId = data.LocalUserId;
                context.Tcs.SetResult(data.LocalUserId);
            }
            else
            {
                context.Tcs.SetException(new InvalidOperationException($"EOS Login failed: {data.ResultCode}"));
            }
        }
        finally
        {
            handle.Free();
        }
    }

    #endregion

    #region Player Data Storage - Query Files

    /// <summary>
    /// Queries the list of files in the user's cloud storage.
    /// </summary>
    /// <returns>List of file metadata for all files in cloud storage.</returns>
    /// <exception cref="InvalidOperationException">Thrown if query fails.</exception>
    public Task<List<FileMetadata>> QueryFilesAsync()
    {
        ObjectDisposedException.ThrowIf(_isDisposed, this);

        if (!_localUserId.IsValid)
            throw new InvalidOperationException("User not logged in. Call LoginAsync first.");

        var tcs = new TaskCompletionSource<List<FileMetadata>>();
        var context = new QueryContext { Tcs = tcs, Manager = this };
        var handle = GCHandle.Alloc(context);

        var options = new EOSSDK.EOS_PlayerDataStorage_QueryFileListOptions
        {
            ApiVersion = 1,
            LocalUserId = _localUserId
        };

        EOSSDK.EOS_PlayerDataStorage_QueryFileList(
            _storageHandle,
            ref options,
            GCHandle.ToIntPtr(handle),
            Marshal.GetFunctionPointerForDelegate(OnQueryFileListComplete)
        );

        return tcs.Task;
    }

    private sealed class QueryContext
    {
        public required TaskCompletionSource<List<FileMetadata>> Tcs;
        public required EOSManager Manager;
    }

    private static void OnQueryFileListCompleteCallback(ref EOSSDK.EOS_PlayerDataStorage_QueryFileListCallbackInfo data)
    {
        var handle = GCHandle.FromIntPtr(data.ClientData);
        var context = (QueryContext)handle.Target!;

        try
        {
            var results = new List<FileMetadata>();

            for (uint i = 0; i < data.FileCount; i++)
            {
                var copyOptions = new EOSSDK.EOS_PlayerDataStorage_CopyFileMetadataAtIndexOptions
                {
                    ApiVersion = 1,
                    LocalUserId = data.LocalUserId,
                    Index = i
                };

                if (EOSSDK.EOS_PlayerDataStorage_CopyFileMetadataAtIndex(context.Manager._storageHandle, ref copyOptions, out IntPtr metadataPtr) == EOSSDK.EOS_EResult.Success)
                {
                    try
                    {
                        var metadata = Marshal.PtrToStructure<EOSSDK.EOS_PlayerDataStorage_FileMetadata>(metadataPtr);
                        string filename = Marshal.PtrToStringAnsi(metadata.Filename) ?? string.Empty;
                        string md5 = Marshal.PtrToStringAnsi(metadata.MD5Hash) ?? string.Empty;
                        results.Add(new FileMetadata(filename, metadata.FileSizeBytes, md5, metadata.LastModifiedTime));
                    }
                    finally
                    {
                        EOSSDK.EOS_PlayerDataStorage_FileMetadata_Release(metadataPtr);
                    }
                }
            }

            context.Tcs.SetResult(results);
        }
        catch (Exception ex)
        {
            context.Tcs.SetException(ex);
        }
        finally
        {
            handle.Free();
        }
    }

    #endregion

    #region Player Data Storage - Read File

    private sealed class ReadContext
    {
        public required TaskCompletionSource<byte[]> Tcs;
        public required MemoryStream Buffer;
    }

    /// <summary>
    /// Reads a file from cloud storage.
    /// </summary>
    /// <param name="filename">Name of the file to read.</param>
    /// <returns>File contents as byte array.</returns>
    /// <exception cref="InvalidOperationException">Thrown if read fails.</exception>
    public Task<byte[]> ReadFileAsync(string filename)
    {
        ObjectDisposedException.ThrowIf(_isDisposed, this);
        ArgumentException.ThrowIfNullOrWhiteSpace(filename);

        if (!_localUserId.IsValid)
            throw new InvalidOperationException("User not logged in. Call LoginAsync first.");

        var tcs = new TaskCompletionSource<byte[]>();
        var context = new ReadContext { Tcs = tcs, Buffer = new MemoryStream() };
        var handle = GCHandle.Alloc(context);
        var filenamePtr = StringToUtf8(filename);

        try
        {
            var options = new EOSSDK.EOS_PlayerDataStorage_ReadFileOptions
            {
                ApiVersion = 1,
                LocalUserId = _localUserId,
                Filename = filenamePtr,
                ReadChunkLengthBytes = 1024 * 1024, // 1MB chunks
                ReadFileDataCallback = Marshal.GetFunctionPointerForDelegate(OnReadFileData),
                FileTransferProgressCallback = IntPtr.Zero
            };

            var requestHandle = EOSSDK.EOS_PlayerDataStorage_ReadFile(
                _storageHandle,
                ref options,
                GCHandle.ToIntPtr(handle),
                Marshal.GetFunctionPointerForDelegate(OnReadFileComplete)
            );

            if (!requestHandle.IsValid)
            {
                handle.Free();
                throw new InvalidOperationException($"Failed to start read operation for '{filename}'");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(filenamePtr);
        }

        return tcs.Task;
    }

    private static EOSSDK.EOS_EResult OnReadFileDataCallback(ref EOSSDK.EOS_PlayerDataStorage_ReadFileDataCallbackInfo data)
    {
        var handle = GCHandle.FromIntPtr(data.ClientData);
        var context = (ReadContext)handle.Target!;

        if (data.DataChunk != IntPtr.Zero && data.DataChunkLengthBytes > 0)
        {
            var buffer = new byte[data.DataChunkLengthBytes];
            Marshal.Copy(data.DataChunk, buffer, 0, (int)data.DataChunkLengthBytes);
            context.Buffer.Write(buffer, 0, buffer.Length);
        }

        return EOSSDK.EOS_EResult.Success;
    }

    private static void OnReadFileCompleteCallback(ref EOSSDK.EOS_PlayerDataStorage_ReadFileCallbackInfo data)
    {
        var handle = GCHandle.FromIntPtr(data.ClientData);
        var context = (ReadContext)handle.Target!;

        try
        {
            if (data.ResultCode == EOSSDK.EOS_EResult.Success)
            {
                context.Tcs.SetResult(context.Buffer.ToArray());
            }
            else
            {
                context.Tcs.SetException(new InvalidOperationException(
                    $"Read file '{data.Filename}' failed: {data.ResultCode}"));
            }
        }
        catch (Exception ex)
        {
            context.Tcs.SetException(ex);
        }
        finally
        {
            context.Buffer.Dispose();
            handle.Free();
        }
    }

    #endregion

    #region Player Data Storage - Write File

    private sealed class WriteContext
    {
        public required TaskCompletionSource<bool> Tcs;
        public required byte[] Data;
        public int Position;
    }

    /// <summary>
    /// Writes a file to cloud storage.
    /// </summary>
    /// <param name="filename">Name of the file to write.</param>
    /// <param name="data">File contents to upload.</param>
    /// <returns>Task that completes when write is done.</returns>
    /// <exception cref="InvalidOperationException">Thrown if write fails.</exception>
    /// <remarks>
    /// EOS PlayerDataStorage limits:
    /// - Maximum file size: 200 MB per file
    /// - Maximum total storage: 400 MB per user
    /// - Maximum filename length: 64 characters
    /// </remarks>
    public Task WriteFileAsync(string filename, byte[] data)
    {
        ObjectDisposedException.ThrowIf(_isDisposed, this);
        ArgumentException.ThrowIfNullOrWhiteSpace(filename);
        ArgumentNullException.ThrowIfNull(data);

        if (!_localUserId.IsValid)
            throw new InvalidOperationException("User not logged in. Call LoginAsync first.");

        var tcs = new TaskCompletionSource<bool>();
        var context = new WriteContext { Tcs = tcs, Data = data, Position = 0 };
        var handle = GCHandle.Alloc(context);
        var filenamePtr = StringToUtf8(filename);

        try
        {
            var options = new EOSSDK.EOS_PlayerDataStorage_WriteFileOptions
            {
                ApiVersion = 1,
                LocalUserId = _localUserId,
                Filename = filenamePtr,
                ChunkLengthBytes = 1024 * 1024, // 1MB chunks
                WriteFileDataCallback = Marshal.GetFunctionPointerForDelegate(OnWriteFileData),
                FileTransferProgressCallback = IntPtr.Zero
            };

            var requestHandle = EOSSDK.EOS_PlayerDataStorage_WriteFile(
                _storageHandle,
                ref options,
                GCHandle.ToIntPtr(handle),
                Marshal.GetFunctionPointerForDelegate(OnWriteFileComplete)
            );

            if (!requestHandle.IsValid)
            {
                handle.Free();
                throw new InvalidOperationException($"Failed to start write operation for '{filename}'");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(filenamePtr);
        }

        return tcs.Task;
    }

    private static EOSSDK.EOS_EResult OnWriteFileDataCallback(ref EOSSDK.EOS_PlayerDataStorage_WriteFileDataCallbackInfo data, IntPtr outDataBuffer, ref uint outDataWritten)
    {
        var handle = GCHandle.FromIntPtr(data.ClientData);
        var context = (WriteContext)handle.Target!;

        if (context.Position >= context.Data.Length)
        {
            return EOSSDK.EOS_EResult.Success;
        }

        int remaining = context.Data.Length - context.Position;
        int toWrite = Math.Min(remaining, (int)data.DataBufferLengthBytes);

        if (toWrite > 0)
        {
            Marshal.Copy(context.Data, context.Position, outDataBuffer, toWrite);
            context.Position += toWrite;
            outDataWritten = (uint)toWrite;
        }
        else
        {
            outDataWritten = 0;
        }

        return EOSSDK.EOS_EResult.Success;
    }

    private static void OnWriteFileCompleteCallback(ref EOSSDK.EOS_PlayerDataStorage_WriteFileCallbackInfo data)
    {
        var handle = GCHandle.FromIntPtr(data.ClientData);
        var context = (WriteContext)handle.Target!;

        try
        {
            if (data.ResultCode == EOSSDK.EOS_EResult.Success)
            {
                context.Tcs.SetResult(true);
            }
            else
            {
                context.Tcs.SetException(new InvalidOperationException(
                    $"Write file '{data.Filename}' failed: {data.ResultCode}"));
            }
        }
        catch (Exception ex)
        {
            context.Tcs.SetException(ex);
        }
        finally
        {
            handle.Free();
        }
    }

    #endregion

    #region Callback Delegates (Static to prevent GC collection)

    // These delegates are stored as static fields to prevent garbage collection
    // while EOS SDK holds references to them
    private static readonly EOSSDK.EOS_PlayerDataStorage_OnQueryFileListCompleteCallback OnQueryFileListComplete = OnQueryFileListCompleteCallback;
    private static readonly EOSSDK.EOS_PlayerDataStorage_OnReadFileDataCallback OnReadFileData = OnReadFileDataCallback;
    private static readonly EOSSDK.EOS_PlayerDataStorage_OnReadFileCompleteCallback OnReadFileComplete = OnReadFileCompleteCallback;
    private static readonly EOSSDK.EOS_PlayerDataStorage_OnWriteFileDataCallback OnWriteFileData = OnWriteFileDataCallback;
    private static readonly EOSSDK.EOS_PlayerDataStorage_OnWriteFileCompleteCallback OnWriteFileComplete = OnWriteFileCompleteCallback;
    private static readonly EOSSDK.EOS_Auth_OnLoginCallback OnLoginComplete = OnLoginCompleteCallback;

    #endregion

    #region Types

    /// <summary>
    /// Metadata for a file in cloud storage.
    /// </summary>
    /// <param name="Filename">Name of the file.</param>
    /// <param name="Size">Size in bytes.</param>
    /// <param name="MD5">MD5 hash of the file contents.</param>
    /// <param name="Timestamp">Unix timestamp of last modification.</param>
    public record FileMetadata(string Filename, uint Size, string MD5, long Timestamp);

    #endregion

    #region Helpers

    /// <summary>
    /// Converts a managed string to a null-terminated UTF-8 byte array in unmanaged memory.
    /// </summary>
    /// <param name="s">String to convert.</param>
    /// <returns>Pointer to unmanaged memory containing the UTF-8 string. Must be freed with Marshal.FreeHGlobal.</returns>
    private static IntPtr StringToUtf8(string s)
    {
        if (s == null) return IntPtr.Zero;

        int len = Encoding.UTF8.GetByteCount(s);
        byte[] buffer = new byte[len + 1]; // +1 for null terminator
        Encoding.UTF8.GetBytes(s, 0, s.Length, buffer, 0);
        buffer[len] = 0; // Null terminator

        IntPtr ptr = Marshal.AllocHGlobal(buffer.Length);
        Marshal.Copy(buffer, 0, ptr, buffer.Length);
        return ptr;
    }

    #endregion

    #region IDisposable

    /// <summary>
    /// Releases all EOS SDK resources.
    /// </summary>
    /// <remarks>
    /// Cleanup order:
    /// 1. Stop tick loop
    /// 2. Release platform handle
    /// 3. Shutdown EOS SDK
    /// </remarks>
    public void Dispose()
    {
        if (_isDisposed) return;
        _isDisposed = true;

        // 1. Stop tick loop first
        _tickCts?.Cancel();
        try
        {
            _tickTask?.Wait(TimeSpan.FromSeconds(2));
        }
        catch (AggregateException)
        {
            // Ignore cancellation exceptions
        }
        _tickCts?.Dispose();

        // 2. Release platform handle
        if (_platformHandle.IsValid)
        {
            EOSSDK.EOS_Platform_Release(_platformHandle);
            _platformHandle = new EOSSDK.EOS_HPlatform(IntPtr.Zero);
        }

        // 3. Shutdown SDK
        EOSSDK.EOS_Shutdown();

        GC.SuppressFinalize(this);
    }

    #endregion
}
