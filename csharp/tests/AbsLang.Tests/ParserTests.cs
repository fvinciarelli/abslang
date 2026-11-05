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
