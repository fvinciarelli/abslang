using AbsLang;
using Xunit;

namespace AbsLang.Tests;

public class MetricsTests
{
    private const double Tolerance = 1e-9;

    [Theory]
    [InlineData("the cat sat on the mat", "the cat sat on the mat", 1.0)]
    [InlineData("the cat sat", "the dog ran", 1.0 / 3.0)]
    [InlineData("Hello, world!", "hello world", 1.0)]
    [InlineData("", "abc", 0.0)]
    [InlineData("a b c d", "a b c", 0.8571428571428571)]
    public void F1ScoreMetric(string response, string reference, double expected)
    {
        var (score, details) = AbsEvaluators.F1ScoreMetric(response, reference);
        Assert.Equal(expected, score, Tolerance);
        Assert.True(details.ContainsKey("precision"));
        Assert.True(details.ContainsKey("recall"));
        Assert.True(details.ContainsKey("f1"));
    }

    [Theory]
    [InlineData("the cat sat on the mat", "the cat sat on the mat", 1.0)]
    [InlineData("the cat sat", "the dog ran", 0.4367902323681494)]
    [InlineData("a b c d", "a b c", 0.668740304976422)]
    [InlineData("", "abc", 0.0)]
    public void BleuMetric(string response, string reference, double expected)
    {
        var (score, details) = AbsEvaluators.BleuMetric(response, reference);
        Assert.Equal(expected, score, Tolerance);
        Assert.True(details.ContainsKey("precisions"));
        Assert.True(details.ContainsKey("brevity_penalty"));
    }

    [Theory]
    [InlineData("rougeL", "the cat sat", "the dog ran", 1.0 / 3.0)]
    [InlineData("rouge1", "the cat sat", "the dog ran", 1.0 / 3.0)]
    [InlineData("rouge2", "the cat sat", "the dog ran", 0.0)]
    [InlineData("rougeL", "a b c d", "a b c", 0.8571428571428571)]
    public void RougeMetric(string variant, string response, string reference, double expected)
    {
        var (score, details) = AbsEvaluators.RougeMetric(response, reference, variant);
        Assert.Equal(expected, score, Tolerance);
        Assert.Equal(variant, details["variant"]);
    }

    [Fact]
    public void F1EvalUsesGroundTruthAndSelf()
    {
        var observed = TestData.Step("assistant", "informs", "the cat sat on the mat");
        var rule = TestData.Rule("f1", ("ground_truth", "the cat sat on the mat"));
        var result = AbsEvaluators.F1Eval(observed, rule, new[] { observed });

        Assert.True(result.Passed);
        Assert.Equal(1.0, result.Score, Tolerance);
    }

    [Fact]
    public void RougeEvalHonorsVariantAndMetric()
    {
        var observed = TestData.Step("assistant", "informs", "a b c d");
        var rule = TestData.Rule("rouge",
            ("ground_truth", "a b c"),
            ("variant", "rouge2"),
            ("metric", "precision"));
        var result = AbsEvaluators.RougeEval(observed, rule, new[] { observed });

        Assert.Equal(2.0 / 3.0, result.Score, Tolerance);
        Assert.True(result.Passed);
    }

    [Fact]
    public void RougeEvalRejectsUnknownVariant()
    {
        var observed = TestData.Step("assistant", "informs", "hello");
        var rule = TestData.Rule("rouge", ("ground_truth", "hello"), ("variant", "rouge9"));
        var result = AbsEvaluators.RougeEval(observed, rule, new[] { observed });

        Assert.False(result.Passed);
        Assert.Equal("evaluator.invalid_option", result.Code);
    }

    [Fact]
    public void ReferenceMetricRequiresGroundTruth()
    {
        var observed = TestData.Step("assistant", "informs", "hello");
        var result = AbsEvaluators.F1Eval(observed, TestData.Rule("f1"), new[] { observed });

        Assert.False(result.Passed);
        Assert.Equal("evaluator.missing_input", result.Code);
    }
}
