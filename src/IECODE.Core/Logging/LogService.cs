using System.Collections.Concurrent;
using System.Runtime.InteropServices;

namespace IECODE.Core.Logging;

/// <summary>
/// Simple logging service for IECODE.
/// AOT-compatible, thread-safe logging with in-memory buffer and optional file output.
/// </summary>
public sealed class LogService : IDisposable
{
    #region Singleton

    private static readonly Lazy<LogService> _instance = new(() => new LogService());

    /// <summary>
    /// Gets the singleton instance of the log service.
    /// </summary>
    public static LogService Instance => _instance.Value;

    #endregion

    #region Fields

    private readonly ConcurrentQueue<LogEntry> _entries = new();
    private readonly object _fileLock = new();
    private StreamWriter? _fileWriter;
    private bool _disposed;
    private int _maxEntries = 1000;
    private const int MAX_LOG_FILES = 10;
    private const int LOG_RETENTION_DAYS = 7;

    #endregion

    #region Events

    /// <summary>
    /// Raised when a new log entry is added.
    /// </summary>
    public event Action<LogEntry>? LogAdded;

    #endregion

    #region Properties

    /// <summary>
    /// Gets or sets the maximum number of entries to keep in memory.
    /// </summary>
    public int MaxEntries
    {
        get => _maxEntries;
        set => _maxEntries = Math.Max(100, value);
    }

    /// <summary>
    /// Gets or sets the minimum log level to record.
    /// </summary>
    public LogLevel MinLevel { get; set; } = LogLevel.Debug;

    /// <summary>
    /// Gets all log entries.
    /// </summary>
    public IEnumerable<LogEntry> Entries => _entries.ToArray();

    /// <summary>
    /// Gets the current log file path, if any.
    /// </summary>
    public string? LogFilePath { get; private set; }

    /// <summary>
    /// Gets the log folder path.
    /// </summary>
    public string LogFolder { get; private set; } = string.Empty;

    #endregion

    #region Constructor

    private LogService()
    {
        // Initialize with app data folder
        LogFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "IECODE", "Logs");

        Directory.CreateDirectory(LogFolder);
        LogFilePath = Path.Combine(LogFolder, $"iecode_{DateTime.Now:yyyyMMdd_HHmmss}.log");

        try
        {
            _fileWriter = new StreamWriter(LogFilePath, append: true) { AutoFlush = true };

            // Clean old log files
            CleanOldLogs();

            // Log system info at startup
            LogSystemInfo();
        }
        catch
        {
            // File logging disabled if creation fails
            LogFilePath = null;
        }
    }

    #endregion

    #region System Info

    private void LogSystemInfo()
    {
        Info("System", $"IECODE Desktop started");
        Info("System", $"OS: {RuntimeInformation.OSDescription}");
        Info("System", $"Architecture: {RuntimeInformation.OSArchitecture}");
        Info("System", $".NET: {RuntimeInformation.FrameworkDescription}");
        Info("System", $"Process: {Environment.ProcessId}");
        Info("System", $"Working Dir: {Environment.CurrentDirectory}");
    }

    /// <summary>
    /// Registers global exception handlers for unhandled exceptions.
    /// Call this early in application startup.
    /// </summary>
    public void RegisterGlobalExceptionHandlers()
    {
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            if (e.ExceptionObject is Exception ex)
            {
                Error("FATAL", "Unhandled exception", ex);
                Flush();
            }
        };

        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            Error("Task", "Unobserved task exception", e.Exception);
            e.SetObserved(); // Prevent crash
        };

        Info("System", "Global exception handlers registered");
    }

    #endregion

    #region Logging Methods

    /// <summary>
    /// Logs a debug message.
    /// </summary>
    public void Debug(string source, string message)
        => Log(LogLevel.Debug, source, message);

    /// <summary>
    /// Logs an info message.
    /// </summary>
    public void Info(string source, string message)
        => Log(LogLevel.Info, source, message);

    /// <summary>
    /// Logs a warning message.
    /// </summary>
    public void Warn(string source, string message)
        => Log(LogLevel.Warning, source, message);

    /// <summary>
    /// Logs an error message.
    /// </summary>
    public void Error(string source, string message)
        => Log(LogLevel.Error, source, message);

    /// <summary>
    /// Logs an error with exception details.
    /// </summary>
    public void Error(string source, string message, Exception ex)
        => Log(LogLevel.Error, source, $"{message}: {ex.Message}\n{ex.StackTrace}");

    /// <summary>
    /// Logs a success message.
    /// </summary>
    public void Success(string source, string message)
        => Log(LogLevel.Success, source, message);

    /// <summary>
    /// Logs a message with the specified level.
    /// </summary>
    public void Log(LogLevel level, string source, string message)
    {
        if (level < MinLevel) return;

        var entry = new LogEntry
        {
            Timestamp = DateTime.Now,
            Level = level,
            Source = source,
            Message = message
        };

        _entries.Enqueue(entry);

        // Trim old entries
        while (_entries.Count > MaxEntries && _entries.TryDequeue(out _)) { }

        // Write to file
        WriteToFile(entry);

        // Write to console in debug
#if DEBUG
        Console.WriteLine(entry.ToDisplayString());
#endif

        // Notify listeners
        LogAdded?.Invoke(entry);
    }

    #endregion

    #region File Operations

    private void WriteToFile(LogEntry entry)
    {
        if (_fileWriter == null) return;

        lock (_fileLock)
        {
            try
            {
                _fileWriter.WriteLine(entry.ToFileString());
            }
            catch
            {
                // Ignore file write errors
            }
        }
    }

    /// <summary>
    /// Flushes all pending log entries to file.
    /// </summary>
    public void Flush()
    {
        lock (_fileLock)
        {
            try
            {
                _fileWriter?.Flush();
            }
            catch { }
        }
    }

    /// <summary>
    /// Cleans old log files (older than retention period or exceeding max count).
    /// </summary>
    private void CleanOldLogs()
    {
        try
        {
            var logFiles = Directory.GetFiles(LogFolder, "iecode_*.log")
                .Select(f => new FileInfo(f))
                .OrderByDescending(f => f.CreationTime)
                .ToList();

            // Delete files older than retention period
            var cutoffDate = DateTime.Now.AddDays(-LOG_RETENTION_DAYS);
            foreach (var file in logFiles.Where(f => f.CreationTime < cutoffDate))
            {
                try { file.Delete(); } catch { }
            }

            // Keep only MAX_LOG_FILES most recent
            foreach (var file in logFiles.Skip(MAX_LOG_FILES))
            {
                try { file.Delete(); } catch { }
            }

            Debug("LogService", $"Log cleanup: kept {Math.Min(logFiles.Count, MAX_LOG_FILES)} files");
        }
        catch
        {
            // Ignore cleanup errors
        }
    }

    /// <summary>
    /// Opens the log folder in file explorer.
    /// </summary>
    public void OpenLogFolder()
    {
        if (string.IsNullOrEmpty(LogFolder) || !Directory.Exists(LogFolder)) return;

        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
        {
            FileName = LogFolder,
            UseShellExecute = true
        });
    }

    /// <summary>
    /// Opens the current log file in default text editor.
    /// </summary>
    public void OpenCurrentLog()
    {
        if (string.IsNullOrEmpty(LogFilePath) || !File.Exists(LogFilePath)) return;

        Flush();
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
        {
            FileName = LogFilePath,
            UseShellExecute = true
        });
    }

    /// <summary>
    /// Clears all log entries from memory.
    /// </summary>
    public void Clear()
    {
        while (_entries.TryDequeue(out _)) { }
        Info("LogService", "Log cleared");
    }

    /// <summary>
    /// Exports logs to a file.
    /// </summary>
    public async Task ExportAsync(string filePath)
    {
        await using var writer = new StreamWriter(filePath);
        foreach (var entry in _entries)
        {
            await writer.WriteLineAsync(entry.ToFileString());
        }
        Info("LogService", $"Logs exported to: {filePath}");
    }

    /// <summary>
    /// Gets the size of all log files in bytes.
    /// </summary>
    public long GetTotalLogSize()
    {
        try
        {
            return Directory.GetFiles(LogFolder, "iecode_*.log")
                .Select(f => new FileInfo(f))
                .Sum(f => f.Length);
        }
        catch
        {
            return 0;
        }
    }

    #endregion

    #region IDisposable

    public void Dispose()
    {
        if (_disposed) return;

        Info("System", "IECODE Desktop shutting down");
        Flush();

        lock (_fileLock)
        {
            _fileWriter?.Dispose();
            _fileWriter = null;
        }

        _disposed = true;
    }

    #endregion
}

/// <summary>
/// Log entry structure.
/// </summary>
public readonly struct LogEntry
{
    public DateTime Timestamp { get; init; }
    public LogLevel Level { get; init; }
    public string Source { get; init; }
    public string Message { get; init; }

    public string ToDisplayString()
        => $"[{Timestamp:HH:mm:ss}] [{Level}] [{Source}] {Message}";

    public string ToFileString()
        => $"{Timestamp:yyyy-MM-dd HH:mm:ss.fff} | {Level,-7} | {Source,-20} | {Message}";

    public override string ToString() => ToDisplayString();
}

/// <summary>
/// Log levels.
/// </summary>
public enum LogLevel
{
    Debug = 0,
    Info = 1,
    Success = 2,
    Warning = 3,
    Error = 4
}
