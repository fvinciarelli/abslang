namespace AbsLang;

public static partial class AbsEvaluators
{
    static AbsEvaluators()
    {
        BuiltinJudge.Register();
    }

    /// <summary>Register an adapter. With a name it is selectable per rule via `adapter:`.</summary>
    public static void RegisterAdapter(string type, AdapterFunction fn, string? name = null) =>
        AbsAdapterRegistry.Register(type, fn, name);

    /// <summary>
    /// Try the registered adapter first. Returns null when no default adapter
    /// exists for the type, so the caller can fall back to the built-ins.
    /// </summary>
    public static Task<EvalResult?> EvaluateWithAdapterAsync(
        string type,
        IReadOnlyList<ObservedStep> trace,
        Evaluation evaluation,
        string? adapterName = null,
        CancellationToken cancellationToken = default) =>
        AbsAdapterRegistry.EvaluateAsync(type, trace, evaluation, adapterName, cancellationToken);

    public static void ConfigureBuiltinJudge(BuiltinJudgeConfig? config = null) =>
        BuiltinJudge.Configure(config);

    public static void ConfigureBuiltinJudge(
        string baseUrl,
        string? apiKey = null,
        string? apiKeyHeader = null,
        string? model = null) =>
        BuiltinJudge.Configure(new BuiltinJudgeConfig
        {
            BaseUrl = baseUrl,
            ApiKey = apiKey,
            ApiKeyHeader = apiKeyHeader,
            Model = model,
        });
}
