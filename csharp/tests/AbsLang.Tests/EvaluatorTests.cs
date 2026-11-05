using AbsLang;
using Xunit;

namespace AbsLang.Tests;

public class EvaluatorTests
{
    [Fact]
    public void ExactMatch()
    {
        var rule = TestData.Rule("exact_match", ("value", "hello"));
        Assert.True(AbsEvaluators.ExactMatch("hello", rule).Passed);
        Assert.False(AbsEvaluators.ExactMatch("Hello", rule).Passed);
        Assert.True(AbsEvaluators.ExactMatch(1L, TestData.Rule("exact_match", ("value", 1.0))).Passed);
    }

    [Fact]
    public void ContainsIsCaseInsensitive()
    {
        var rule = TestData.Rule("contains", ("value", "ORDER NUMBER"));
        Assert.True(AbsEvaluators.Contains("Please provide your order number", rule).Passed);
        Assert.False(AbsEvaluators.Contains("Please provide your id", rule).Passed);
    }

    [Fact]
    public void Regex()
    {
        var rule = TestData.Rule("regex", ("pattern", @"R-\d{4}"));
        Assert.True(AbsEvaluators.RegexEval("Refund R-5512 approved", rule).Passed);
        Assert.False(AbsEvaluators.RegexEval("Refund approved", rule).Passed);
    }

    [Fact]
    public void SchemaRequiredAndTypes()
    {
        var schema = new Dictionary<string, object?>
        {
            ["type"] = "object",
            ["required"] = new List<object?> { "status" },
            ["properties"] = new Dictionary<string, object?>
            {
                ["status"] = new Dictionary<string, object?> { ["type"] = "string" },
            },
        };
        var rule = TestData.Rule("schema", ("schema", schema));
        var ok = new Dictionary<string, object?> { ["status"] = "in_transit" };
        var missing = new Dictionary<string, object?> { ["eta"] = "2026-01-01" };
        var wrongType = new Dictionary<string, object?> { ["status"] = 3L };

        Assert.True(AbsEvaluators.SchemaEval(ok, rule).Passed);
        Assert.False(AbsEvaluators.SchemaEval(missing, rule).Passed);
        Assert.Contains("Missing required field", AbsEvaluators.SchemaEval(missing, rule).Reason);
        Assert.False(AbsEvaluators.SchemaEval(wrongType, rule).Passed);
    }

    [Fact]
    public void ToolCallChecksTargetAndParameters()
    {
        var trace = new List<ObservedStep>
        {
            TestData.Step("assistant", "calls", target: "Order MCP", with: new Dictionary<string, object?>
            {
                ["orderId"] = "12345",
                ["locale"] = "es",
            }),
        };

        var ok = TestData.Rule("tool_call",
            ("target", "Order MCP"),
            ("with", new Dictionary<string, object?> { ["orderId"] = "12345" }));
        Assert.True(AbsEvaluators.ToolCall(trace, ok).Passed);

        var wrong = TestData.Rule("tool_call",
            ("target", "Order MCP"),
            ("with", new Dictionary<string, object?> { ["orderId"] = "999" }));
        Assert.False(AbsEvaluators.ToolCall(trace, wrong).Passed);

        var missingTool = TestData.Rule("tool_call", ("target", "Payment API"));
        Assert.False(AbsEvaluators.ToolCall(trace, missingTool).Passed);
    }

    [Fact]
    public void SequenceEventuallyNeverCountWithin()
    {
        var trace = new List<ObservedStep>
        {
            TestData.Step("user", "says", "hi"),
            TestData.Step("assistant", "asks", "id?"),
            TestData.Step("user", "says", "123"),
            TestData.Step("assistant", "calls", target: "Order MCP"),
            TestData.Step("tool", "responds", target: "Order MCP"),
            TestData.Step("assistant", "informs", "done"),
        };

        var sequence = TestData.Rule("sequence", ("order", new List<object?>
        {
            new Dictionary<string, object?> { ["actor"] = "assistant", ["action"] = "asks" },
            new Dictionary<string, object?> { ["actor"] = "assistant", ["action"] = "calls" },
            new Dictionary<string, object?> { ["actor"] = "assistant", ["action"] = "informs" },
        }));
        Assert.True(AbsEvaluators.Sequence(trace, sequence).Passed);

        Assert.True(AbsEvaluators.Eventually(trace, TestData.Rule("eventually",
            ("match", new Dictionary<string, object?> { ["action"] = "informs" }))).Passed);
        Assert.True(AbsEvaluators.Never(trace, TestData.Rule("never",
            ("match", new Dictionary<string, object?> { ["action"] = "hands_off" }))).Passed);
        Assert.False(AbsEvaluators.Never(trace, TestData.Rule("never",
            ("match", new Dictionary<string, object?> { ["action"] = "calls" }))).Passed);

        Assert.True(AbsEvaluators.Count(trace, TestData.Rule("count",
            ("match", new Dictionary<string, object?> { ["actor"] = "user" }), ("min", 2L), ("max", 2L))).Passed);
        Assert.False(AbsEvaluators.Count(trace, TestData.Rule("count",
            ("match", new Dictionary<string, object?> { ["actor"] = "user" }), ("min", 3L))).Passed);

        Assert.True(AbsEvaluators.Within(trace, TestData.Rule("within",
            ("after", new Dictionary<string, object?> { ["action"] = "asks" }),
            ("match", new Dictionary<string, object?> { ["action"] = "calls" }),
            ("max_steps", 3L))).Passed);
        Assert.False(AbsEvaluators.Within(trace, TestData.Rule("within",
            ("after", new Dictionary<string, object?> { ["action"] = "informs" }),
            ("match", new Dictionary<string, object?> { ["action"] = "calls" }),
            ("max_steps", 3L))).Passed);
    }

    [Fact]
    public void VariableConsistency()
    {
        var behaviors = new List<Behavior>
        {
            TestData.Behavior("user", "says", "12345", capture: new Dictionary<string, object?> { ["orderId"] = "12345" }),
            TestData.Behavior("assistant", "calls", target: "Order MCP",
                with: new Dictionary<string, object?> { ["orderId"] = "{{orderId}}" }),
            TestData.Behavior("assistant", "calls", target: "Order MCP",
                with: new Dictionary<string, object?> { ["orderId"] = "{{orderId}}" }),
        };

        var result = AbsEvaluators.VariableConsistency(behaviors,
            TestData.Rule("variable_consistency", ("variable", "orderId")));
        Assert.True(result.Passed);

        var inconsistent = new List<Behavior>
        {
            TestData.Behavior("user", "says", "12345", capture: new Dictionary<string, object?> { ["orderId"] = "12345" }),
            TestData.Behavior("user", "says", "999", capture: new Dictionary<string, object?> { ["orderId"] = "999" }),
        };
        Assert.False(AbsEvaluators.VariableConsistency(inconsistent,
            TestData.Rule("variable_consistency", ("variable", "orderId"))).Passed);
    }

    [Fact]
    public void ExpectedChecksMatchWhenAndAfter()
    {
        var steps = new List<StepResult>
        {
            new()
            {
                Step = 1,
                Behavior = TestData.Behavior("assistant", "asks", id: "ask"),
                Matched = false,
            },
        };

        var skipped = AbsEvaluators.Expected(steps,
            TestData.Rule("expected", ("behavior", "ask"), ("when", "{{flag}} == true")),
            new Dictionary<string, object?> { ["flag"] = false });
        Assert.True(skipped.Passed);
        Assert.Contains("when condition not met", skipped.Reason);

        var failed = AbsEvaluators.Expected(steps,
            TestData.Rule("expected", ("behavior", "ask")),
            new Dictionary<string, object?>());
        Assert.False(failed.Passed);

        steps[0].Matched = true;
        var passed = AbsEvaluators.Expected(steps,
            TestData.Rule("expected", ("behavior", "ask")),
            new Dictionary<string, object?>());
        Assert.True(passed.Passed);
    }

    [Theory]
    [InlineData("{{flag}} == true", true, true)]
    [InlineData("{{flag}} == true", false, false)]
    [InlineData("{{flag}} == false", false, true)]
    [InlineData("{{flag}} != true", false, true)]
    [InlineData("not {{flag}}", false, true)]
    [InlineData("!{{flag}}", true, false)]
    [InlineData("{{flag}} && {{flag}}", true, true)]
    [InlineData("{{flag}} || {{flag}}", false, false)]
    public void EvalWhenBooleans(string expression, bool flag, bool expected)
    {
        var vars = new Dictionary<string, object?> { ["flag"] = flag };
        Assert.Equal(expected, AbsEvaluators.EvalWhen(expression, vars));
    }

    [Fact]
    public void EvalWhenStringsNumbersAndParentheses()
    {
        var vars = new Dictionary<string, object?>
        {
            ["x"] = "a",
            ["y"] = true,
            ["n"] = 3L,
        };

        Assert.True(AbsEvaluators.EvalWhen("{{x}} == 'a' && {{y}} == true", vars));
        Assert.True(AbsEvaluators.EvalWhen("{{x}} == 'b' || {{y}} == true", vars));
        Assert.True(AbsEvaluators.EvalWhen("{{n}} > 5", vars) == false);
        Assert.True(AbsEvaluators.EvalWhen("{{n}} <= 5", vars));
        Assert.False(AbsEvaluators.EvalWhen("!({{n}} == 3)", vars));
    }

    [Fact]
    public void EvalWhenReturnsFalseOnInvalidExpression()
    {
        Assert.False(AbsEvaluators.EvalWhen("{{x}} ==", new Dictionary<string, object?> { ["x"] = 1 }));
        Assert.False(AbsEvaluators.EvalWhen("{{unknown}} == 1", new Dictionary<string, object?>()));
    }

    [Fact]
    public void Composition()
    {
        var trace = new List<ObservedStep> { TestData.Step("assistant", "informs", "the cat sat") };
        var allOf = TestData.Rule("all_of", ("evaluations", new List<object?>
        {
            new Dictionary<string, object?> { ["type"] = "contains", ["value"] = "cat" },
            new Dictionary<string, object?> { ["type"] = "contains", ["value"] = "sat" },
        }));
        var result = AbsEvaluators.EvaluateStep(trace[0], allOf, new List<Behavior>(), trace);
        Assert.True(result.Passed);
        Assert.Equal(1.0, result.Score, 1e-9);

        var anyOf = TestData.Rule("any_of", ("evaluations", new List<object?>
        {
            new Dictionary<string, object?> { ["type"] = "contains", ["value"] = "dog" },
            new Dictionary<string, object?> { ["type"] = "contains", ["value"] = "cat" },
        }));
        Assert.True(AbsEvaluators.EvaluateStep(trace[0], anyOf, new List<Behavior>(), trace).Passed);

        var noneOf = TestData.Rule("none_of", ("evaluations", new List<object?>
        {
            new Dictionary<string, object?> { ["type"] = "contains", ["value"] = "dog" },
        }));
        Assert.True(AbsEvaluators.EvaluateStep(trace[0], noneOf, new List<Behavior>(), trace).Passed);
    }

    [Fact]
    public void ThresholdOverridesPass()
    {
        var observed = TestData.Step("assistant", "informs", "a b c d");
        var rule = TestData.Rule("f1", ("ground_truth", "a b c"), ("threshold", 0.95));
        var result = AbsEvaluators.EvaluateStep(observed, rule, new List<Behavior>(), new[] { observed });

        Assert.False(result.Passed);
        Assert.Equal(0.95, result.Threshold);
        Assert.Contains("threshold", result.Reason);
        Assert.Equal("evaluator.threshold_not_met", result.Code);
    }

    [Fact]
    public void UnknownEvaluatorReturnsError()
    {
        var result = AbsEvaluators.EvaluateStep(null, TestData.Rule("nope"), new List<Behavior>(), new List<ObservedStep>());
        Assert.False(result.Passed);
        Assert.Equal("evaluator.unsupported", result.Code);
    }
}
