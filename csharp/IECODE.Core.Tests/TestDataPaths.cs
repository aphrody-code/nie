namespace IECODE.Core.Tests;

internal static class TestDataPaths
{
    internal static string GameRoot =>
        Environment.GetEnvironmentVariable("NIE_GAME_DIR") is { Length: > 0 } configured
            ? Path.GetFullPath(configured)
            : FindRepositoryRoot();

    internal static string DataRoot => Path.Combine(GameRoot, "data");

    private static string FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (Directory.Exists(Path.Combine(directory.FullName, "csharp")) &&
                Directory.Exists(Path.Combine(directory.FullName, "src")))
                return directory.FullName;
            directory = directory.Parent;
        }

        return Directory.GetCurrentDirectory();
    }
}
