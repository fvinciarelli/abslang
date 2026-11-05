using System.Text.Json;

namespace AbsLang;

/// <summary>Shared trace helpers for evaluator adapters.</summary>
public static class AbsTrace
{
    public static readonly HashSet<string> CommunicationActions = new(StringComparer.Ordinal)
    {
        "says", "asks", "informs", "greets", "responds", "clarifies",
        "confirms", "rejects", "suggests", "shows", "hands_off",
    };

    private static readonly Dictionary<string, string> DefaultActions = new(StringComparer.Ordinal)
    {
        ["user"] = "says",
        ["assistant"] = "informs",
        ["tool"] = "responds",
    };

    public static string ToText(object? content)
    {
        if (content == null) return "";
        if (content is string text) return text;
        try
        {
            return JsonSerializer.Serialize(content);
        }
        catch
        {
            return content.ToString() ?? "";
        }
    }

    /// <summary>Readable transcript for LLM judges. Tool calls show their arguments.</summary>
    public static string TraceToText(IReadOnlyList<ObservedStep> trace)
    {
        return string.Join("\n", trace.Select(step =>
        {
            var head = $"[{step.Actor}] {step.Action}{(step.Target != null ? " → " + step.Target : "")}";
            string? payload = null;
            if (step.Content != null) payload = ToText(step.Content);
            else if (step.With is { Count: > 0 }) payload = ToText(step.With);
            return payload != null ? $"{head}: {payload}" : head;
        }));
    }

    /// <summary>
    /// Resolve `self`, `id.action`, or legacy `actor.action` references against the trace.
    /// </summary>
    public static string ResolveRef(IReadOnlyList<ObservedStep> trace, string? reference, string selfContent = "")
    {
        if (string.IsNullOrEmpty(reference)) return "";
        if (reference == "self") return selfContent;

        var dot = reference!.IndexOf('.');
        var refId = dot >= 0 ? reference.Substring(0, dot) : reference;
        var action = dot >= 0 ? reference.Substring(dot + 1) : null;

        foreach (var step in trace)
        {
            if (step.Id != refId) continue;
            var wanted = action ?? (DefaultActions.TryGetValue(step.Actor, out var value) ? value : "says");
            if (step.Action != wanted) continue;
            return ToText(step.Content);
        }

        var legacyWanted = action ?? (DefaultActions.TryGetValue(refId, out var fallback) ? fallback : "says");
        foreach (var step in trace)
        {
            if (step.Actor != refId) continue;
            var matches = step.Action == legacyWanted ||
                          (CommunicationActions.Contains(step.Action) && CommunicationActions.Contains(legacyWanted));
            if (matches) return ToText(step.Content);
        }

        return reference;
    }

    /// <summary>Convert the trace into an OpenAI-style message list.</summary>
    public static List<Dictionary<string, object?>> TraceToMessages(
        IReadOnlyList<ObservedStep> trace,
        string toolCallPrefix = "call_abs_")
    {
        var messages = new List<Dictionary<string, object?>>();
        var pendingIds = new Queue<string>();
        var sequence = 0;
        string NextId() => toolCallPrefix + sequence++;

        var index = 0;
        while (index < trace.Count)
        {
            var step = trace[index];

            if (step.Actor == "assistant" && step.Action == "calls")
            {
                var contentItems = new List<object?>();
                while (index < trace.Count && trace[index].Actor == "assistant" && trace[index].Action == "calls")
                {
                    var call = trace[index];
                    var id = call.ToolCallId ?? NextId();
                    contentItems.Add(new Dictionary<string, object?>
                    {
                        ["type"] = "tool_call",
                        ["tool_call_id"] = id,
                        ["name"] = call.Target ?? "",
                        ["arguments"] = call.With ?? new Dictionary<string, object?>(),
                    });
                    pendingIds.Enqueue(id);
                    index++;
                }
                messages.Add(new Dictionary<string, object?>
                {
                    ["role"] = "assistant",
                    ["content"] = contentItems,
                });
                continue;
            }

            if (step.Actor == "tool")
            {
                var id = step.ToolCallId;
                if (id == null && pendingIds.Count > 0) id = pendingIds.Dequeue();
                id ??= NextId();
                messages.Add(new Dictionary<string, object?>
                {
                    ["role"] = "tool",
                    ["tool_call_id"] = id,
                    ["content"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["type"] = "tool_result",
                            ["tool_result"] = step.Content ?? "",
                        },
                    },
                });
                index++;
                continue;
            }

            if (step.Actor is "user" or "system")
            {
                messages.Add(new Dictionary<string, object?>
                {
                    ["role"] = step.Actor,
                    ["content"] = ToText(step.Content),
                });
            }
            else if (step.Actor == "assistant")
            {
                messages.Add(new Dictionary<string, object?>
                {
                    ["role"] = "assistant",
                    ["content"] = ToText(step.Content),
                });
            }

            index++;
        }

        return messages;
    }

    public static (List<Dictionary<string, object?>> Query, List<Dictionary<string, object?>> Response)
        TraceToConversation(IReadOnlyList<ObservedStep> trace, string toolCallPrefix = "call_abs_")
    {
        var query = new List<Dictionary<string, object?>>();
        var response = new List<Dictionary<string, object?>>();
        foreach (var message in TraceToMessages(trace, toolCallPrefix))
        {
            var role = message["role"]?.ToString();
            if (role is "system" or "user") query.Add(message);
            else response.Add(message);
        }
        return (query, response);
    }

    public static List<ObservedStep> ExtractToolCalls(IReadOnlyList<ObservedStep> trace) =>
        trace.Where(step => step.Actor == "assistant" && step.Action == "calls").ToList();

    public static List<string> ExtractToolTrajectory(IReadOnlyList<ObservedStep> trace) =>
        ExtractToolCalls(trace)
            .Select(step => step.Target)
            .Where(target => target != null)
            .Select(target => target!)
            .ToList();
}
