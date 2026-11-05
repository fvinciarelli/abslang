using AbsLang;
using Xunit;

namespace AbsLang.Tests;

public class AdapterRegistryTests
{
    [Fact]
    public async Task RegistersDefaultAndNamedAdapters()
    {
        var calls = 0;
        AdapterFunction adapter = (trace, rule, ct) =>
        {
            calls++;
            return Task.FromResult(new EvalResult { Type = rule.Type, Passed = true, Score = 1, Reason = "ok" });
        };

        AbsAdapterRegistry.Register("test_default", adapter);
        AbsAdapterRegistry.Register("test_named", adapter, "custom-name");

        var defaultResult = await AbsAdapterRegistry.EvaluateAsync(
            "test_default", Array.Empty<ObservedStep>(), TestData.Rule("test_default"));
        var namedResult = await AbsAdapterRegistry.EvaluateAsync(
            "test_named", Array.Empty<ObservedStep>(), TestData.Rule("test_named"), "custom-name");

        Assert.True(defaultResult!.Passed);
        Assert.True(namedResult!.Passed);
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task ReturnsNullWhenNoDefaultAdapterExists()
    {
        var result = await AbsAdapterRegistry.EvaluateAsync(
            "test_missing", Array.Empty<ObservedStep>(), TestData.Rule("test_missing"));
        Assert.Null(result);
    }

    [Fact]
    public async Task MissingNamedAdapterReturnsExplicitError()
    {
        var result = await AbsAdapterRegistry.EvaluateAsync(
            "test_named_missing", Array.Empty<ObservedStep>(), TestData.Rule("test_named_missing"), "nope");
        Assert.NotNull(result);
        Assert.False(result!.Passed);
        Assert.Equal("adapter.not_configured", result.Code);
    }

    [Fact]
    public void BuiltinJudgeIsRegisteredByDefault()
    {
        Assert.True(AbsAdapterRegistry.HasDefault("llm_judge"));
        Assert.True(AbsAdapterRegistry.HasDefault("Violence"));
        Assert.True(AbsAdapterRegistry.HasDefault("Groundedness"));
    }
}
