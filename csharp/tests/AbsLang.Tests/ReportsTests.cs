using System.Text.Json;
using AbsLang;
using Xunit;

namespace AbsLang.Tests;

public class ReportsTests
{
    private static RunResult BuildResult()
    {
        var behavior = TestData.Behavior("assistant", "informs", "the cat sat", id: "final");
        return new RunResult
        {
            Session = "Report test",
            Agent = "http://agent",
            Passed = false,
            Steps = new List<StepResult>
            {
                new()
                {
                    Step = 1,
                    Behavior = behavior,
                    Observed = TestData.Step("assistant", "informs", "the cat sat"),
                    Matched = true,
                    Evaluations = new List<EvalResult>
                    {
                        new()
                        {
                            Type = "contains",
                            Passed = false,
                            Score = 0,
                            Reason = "missing",
                            Blocking = true,
                            DurationMs = 4,
                        },
                    },
                },
            },
            ChainEvaluations = new List<EvalResult>
            {
                new() { Type = "sequence", Passed = true, Score = 1, Reason = "ok" },
            },
            StepsTotal = 1,
            StepsMatched = 1,
            EvaluationsTotal = 2,
            EvaluationsPassed = 1,
        };
    }

    [Fact]
    public void FormatJsonKeepsTheStableShape()
    {
        var json = AbsReports.FormatJson(BuildResult());
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;

        Assert.Equal("Report test", root.GetProperty("session").GetString());
        Assert.False(root.GetProperty("passed").GetBoolean());
        Assert.Equal(1, root.GetProperty("steps_total").GetInt32());
        Assert.False(root.GetProperty("trace")[0].GetProperty("behavior").TryGetProperty("target", out _));
        Assert.True(root.GetProperty("trace")[0].GetProperty("evaluations")[0].GetProperty("blocking").GetBoolean());
        Assert.Equal(4, root.GetProperty("trace")[0].GetProperty("evaluations")[0].GetProperty("durationMs").GetInt64());
        Assert.Equal("sequence", root.GetProperty("chain_evaluations")[0].GetProperty("type").GetString());
    }

    [Fact]
    public void FormatTableContainsStepsAndFailures()
    {
        var table = AbsReports.FormatTable(BuildResult());
        Assert.Contains("ABS — Results", table);
        Assert.Contains("Report test", table);
        Assert.Contains("❌ FAILED", table);
        Assert.Contains("contains", table);
        Assert.Contains("missing", table);
    }

    [Fact]
    public void FormatJunitContainsFailureAndPass()
    {
        var junit = AbsReports.FormatJunit(BuildResult());
        Assert.Contains("<testsuite name=\"ABS: Report test\" tests=\"2\" failures=\"1\"", junit);
        Assert.Contains("<failure message=\"missing\">", junit);
        Assert.Contains("Chain: sequence", junit);
    }
}
