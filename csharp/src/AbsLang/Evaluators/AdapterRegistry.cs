using System.Collections.Concurrent;

namespace AbsLang;

public delegate Task<EvalResult> AdapterFunction(
    IReadOnlyList<ObservedStep> trace,
    Evaluation evaluation,
    CancellationToken cancellationToken = default);

/// <summary>Thread-safe registry for LLM/cloud evaluator adapters.</summary>
public static class AbsAdapterRegistry
{
    private static readonly ConcurrentDictionary<string, AdapterFunction> Defaults =
        new(StringComparer.Ordinal);

    private static readonly ConcurrentDictionary<string, AdapterFunction> Named =
        new(StringComparer.Ordinal);

    static AbsAdapterRegistry()
    {
        // The built-in judge is always available as the default for LLM types.
        foreach (var type in new[]
                 {
                     "llm_judge", "g_eval", "faithfulness",
                     "Groundedness", "Relevance", "Coherence", "Fluency",
                     "HateUnfairness", "Violence", "Sexual", "SelfHarm",
                 })
        {
            Defaults[type] = BuiltinJudge.JudgeAsync;
        }
    }

    private static string Key(string type, string name) => type + "\u0000" + name;

    public static void Register(string type, AdapterFunction fn, string? name = null)
    {
        if (name != null) Named[Key(type, name)] = fn;
        else Defaults[type] = fn;
    }

    public static async Task<EvalResult?> EvaluateAsync(
        string type,
        IReadOnlyList<ObservedStep> trace,
        Evaluation evaluation,
        string? adapterName = null,
        CancellationToken cancellationToken = default)
    {
        if (adapterName != null)
        {
            if (Named.TryGetValue(Key(type, adapterName), out var named))
            {
                return await named(trace, evaluation, cancellationToken).ConfigureAwait(false);
            }

            return new EvalResult
            {
                Type = type,
                Passed = false,
                Score = 0,
                Code = "adapter.not_configured",
                Reason =
                    $"Adapter '{adapterName}' is not registered for '{type}'. " +
                    $"Register it with AbsAdapterRegistry.Register(\"{type}\", fn, \"{adapterName}\").",
            };
        }

        if (Defaults.TryGetValue(type, out var adapter))
        {
            return await adapter(trace, evaluation, cancellationToken).ConfigureAwait(false);
        }

        return null;
    }

    public static bool HasDefault(string type) => Defaults.ContainsKey(type);

    public static bool HasNamed(string type, string name) => Named.ContainsKey(Key(type, name));

    /// <summary>Remove all registrations (tests / advanced host scenarios).</summary>
    public static void Clear()
    {
        Defaults.Clear();
        Named.Clear();
    }
}

/// <summary>HTTP client shared by the built-in judge and the cloud adapters.</summary>
public static class AbsAdapterHttp
{
    public static HttpClient Client { get; set; } = new() { Timeout = TimeSpan.FromSeconds(120) };
}
