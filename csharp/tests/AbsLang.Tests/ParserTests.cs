using AbsLang;
using Xunit;

namespace AbsLang.Tests;

public class ParserTests
{
    [Fact]
    public void ParsesEveryExample()
    {
        var examples = Path.Combine(RepoRoot(), "examples");
        var files = Directory.GetFiles(examples, "*.yaml")
            .Concat(Directory.GetFiles(examples, "*.yml"));

        foreach (var file in files)
        {
            var documents = AbsParser.ParseYamlFile(file);
            Assert.NotEmpty(documents);
            var sessions = AbsParser.ParseMulti(file);
            Assert.Equal(documents.Count, sessions.Count);
            Assert.All(sessions, session => Assert.NotEmpty(session.Behaviors));
        }
    }

    [Fact]
    public void ParsesMissingInfoExample()
    {
        var session = AbsParser.Parse(Path.Combine(RepoRoot(), "examples", "order-status-missing-info.yaml"));

        Assert.Equal("Order status requires order number", session.Session);
        Assert.Equal(6, session.Behaviors.Count);
        Assert.Equal("user", session.Behaviors[0].Actor);
        Assert.Equal("says", session.Behaviors[0].Action);
        Assert.Equal("12345", session.Behaviors[2].Capture!["orderId"]);
        Assert.Equal("12345", session.Behaviors[3].With!["orderId"]);
        Assert.NotNull(session.Evaluations);
        Assert.Equal(3, session.Evaluations!.Count);
        Assert.Equal("sequence", session.Evaluations[0].Type);
        Assert.Equal("variable_consistency", session.Evaluations[1].Type);
        Assert.Equal("never", session.Evaluations[2].Type);
    }

    [Fact]
    public void ResolvesVariablesAndFragments()
    {
        const string yaml = """
session: Variables
fragments:
  ask:
    - actor: assistant
      action: asks
      content: "Please provide {{field}}"
behaviors:
  - include: ask
    # include entries cannot carry parameters in v0.2
  - actor: user
    action: says
    content: "12345"
    capture:
      orderId: "12345"
  - actor: assistant
    action: calls
    target: Order MCP
    with:
      orderId: "{{orderId}}"
""";

        var session = AbsParser.Parse(yaml);
        Assert.Equal(3, session.Behaviors.Count);
        Assert.Equal("Please provide {{field}}", session.Behaviors[0].Content);
        Assert.Equal("12345", session.Behaviors[2].With!["orderId"]);
    }

    [Fact]
    public void ResolvesTargetFromRuntimeBindings()
    {
        // Dataset-bound tool name in target must resolve (regression: it used to stay literal)
        const string yaml = """
session: Target from dataset
behaviors:
  - actor: assistant
    action: calls
    target: "{{cases.toolName}}"
""";

        var bindings = new Dictionary<string, object?>
        {
            ["cases.toolName"] = "get_weather",
        };
        var session = AbsParser.Parse(yaml, bindings);
        Assert.Equal("get_weather", session.Behaviors[0].Target);
    }

    [Fact]
    public void LeavesUnresolvedTargetLiteral()
    {
        const string yaml = """
session: Unresolved target
behaviors:
  - actor: assistant
    action: calls
    target: "{{missing}}"
""";

        var session = AbsParser.Parse(yaml);
        Assert.Equal("{{missing}}", session.Behaviors[0].Target);
    }

    [Fact]
    public void ResolvesSessionEvaluationTargetFromRuntimeBindings()
    {
        // Dataset-bound tool names must resolve in chain selectors too (not only in behaviors).
        const string yaml = """
session: Session evaluation target
behaviors:
  - actor: assistant
    action: calls
    target: "{{cases.toolName}}"
evaluations:
  - type: sequence
    order:
      - { actor: assistant, action: calls, target: "{{cases.toolName}}" }
  - type: llm_judge
    criteria: "Check {{cases.toolName}}"
""";

        var bindings = new Dictionary<string, object?>
        {
            ["cases.toolName"] = "get_weather",
        };
        var session = AbsParser.Parse(yaml, bindings);
        var rule = session.Evaluations![0];
        var selector = Assert.IsType<Dictionary<string, object?>>(rule.GetList("order")![0]);

        Assert.Equal("get_weather", selector["target"]);
        Assert.Equal("Check get_weather", session.Evaluations[1].GetString("criteria"));
        Assert.True(AbsEvaluators.Sequence(new List<ObservedStep>
        {
            TestData.Step("assistant", "calls", target: "get_weather"),
        }, rule).Passed);
    }

    [Fact]
    public void ResolvesSessionEvaluationTargetFromCapture()
    {
        // Chain evaluations run at session scope, so they see every capture.
        const string yaml = """
session: Session evaluation capture
behaviors:
  - actor: user
    action: says
    content: "use the captured tool"
    capture:
      tool: "{{cases.toolName}}"
  - actor: assistant
    action: calls
    target: "{{tool}}"
evaluations:
  - type: sequence
    order:
      - { actor: assistant, action: calls, target: "{{tool}}" }
""";

        var bindings = new Dictionary<string, object?>
        {
            ["cases.toolName"] = "get_weather",
        };
        var session = AbsParser.Parse(yaml, bindings);
        var selector = Assert.IsType<Dictionary<string, object?>>(
            session.Evaluations![0].GetList("order")![0]);

        Assert.Equal("get_weather", selector["target"]);
    }

    [Fact]
    public void LeavesUnresolvedSessionEvaluationTargetLiteral()
    {
        const string yaml = """
session: Session evaluation unresolved
behaviors:
  - actor: assistant
    action: calls
evaluations:
  - type: sequence
    order:
      - { actor: assistant, action: calls, target: "{{cases.toolName}}" }
""";

        var session = AbsParser.Parse(yaml);
        var selector = Assert.IsType<Dictionary<string, object?>>(
            session.Evaluations![0].GetList("order")![0]);

        Assert.Equal("{{cases.toolName}}", selector["target"]);
    }

    [Fact]
    public void PreservesWhenExpressionInSessionEvaluations()
    {
        // EvalWhen() resolves and quotes `when` at runtime; pre-resolving it
        // would turn a string comparison into an invalid unquoted identifier.
        const string yaml = """
session: Session evaluation when
behaviors:
  - actor: user
    action: says
    content: hi
evaluations:
  - type: all_of
    when: "{{cases.expectedPath}} == 'process'"
    evaluations:
      - type: expected
        behavior: ask_id
        when: "{{cases.flag}} == true"
""";

        var bindings = new Dictionary<string, object?>
        {
            ["cases.expectedPath"] = "process",
            ["cases.flag"] = true,
        };
        var session = AbsParser.Parse(yaml, bindings);
        var rule = session.Evaluations![0];
        var nested = Assert.IsType<Dictionary<string, object?>>(rule.GetList("evaluations")![0]);

        Assert.Equal("{{cases.expectedPath}} == 'process'", rule.GetString("when"));
        Assert.Equal("{{cases.flag}} == true", nested["when"]);
        Assert.True(AbsEvaluators.EvalWhen(rule.GetString("when"), bindings));
    }

    [Fact]
    public void RejectsSequenceReferencingOptionalBehavior()
    {
        const string yaml = """
session: Invalid
behaviors:
  - id: optional_ask
    actor: assistant
    action: asks
    optional: true
evaluations:
  - type: sequence
    order:
      - { actor: assistant, action: asks }
""";

        var error = Assert.Throws<AbsParseException>(() => AbsParser.Parse(yaml));
        Assert.Contains("optional", error.Message);
    }

    private static string RepoRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory != null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "SPECIFICATION.md"))) return directory.FullName;
            directory = directory.Parent;
        }
        throw new DirectoryNotFoundException("Could not find the repository root.");
    }
}
