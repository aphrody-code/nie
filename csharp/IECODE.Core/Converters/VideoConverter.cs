using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace IECODE.Core.Converters;

/// <summary>
/// Video converter service wrapping FFmpeg CLI.
/// Handles USM/CRIWARE video conversion to MP4/WebM.
/// </summary>
public class VideoConverter
{
    private readonly string _ffmpegPath;

    public VideoConverter(string ffmpegPath = "ffmpeg")
    {
        _ffmpegPath = ffmpegPath;
    }

    /// <summary>
    /// Checks if FFmpeg is available in the system.
    /// </summary>
    public bool IsAvailable()
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = _ffmpegPath,
                Arguments = "-version",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            });
            process?.WaitForExit();
            return process?.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Converts a video file to MP4 (H.264/AAC).
    /// </summary>
    public async Task ConvertToMp4Async(string inputPath, string outputPath, CancellationToken ct = default)
    {
        // -y: Overwrite output
        // -i: Input file
        // -c:v libx264: Video codec H.264
        // -c:a aac: Audio codec AAC
        // -pix_fmt yuv420p: Ensure compatibility with most players
        string args = $"-y -i \"{inputPath}\" -c:v libx264 -c:a aac -pix_fmt yuv420p \"{outputPath}\"";

        await RunFfmpegAsync(args, ct);
    }

    /// <summary>
    /// Converts a video file to WebM (VP9/Opus) with optional transparency.
    /// </summary>
    public async Task ConvertToWebmAsync(string inputPath, string outputPath, bool enableTransparency = false, CancellationToken ct = default)
    {
        // -c:v libvpx-vp9: Video codec VP9
        // -c:a libopus: Audio codec Opus
        string args;

        if (enableTransparency)
        {
            // -pix_fmt yuva420p: Alpha channel support
            // -auto-alt-ref 0: Required for transparency in some players
            args = $"-y -i \"{inputPath}\" -c:v libvpx-vp9 -c:a libopus -pix_fmt yuva420p -auto-alt-ref 0 \"{outputPath}\"";
        }
        else
        {
            args = $"-y -i \"{inputPath}\" -c:v libvpx-vp9 -c:a libopus -pix_fmt yuv420p \"{outputPath}\"";
        }

        await RunFfmpegAsync(args, ct);
    }

    private async Task RunFfmpegAsync(string arguments, CancellationToken ct)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = _ffmpegPath,
            Arguments = arguments,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = new Process { StartInfo = startInfo };

        // Capture error output for debugging
        var errorOutput = new System.Text.StringBuilder();
        process.ErrorDataReceived += (s, e) => { if (e.Data != null) errorOutput.AppendLine(e.Data); };

        if (!process.Start())
        {
            throw new InvalidOperationException("Failed to start FFmpeg process.");
        }

        process.BeginErrorReadLine();

        try
        {
            await process.WaitForExitAsync(ct);
        }
        catch (OperationCanceledException)
        {
            process.Kill();
            throw;
        }

        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"FFmpeg failed with exit code {process.ExitCode}:\n{errorOutput}");
        }
    }
}
