using System.Text.Json.Serialization;

namespace AbsLang;

// ── Document model ────────────────────────────────────────────────────────────

public sealed class Behavior
{
    public string? Id { get; set; }
    public string Actor { get; set; } = "";
    public string Action { get; set; } = "";
    public string? Target { get; set; }
    public object? Content { get; set; }
    public Dictionary<string, object?>? Capture { get; set; }
    public Dictionary<string, object?>? With { get; set; }
    public Dictionary<string, object?>? WithOnly { get; set; }
    public List<Evaluation>? Evaluations { get; set; }

    // v0.2 — optional behaviors
    public bool Optional { get; set; }
    public string? Requires { get; set; }
    public MatchesWhen? MatchesWhen { get; set; }
}

public sealed class MatchesWhen
{
    public string Type { get; set; } = "";
    public string? Criteria { get; set; }
    public string? Value { get; set; }
    public string? Pattern { get; set; }
}

public sealed class Evaluation
{
    /// <summary>All raw fields of the evaluation rule (type, value, criteria, ...).</summary>
    public Dictionary<string, object?> Data { get; } = new(StringComparer.Ordinal);

    public string Type
    {
        get => GetString("type") ?? "";
        set => Data["type"] = value;
    }

    public bool Blocking
    {
        get => Get("blocking") is bool b && b;
        set => Data["blocking"] = value;
    }

    public double? Threshold
    {
        get => ToDouble(Get("threshold"));
        set => Data["threshold"] = value;
    }

    public string? Adapter
    {
        get => GetString("adapter");
        set => Data["adapter"] = value;
    }

    public object? Get(string key) => Data.TryGetValue(key, out var value) ? value : null;

    public string? GetString(string key) => Get(key)?.ToString();

    public double? GetDouble(string key) => ToDouble(Get(key));

    public bool? GetBool(string key) => Get(key) is bool b ? b : (bool?)null;

    public IReadOnlyList<object?>? GetList(string key) => Get(key) as IReadOnlyList<object?>;

    public Dictionary<string, object?>? GetMap(string key) => Get(key) as Dictionary<string, object?>;

    internal static double? ToDouble(object? value)
    {
        if (value is null) return null;
        if (value is double d) return d;
        if (value is float f) return f;
        if (value is long l) return l;
        if (value is int i) return i;
        if (value is decimal m) return (double)m;
        return double.TryParse(Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture),
            System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture, out var parsed) ? parsed : null;
    }
}

public sealed class DatasetDefinition
{
    public string Id { get; set; } = "";
    public string Path { get; set; } = "";
}

public sealed class BehaviorEntry
{
    public Behavior? Behavior { get; set; }
    public string? Include { get; set; }

    public static implicit operator BehaviorEntry(Behavior behavior) => new() { Behavior = behavior };
}

public sealed class AbsDocument
{
    public string Session { get; set; } = "";
    public string? Description { get; set; }
    public string? AbsVersion { get; set; }
    public DatasetDefinition? Dataset { get; set; }
    public List<BehaviorEntry> Behaviors { get; set; } = new();
    public Dictionary<string, List<Behavior>>? Fragments { get; set; }
    public List<Evaluation>? Evaluations { get; set; }
}

public sealed class NormalizedSession
{
    public string Session { get; set; } = "";
    public string? Description { get; set; }
    public string? AbsVersion { get; set; }
    public DatasetDefinition? Dataset { get; set; }
    public List<Behavior> Behaviors { get; set; } = new();
    public List<Evaluation>? Evaluations { get; set; }
}

public sealed class Selector
{
    public string? Actor { get; set; }
    public string? Action { get; set; }
    public string? Target { get; set; }
}

// ── Runner model ──────────────────────────────────────────────────────────────

public sealed class ToolCall
{
    public string Id { get; set; } = "";
    public string Type { get; set; } = "function";
    public ToolCallFunction Function { get; set; } = new();
}

public sealed class ToolCallFunction
{
    public string Name { get; set; } = "";
    public string Arguments { get; set; } = "";
}

public sealed class AgentMessage
{
    public string Role { get; set; } = "";
    public string? Content { get; set; }
    public List<ToolCall>? ToolCalls { get; set; }
    public string? ToolCallId { get; set; }
    public string? Name { get; set; }
}

public sealed class AgentResponse
{
    public List<AgentMessage> Messages { get; set; } = new();
    public object? Raw { get; set; }
}

public sealed class AgentConfig
{
    public string Url { get; set; } = "";
    /// <summary>openai, responses, claude or gemini.</summary>
    public string Format { get; set; } = "openai";
    /// <summary>none, api_key, bearer or oauth2.</summary>
    public string Auth { get; set; } = "none";
    public string? Token { get; set; }
    public string? Model { get; set; }
    public bool ForwardAuth { get; set; }
    public string? Authorization { get; set; }
    public string? RefreshUrl { get; set; }
    public string? RefreshToken { get; set; }
    public string? ClientId { get; set; }
    public bool? Stream { get; set; }
    public int TimeoutSeconds { get; set; } = 300;
}

public sealed class ObservedStep
{
    public string? Id { get; set; }
    public string Actor { get; set; } = "";
    public string Action { get; set; } = "";
    public string? Target { get; set; }
    public object? Content { get; set; }
    public Dictionary<string, object?>? With { get; set; }
    public string? ToolCallId { get; set; }
}

public sealed class EvalResult
{
    public string Type { get; set; } = "";
    public bool Passed { get; set; }
    public double Score { get; set; }
    public string Reason { get; set; } = "";
    public string? Code { get; set; }
    public object? Details { get; set; }
    public double? Threshold { get; set; }
    public string? Adapter { get; set; }
    public bool Blocking { get; set; }
    public bool Inconclusive { get; set; }
    public long? DurationMs { get; set; }
}

public sealed class StepResult
{
    public int Step { get; set; }
    public Behavior Behavior { get; set; } = new();
    public ObservedStep? Observed { get; set; }
    public bool Matched { get; set; }
    public bool Skipped { get; set; }
    public List<EvalResult> Evaluations { get; set; } = new();
    public bool Sent { get; set; }
}

public sealed class RunResult
{
    public string Session { get; set; } = "";
    public string Agent { get; set; } = "";
    public bool Passed { get; set; }
    public List<StepResult> Steps { get; set; } = new();
    public List<EvalResult> ChainEvaluations { get; set; } = new();
    public int StepsTotal { get; set; }
    public int StepsMatched { get; set; }
    public int EvaluationsTotal { get; set; }
    public int EvaluationsPassed { get; set; }
}

// ── Errors ────────────────────────────────────────────────────────────────────

public class AbsException : Exception
{
    public AbsException(string message) : base(message) { }
    public AbsException(string message, Exception inner) : base(message, inner) { }
}

public sealed class AbsParseException : AbsException
{
    public IReadOnlyList<string> Errors { get; }
    public AbsParseException(string message, IReadOnlyList<string>? errors = null)
        : base(errors is { Count: > 0 } ? message + "\n" + string.Join("\n", errors) : message)
    {
        Errors = errors ?? Array.Empty<string>();
    }
}

public sealed class AbsValidationException : AbsException
{
    public IReadOnlyList<string> Errors { get; }
    public AbsValidationException(IReadOnlyList<string> errors)
        : base("Invalid ABS document:\n" + string.Join("\n", errors))
    {
        Errors = errors;
    }
}
