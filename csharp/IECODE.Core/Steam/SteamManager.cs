using System;
using System.IO;
using System.Runtime.Versioning;

namespace IECODE.Core.Steam;

public class SteamManager : IDisposable
{
    private bool _initialized;

    /// <summary>Uses centralized IEVR App ID.</summary>
    private const uint AppId = IEVRConstants.STEAM_APP_ID;

    public bool IsInitialized => _initialized;

    public void Initialize()
    {
        if (_initialized) return;

        string libName = OperatingSystem.IsWindows() ? "steam_api64.dll" : "libsteam_api.so";

        // Check if DLL exists to avoid DllNotFoundException
        // On Windows, we expect the DLL in the application directory.
        // On Linux, it might be in the application directory or LD_LIBRARY_PATH.
        if (OperatingSystem.IsWindows() && !File.Exists(libName))
        {
            Console.WriteLine($"[Steam] {libName} not found. Steam integration disabled.");
            return;
        }

        try
        {
            // Attempt to initialize
            // We wrap this in a separate method to ensure JIT/AOT doesn't try to resolve the DLL 
            // just by entering the Initialize method (though usually safe with P/Invoke)
            InitializeInternal();
        }
        catch (DllNotFoundException)
        {
            Console.WriteLine($"[Steam] {libName} could not be loaded (DllNotFoundException).");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Steam] Error initializing: {ex.Message}");
        }
    }

    private void InitializeInternal()
    {
        if (SteamApi.Init())
        {
            _initialized = true;
            Console.WriteLine("[Steam] Initialized successfully.");
        }
        else
        {
            Console.WriteLine("[Steam] Initialization failed. Is Steam running?");
        }
    }

    public void Dispose()
    {
        if (_initialized)
        {
            SteamApi.Shutdown();
            _initialized = false;
        }
        GC.SuppressFinalize(this);
    }
}
