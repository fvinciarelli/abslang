using System.Collections.Concurrent;

namespace AbsLang;

/// <summary>
/// Registry of adapter providers (azure, aievaluator, aws, google...).
/// Core providers register themselves; satellite packages register theirs when
/// their Register() method is called. This is what makes
/// <see cref="AbsConfig.ApplyAdapters"/> work across packages.
/// </summary>
public static class AbsAdapterProviders
{
    private static readonly ConcurrentDictionary<string, Action<string?, bool>> Providers =
        new(StringComparer.OrdinalIgnoreCase);

    static AbsAdapterProviders()
    {
        Providers["aievaluator"] = (type, asDefault) =>
        {
            AiEvaluatorAdapter.Register(asDefault: false);
            if (type != null) AbsAdapterRegistry.Register(type, AiEvaluatorAdapter.EvaluateAsync);
            else if (asDefault) AiEvaluatorAdapter.Register(asDefault: true);
        };

        Providers["azure"] = (type, asDefault) =>
        {
            AzureAdapter.Register(asDefault: false);
            if (type != null) AbsAdapterRegistry.Register(type, AzureAdapter.EvaluateAsync);
            else if (asDefault) AzureAdapter.Register(asDefault: true);
        };
    }

    public static void Register(string name, Action<string?, bool> apply) => Providers[name] = apply;

    /// <summary>Apply a provider for a type (or all its supported types when type is null).</summary>
    public static bool Apply(string name, string? type, bool asDefault = true)
    {
        if (!Providers.TryGetValue(name, out var apply)) return false;
        apply(type, asDefault);
        return true;
    }

    public static bool IsRegistered(string name) => Providers.ContainsKey(name);
}
