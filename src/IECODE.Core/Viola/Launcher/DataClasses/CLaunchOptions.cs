using Viola.Core.Pack.DataClasses;

namespace Viola.Core.Launcher.DataClasses;

public class CLaunchOptions
{
    public Mode Mode { get; set; }
    public Platform PackPlatform { get; set; }
    public string InputPath { get; set; } = string.Empty;
    public string OutputPath { get; set; } = string.Empty;
    public string HashCachePath { get; set; } = string.Empty;
    public string CpkListPath { get; set; } = string.Empty;
    public bool ClearOutputBeforePack { get; set; }

    //for the merge command
    public List<string> StuffToMerge = new();
}