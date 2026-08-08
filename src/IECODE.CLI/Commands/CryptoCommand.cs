using IECODE.Core;
using IECODE.Core.Crypto;

namespace IECODE.CLI.Commands;

/// <summary>
/// Commande crypto - Chiffrement/déchiffrement des fichiers Criware.
/// </summary>
public static class CryptoCommand
{
    public static Task DecryptAsync(string file, string output, bool verbose)
    {
        try
        {
            if (!File.Exists(file))
            {
                Console.Error.WriteLine($"Error: File not found: {file}");
                Environment.ExitCode = 1;
                return Task.CompletedTask;
            }

            Console.WriteLine($"Decrypting: {file}");

            using var game = new IEVRGame();
            uint key = game.Crypto.DecryptCriwareFile(file, output);

            Console.WriteLine($"Output: {output}");
            Console.WriteLine();
            Console.WriteLine($"╔══════════════════════════════════════════════════╗");
            Console.WriteLine($"║  IMPORTANT: Save this key for re-encryption!     ║");
            Console.WriteLine($"║  Key: 0x{key:X8}                               ║");
            Console.WriteLine($"╚══════════════════════════════════════════════════╝");
            return Task.CompletedTask;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            if (verbose)
            {
                Console.Error.WriteLine(ex.StackTrace);
            }
            Environment.ExitCode = 1;
            return Task.CompletedTask;
        }
    }

    public static Task EncryptAsync(string file, string output, string keyStr, bool verbose)
    {
        try
        {
            if (!File.Exists(file))
            {
                Console.Error.WriteLine($"Error: File not found: {file}");
                Environment.ExitCode = 1;
                return Task.CompletedTask;
            }

            // Parse key
            uint key;
            if (keyStr.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            {
                key = Convert.ToUInt32(keyStr[2..], 16);
            }
            else
            {
                key = Convert.ToUInt32(keyStr, 16);
            }

            Console.WriteLine($"Encrypting: {file}");
            Console.WriteLine($"Key: 0x{key:X8}");

            using var game = new IEVRGame();
            game.Crypto.EncryptCriwareFile(file, output, key);

            Console.WriteLine($"Output: {output}");
            Console.WriteLine("Done!");
            return Task.CompletedTask;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            if (verbose)
            {
                Console.Error.WriteLine(ex.StackTrace);
            }
            Environment.ExitCode = 1;
        }
        return Task.CompletedTask;
    }
}
