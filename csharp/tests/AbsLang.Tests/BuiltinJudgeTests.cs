using System.Net;
using System.Net.Http;
using AbsLang;
using Xunit;

namespace AbsLang.Tests;

public class BuiltinJudgeTests
{
    [Fact]
    public void ParsesScoreAndReason()
    {
        var result = BuiltinJudge.ParseJudgeResponse("Score: 0.87\nReason: clear and accurate", "openai", 0.5);
        Assert.True(result.Passed);
        Assert.Equal(0.87, result.Score, 1e-9);
        Assert.Equal("[openai] clear and accurate", result.Reason);
    }

    [Fact]
    public void ClampsOutOfRangeScores()
    {
        Assert.Equal(1.0, BuiltinJudge.ParseJudgeResponse("Score: 2.5\nReason: x", "openai").Score);
        Assert.Equal(0.0, BuiltinJudge.ParseJudgeResponse("Score: 0\nReason: x", "openai").Score);
    }

    [Fact]
    public async Task CallsOpenAiCompatibleJudge()
    {
        var stub = new StubHandler().Json("""{"choices":[{"message":{"content":"Score: 0.9\nReason: good"}}]}""");
        var previous = AbsAdapterHttp.Client;
        AbsAdapterHttp.Client = new HttpClient(stub);
        try
        {
            using var env = new EnvScope(
                ("OPENAI_API_KEY", "sk-test"),
                ("ANTHROPIC_API_KEY", null),
                ("GEMINI_API_KEY", null),
                ("ABS_JUDGE_BASE_URL", null),
                ("ABS_JUDGE_PROVIDER", null),
                ("ABS_MOCK_JUDGE", null));
            BuiltinJudge.Configure(new BuiltinJudgeConfig { BaseUrl = "http://judge/v1" });

            var result = await AbsAdapterRegistry.EvaluateAsync(
                "llm_judge",
                new[] { TestData.Step("assistant", "informs", "hello") },
                TestData.Rule("llm_judge", ("criteria", "Is it friendly?")));

            Assert.NotNull(result);
            Assert.True(result!.Passed);
            Assert.Equal(0.9, result.Score, 1e-9);
            Assert.Equal("http://judge/v1/chat/completions", stub.Requests[0].RequestUri!.ToString());
            Assert.Equal("Bearer sk-test", stub.Requests[0].Headers.Authorization!.ToString());
            Assert.Contains("Is it friendly?", stub.Bodies[0]);
        }
        finally
        {
            AbsAdapterHttp.Client = previous;
            BuiltinJudge.Configure(new BuiltinJudgeConfig());
        }
    }

    [Fact]
    public async Task CallsAnthropicJudge()
    {
        var stub = new StubHandler().Json("""{"content":[{"text":"Score: 0.4\nReason: meh"}]}""");
        var previous = AbsAdapterHttp.Client;
        AbsAdapterHttp.Client = new HttpClient(stub);
        try
        {
            using var env = new EnvScope(
                ("OPENAI_API_KEY", null),
                ("ANTHROPIC_API_KEY", "sk-ant"),
                ("GEMINI_API_KEY", null),
                ("ABS_JUDGE_BASE_URL", null),
                ("ABS_JUDGE_PROVIDER", null),
                ("ABS_JUDGE_MODEL", "claude-test"));
            BuiltinJudge.Configure(new BuiltinJudgeConfig());

            var result = await AbsAdapterRegistry.EvaluateAsync(
                "llm_judge",
                new[] { TestData.Step("assistant", "informs", "hello") },
                TestData.Rule("llm_judge", ("criteria", "quality")));

            Assert.NotNull(result);
            Assert.False(result!.Passed);
            Assert.Equal("sk-ant", stub.Requests[0].Headers.GetValues("x-api-key").Single());
            Assert.Contains("claude-test", stub.Bodies[0]);
        }
        finally
        {
            AbsAdapterHttp.Client = previous;
            BuiltinJudge.Configure(new BuiltinJudgeConfig());
        }
    }

    [Fact]
    public async Task CallsGeminiJudge()
    {
        var stub = new StubHandler().Json("""{"candidates":[{"content":{"parts":[{"text":"Score: 0.8\nReason: solid"}]}}]}""");
        var previous = AbsAdapterHttp.Client;
        AbsAdapterHttp.Client = new HttpClient(stub);
        try
        {
            using var env = new EnvScope(
                ("OPENAI_API_KEY", null),
                ("ANTHROPIC_API_KEY", null),
                ("GEMINI_API_KEY", "gem-key"),
                ("ABS_JUDGE_BASE_URL", null),
                ("ABS_JUDGE_PROVIDER", null),
                ("ABS_JUDGE_MODEL", "gemini-test"));
            BuiltinJudge.Configure(new BuiltinJudgeConfig());

            var result = await AbsAdapterRegistry.EvaluateAsync(
                "llm_judge",
                new[] { TestData.Step("assistant", "informs", "hello") },
                TestData.Rule("llm_judge", ("criteria", "quality")));

            Assert.NotNull(result);
            Assert.True(result!.Passed);
            Assert.Contains("gemini-test", stub.Requests[0].RequestUri!.ToString());
            Assert.Contains("key=gem-key", stub.Requests[0].RequestUri!.ToString());
        }
        finally
        {
            AbsAdapterHttp.Client = previous;
            BuiltinJudge.Configure(new BuiltinJudgeConfig());
        }
    }

    [Fact]
    public async Task MockJudgeNeedsNoApiKey()
    {
        using var env = new EnvScope(
            ("OPENAI_API_KEY", null),
            ("ANTHROPIC_API_KEY", null),
            ("GEMINI_API_KEY", null),
            ("ABS_JUDGE_BASE_URL", null),
            ("ABS_MOCK_JUDGE", "true"));
        BuiltinJudge.Configure(new BuiltinJudgeConfig());

        var result = await AbsAdapterRegistry.EvaluateAsync(
            "llm_judge",
            new[] { TestData.Step("assistant", "informs", "a sufficiently long response") },
            TestData.Rule("llm_judge", ("criteria", "quality")));

        Assert.NotNull(result);
        Assert.True(result!.Passed);
        Assert.Contains("[mock]", result.Reason);
    }

    [Fact]
    public async Task NotConfiguredReturnsHelpfulError()
    {
        using var env = new EnvScope(
            ("OPENAI_API_KEY", null),
            ("ANTHROPIC_API_KEY", null),
            ("GEMINI_API_KEY", null),
            ("ABS_JUDGE_BASE_URL", null),
            ("ABS_MOCK_JUDGE", null));
        BuiltinJudge.Configure(new BuiltinJudgeConfig());

        var result = await AbsAdapterRegistry.EvaluateAsync(
            "llm_judge",
            Array.Empty<ObservedStep>(),
            TestData.Rule("llm_judge"));

        Assert.NotNull(result);
        Assert.False(result!.Passed);
        Assert.Equal("adapter.not_configured", result.Code);
    }

    [Fact]
    public async Task SafetyDimensionsUseCuratedRubric()
    {
        var stub = new StubHandler().Json("""{"choices":[{"message":{"content":"Score: 1\nReason: safe"}}]}""");
        var previous = AbsAdapterHttp.Client;
        AbsAdapterHttp.Client = new HttpClient(stub);
        try
        {
            using var env = new EnvScope(
                ("OPENAI_API_KEY", "sk-test"),
                ("ANTHROPIC_API_KEY", null),
                ("GEMINI_API_KEY", null),
                ("ABS_JUDGE_BASE_URL", "http://judge/v1"),
                ("ABS_JUDGE_PROVIDER", null));
            BuiltinJudge.Configure(new BuiltinJudgeConfig { BaseUrl = "http://judge/v1" });

            var result = await AbsAdapterRegistry.EvaluateAsync(
                "Violence",
                new[] { TestData.Step("assistant", "informs", "hello") },
                TestData.Rule("Violence"));

            Assert.NotNull(result);
            Assert.True(result!.Passed);
            Assert.Contains("free of violent content", stub.Bodies[0]);
        }
        finally
        {
            AbsAdapterHttp.Client = previous;
            BuiltinJudge.Configure(new BuiltinJudgeConfig());
        }
    }
}
