# EOS Integration

This module provides integration with the Epic Online Services (EOS) SDK, specifically for the Player Data Storage interface used by Inazuma Eleven Victory Road for cloud saves.

## Components

### EOSSDK.cs
Contains P/Invoke definitions for `EOSSDK-Win64-Shipping.dll`.
- Uses `LibraryImport` for AOT compatibility.
- Defines necessary structs and delegates for Player Data Storage.

### EOSManager.cs
Provides a high-level, async-friendly API for managing cloud saves.
- `QueryFilesAsync()`: Lists all files in the user's cloud storage.
- `ReadFileAsync(filename)`: Downloads a file from cloud storage.
- `WriteFileAsync(filename, data)`: Uploads a file to cloud storage.

## Usage

### Standalone Mode (Tool/CLI)

```csharp
using var eosManager = new EOSManager();

// Initialize SDK and Platform
await eosManager.InitializePlatformAsync(
    productName: "IECODE",
    productVersion: "1.0.0",
    productId: "...",
    sandboxId: "...",
    deploymentId: "...",
    clientId: "...",
    clientSecret: "..."
);

// Login
var userId = await eosManager.LoginAsync(
    id: "...", 
    token: "...", 
    type: EOSSDK.EOS_ELoginCredentialType.ExchangeCode
);

// Now you can access storage
var files = await eosManager.QueryFilesAsync();
```

### Injection Mode (Game Context)

```csharp
// Initialize manager with existing handles from the game process
var eosManager = new EOSManager(platformHandle, userHandle);

// List files
var files = await eosManager.QueryFilesAsync();
```

## Implementation Details

- **Lifecycle Management**: Handles SDK initialization, platform creation, and the required `Tick` loop on a background thread.
- **Async/Await**: All operations are asynchronous and use `TaskCompletionSource` to bridge EOS callbacks to .NET Tasks.
- **Chunked Transfer**: Handles the 1MB chunked transfer required by EOS automatically.
- **Memory Management**: Uses `GCHandle` to pass context to callbacks and ensures resources are freed.
- **AOT Compatible**: No reflection or dynamic code generation used. Manual marshalling for non-blittable types.

## Requirements

- `EOSSDK-Win64-Shipping.dll` must be present in the application directory or search path.
- For standalone mode, valid EOS credentials (ClientId, ClientSecret, etc.) are required.
