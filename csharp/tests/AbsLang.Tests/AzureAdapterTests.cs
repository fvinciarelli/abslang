using System.Net.Http;
using AbsLang;
using Xunit;

namespace AbsLang.Tests;

public class AzureAdapterTests
{
    [Fact]
    public async Task LlmJudgeUsesAzureChatCompletions()
    {
        var stub = new StubHandler().Json("""{"choices":[{"message":{"content":"Score: 0.8\nReason: ok"}}]}""");
        var previous = AbsAdapterHttp.Client;
        AbsAdapterHttp.Client = new HttpClient(stub);
        try
        {
            AzureAdapter.Configure("http://azure", "key", "judge", "2024-02-15-preview");
            var result = await AzureAdapter.EvaluateAsync(
                new[] { TestData.Step("assistant", "informs", "hello") },
                TestData.Rule("llm_judge", ("criteria", "helpful")));

            Assert.True(result.Passed);
            Assert.Equal(0.8, result.Score, 1e-9);
            Assert.Equal("azure", result.Adapter);
            Assert.Contains("/openai/deployments/judge/chat/completions", stub.Requests[0].RequestUri!.ToString());
            Assert.Equal("key", stub.Requests[0].Headers.GetValues("api-key").Single());
            Assert.Contains("helpful", stub.Bodies[0]);
        }
        finally
        {
            AbsAdapterHttp.Client = previous;
        }
    }

    [Fact]
    public async Task DimensionNormalizesLikertScore()
    {
        var stub = new StubHandler().Json("""{"choices":[{"message":{"content":"{\"score\":4,\"reason\":\"good\"}"}}]}""");
        var previous = AbsAdapterHttp.Client;
        AbsAdapterHttp.Client = new HttpClient(stub);
        try
        {
            AzureAdapter.Configure("http://azure", "key", "judge", "2024-02-15-preview");
            var result = await AzureAdapter.EvaluateAsync(
                new[] { TestData.Step("assistant", "informs", "hello") },
                TestData.Rule("Relevance", ("query", "q"), ("response", "hello"), ("threshold", 0.7)));

            Assert.True(result.Passed);
            Assert.Equal(0.8, result.Score, 1e-9);
            Assert.Contains("[azure]", result.Reason);
        }
        finally
        {
            AbsAdapterHttp.Client = previous;
        }
    }

    [Fact]
    public async Task NotConfiguredIsExplicit()
    {
        using var env = new EnvScope(
            ("AZURE_OPENAI_ENDPOINT", null),
            ("AZURE_OPENAI_KEY", null),
            ("AZURE_OPENAI_DEPLOYMENT", null));
        AzureAdapter.Configure(new AzureAdapterConfig());
        var result = await AzureAdapter.EvaluateAsync(
            Array.Empty<ObservedStep>(),
            TestData.Rule("llm_judge"));

        Assert.False(result.Passed);
        Assert.Equal("adapter.not_configured", result.Code);
    }

    [Fact]
    public async Task CustomRequiresCriteria()
    {
        AzureAdapter.Configure("http://azure", "key", "judge", "2024-02-15-preview");
        var result = await AzureAdapter.EvaluateAsync(
            Array.Empty<ObservedStep>(),
            TestData.Rule("custom", ("id", "made-up")));

        Assert.False(result.Passed);
        Assert.Equal("evaluator.missing_input", result.Code);
    }
}
