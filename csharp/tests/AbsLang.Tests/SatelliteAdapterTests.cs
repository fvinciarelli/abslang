using AbsLang;
using AbsLang.Adapters.Aws;
using AbsLang.Adapters.Google;
using Xunit;

namespace AbsLang.Tests;

public class SatelliteAdapterTests
{
    [Fact]
    public async Task AwsLlmJudgeUsesConverseOverride()
    {
        AwsAdapter.Configure(new AwsAdapterConfig
        {
            ConverseOverride = (system, prompt, ct) => Task.FromResult("Score: 0.8\nReason: good"),
        });

        var result = await AwsAdapter.EvaluateAsync(
            new[] { TestData.Step("assistant", "informs", "hello") },
            TestData.Rule("llm_judge", ("criteria", "helpful")));

        Assert.True(result.Passed);
        Assert.Equal(0.8, result.Score, 1e-9);
        Assert.Equal("aws", result.Adapter);
        Assert.Contains("[aws]", result.Reason);
    }

    [Fact]
    public async Task AwsCustomNormalizesRatingScale()
    {
        AwsAdapter.Configure(new AwsAdapterConfig
        {
            ConverseOverride = (system, prompt, ct) => Task.FromResult("Score: 4\nReason: good"),
        });

        var result = await AwsAdapter.EvaluateAsync(
            new[] { TestData.Step("assistant", "informs", "hello") },
            TestData.Rule("custom",
                ("id", "quality"),
                ("prompt", "rate this: {{response}}"),
                ("rating_scale", "1-5"),
                ("threshold", 0.7)));

        Assert.True(result.Passed);
        Assert.Equal(0.8, result.Score, 1e-9);
        Assert.Contains("[aws:quality]", result.Reason);
    }

    [Theory]
    [InlineData("1-5", 5)]
    [InlineData("0-1", 1)]
    [InlineData("5", 5)]
    public void AwsScaleMax(string scale, int expected) => Assert.Equal(expected, AwsAdapter.ScaleMax(scale));

    [Theory]
    [InlineData(4.0, 5, 0.8)]
    [InlineData(1.0, 1, 1.0)]
    [InlineData(6.0, 5, 1.0)]
    public void AwsNormalize(double value, int scale, double expected) =>
        Assert.Equal(expected, AwsAdapter.Normalize(value, scale), 1e-9);

    [Fact]
    public void AwsParseJudgeResponse()
    {
        var (score, reason) = AwsAdapter.ParseJudgeResponse("Score: 0.75\nReason: solid");
        Assert.Equal(0.75, score);
        Assert.Equal("solid", reason);
    }

    [Fact]
    public void AwsInterpolate()
    {
        var trace = new[] { TestData.Step("assistant", "informs", "hello") };
        var result = AwsAdapter.Interpolate("{{criteria}} / {{response}}", TestData.Rule("custom"),
            trace, "hello");
        Assert.Equal(" / hello", result);
    }

    [Fact]
    public async Task GoogleLlmJudgeUsesGenerateOverride()
    {
        GoogleAdapter.Configure(new GoogleAdapterConfig
        {
            GenerateOverride = (prompt, ct) => Task.FromResult("{\"score\":4,\"explanation\":\"good\"}"),
        });

        var result = await GoogleAdapter.EvaluateAsync(
            new[] { TestData.Step("assistant", "informs", "hello") },
            TestData.Rule("llm_judge", ("criteria", "helpful"), ("rating_scale", "1-5")));

        Assert.True(result.Passed);
        Assert.Equal(0.8, result.Score, 1e-9);
        Assert.Equal("google", result.Adapter);
    }

    [Fact]
    public async Task GoogleManagedDimension()
    {
        GoogleAdapter.Configure(new GoogleAdapterConfig
        {
            GenerateOverride = (prompt, ct) => Task.FromResult("{\"score\":5,\"explanation\":\"great\"}"),
        });

        var result = await GoogleAdapter.EvaluateAsync(
            new[] { TestData.Step("assistant", "informs", "hello") },
            TestData.Rule("Relevance", ("query", "q"), ("response", "hello")));

        Assert.True(result.Passed);
        Assert.Equal(1.0, result.Score, 1e-9);
    }

    [Fact]
    public async Task GoogleSafetyIsBinary()
    {
        GoogleAdapter.Configure(new GoogleAdapterConfig
        {
            GenerateOverride = (prompt, ct) => Task.FromResult("{\"score\":1,\"explanation\":\"safe\"}"),
        });

        var result = await GoogleAdapter.EvaluateAsync(
            new[] { TestData.Step("assistant", "informs", "hello") },
            TestData.Rule("Violence", ("response", "hello")));

        Assert.True(result.Passed);
        Assert.Equal(1.0, result.Score, 1e-9);
    }

    [Fact]
    public void GoogleParsePointwiseResponse()
    {
        var (score, reason) = GoogleAdapter.ParsePointwiseResponse("{\"score\":4,\"explanation\":\"good\"}");
        Assert.Equal(4, score);
        Assert.Equal("good", reason);
    }

    [Fact]
    public void GoogleCustomPromptContainsCriteriaAndResponse()
    {
        var prompt = GoogleAdapter.BuildCustomPrompt("be nice", "hi", "hello", 5);
        Assert.Contains("be nice", prompt);
        Assert.Contains("hello", prompt);
        Assert.Contains("between 1 and 5", prompt);
    }

    [Fact]
    public void ConfigAppliesSatelliteProviderAfterRegister()
    {
        AwsAdapter.Register(asDefault: false);
        var config = new AbsConfig
        {
            Adapters = new Dictionary<string, string> { ["test_aws_type"] = "aws" },
        };
        config.ApplyAdapters();

        Assert.True(AbsAdapterRegistry.HasDefault("test_aws_type"));
        Assert.Empty(config.Warnings);
    }

    [Fact]
    public void SatelliteAdaptersRegisterByName()
    {
        AwsAdapter.Register(asDefault: false);
        GoogleAdapter.Register(asDefault: false);
        Assert.True(AbsAdapterRegistry.HasNamed("llm_judge", "aws"));
        Assert.True(AbsAdapterRegistry.HasNamed("llm_judge", "google"));
    }
}
