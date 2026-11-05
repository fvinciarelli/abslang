using System.Diagnostics;
using System.Text.Json;

namespace AbsLang;

public sealed class AbsLogOptions
{
    public string Level { get; set; } = "info";
    /// <summary>pretty, jsonl or silent.</summary>
    public string Format { get; set; } = "silent";
    public string? File { get; set; }
    public bool IncludeContent { get; set; } = true;
    public Dictionary<string, object?> Meta { get; set; } = new(StringComparer.Ordinal);
}

/// <summary>Structured event logging (pretty stderr, JSONL file, or silent).</summary>
public static class AbsLog
{
    private static readonly object Gate = new();
    private static AbsLogOptions _options = new();
    private static readonly Dictionary<string, int> Levels = new(StringComparer.Ordinal)
    {
        ["debug"] = 10,
        ["info"] = 20,
        ["warn"] = 30,
        ["warning"] = 30,
        ["error"] = 40,
    };

    public static void Configure(AbsLogOptions? options = null)
    {
        lock (Gate)
        {
            _options = options ?? new AbsLogOptions();
            if (_options.File != null)
            {
                var directory = Path.GetDirectoryName(Path.GetFullPath(_options.File));
                if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                File.WriteAllText(_options.File, "");
            }
        }
    }

    public static void Close()
    {
        lock (Gate) _options = new AbsLogOptions();
    }

    public static bool Enabled => _options.Format != "silent";

    public static bool ContentEnabled => _options.IncludeContent;

    public static string NewRunId() => "r_" + Guid.NewGuid().ToString("N").Substring(0, 12);

    internal static bool ShouldLog(string level)
    {
        if (!Enabled) return false;
        var configured = Levels.TryGetValue(_options.Level.ToLowerInvariant(), out var value) ? value : 20;
        var current = Levels.TryGetValue(level.ToLowerInvariant(), out var severity) ? severity : 20;
        return current >= configured;
    }

    internal static void Write(string level, string eventName, IReadOnlyDictionary<string, object?> fields)
    {
        if (!ShouldLog(level)) return;

        var record = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["v"] = 1,
            ["ts"] = DateTime.UtcNow.ToString("o"),
            ["level"] = level,
            ["event"] = eventName,
        };
        foreach (var pair in _options.Meta) record[pair.Key] = pair.Value;
        foreach (var pair in fields) record[pair.Key] = pair.Value;

        lock (Gate)
        {
            if (_options.File != null)
            {
                File.AppendAllText(_options.File, JsonSerializer.Serialize(record) + Environment.NewLine);
            }
            else if (_options.Format == "pretty")
            {
                var details = string.Join(" ", fields.Select(pair => $"{pair.Key}={FormatValue(pair.Value)}"));
                Console.Error.WriteLine($"→ {eventName} {details}".TrimEnd());
            }
        }
    }

    private static string FormatValue(object? value)
    {
        var text = value?.ToString() ?? "null";
        return text.Length <= 80 ? text : text.Substring(0, 80) + "…";
    }
}

/// <summary>
/// Per-run logger. Wire <see cref="Sink"/> to capture events in tests or to
/// forward them to your own telemetry pipeline.
/// </summary>
public sealed class RunLogger
{
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private readonly Dictionary<string, object?> _meta;

    public RunLogger(
        string? session = null,
        string? agent = null,
        string? runId = null,
        bool? includeContent = null)
    {
        RunId = runId ?? AbsLog.NewRunId();
        _meta = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["run_id"] = RunId,
        };
        if (session != null) _meta["session"] = session;
        if (agent != null) _meta["agent"] = agent;
        IncludeContent = includeContent ?? AbsLog.ContentEnabled;
    }

    public string RunId { get; }
    public bool IncludeContent { get; set; }

    /// <summary>Receives (eventName, fields). Invoked before the global log sink.</summary>
    public Action<string, IReadOnlyDictionary<string, object?>>? Sink { get; set; }

    public long ElapsedMs() => _clock.ElapsedMilliseconds;

    public void Event(string name, IReadOnlyDictionary<string, object?>? fields = null)
    {
        var record = new Dictionary<string, object?>(_meta, StringComparer.Ordinal);
        if (fields != null)
        {
            foreach (var pair in fields) record[pair.Key] = pair.Value;
        }

        Sink?.Invoke(name, record);
        AbsLog.Write("info", name, record);
    }

    public void Event(string name, params (string Key, object? Value)[] fields)
    {
        var map = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var field in fields) map[field.Key] = field.Value;
        Event(name, map);
    }
}
