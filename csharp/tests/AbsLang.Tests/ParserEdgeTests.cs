using AbsLang;
using Xunit;

namespace AbsLang.Tests;

public class ParserEdgeTests
{
    [Fact]
    public void YamlScalarProfileIsYaml12()
    {
        const string yaml = """
session: Scalars
behaviors:
  - actor: user
    action: says
    content: yes
  - actor: assistant
    action: informs
    content: "true"
  - actor: assistant
    action: informs
    content: 2026-01-01
  - actor: assistant
    action: informs
    content: 42
""";
        var session = AbsParser.Parse(yaml);
        Assert.Equal("yes", session.Behaviors[0].Content);
        Assert.Equal("true", session.Behaviors[1].Content);
        Assert.Equal("2026-01-01", session.Behaviors[2].Content);
        Assert.Equal(42L, session.Behaviors[3].Content);
    }

    [Fact]
    public void ParsesMultipleDocuments()
    {
        const string yaml = """
session: One
behaviors:
  - actor: user
    action: says
    content: hi
---
session: Two
behaviors:
  - actor: user
    action: says
    content: bye
""";
        var sessions = AbsParser.ParseMulti(yaml);
        Assert.Equal(2, sessions.Count);
        Assert.Equal("One", sessions[0].Session);
        Assert.Equal("Two", sessions[1].Session);
    }

    [Fact]
    public void RejectsInvalidSchema()
    {
        const string yaml = """
session: Invalid
behaviors:
  - actor: user
""";
        var error = Assert.Throws<AbsValidationException>(() => AbsParser.Parse(yaml));
        Assert.NotEmpty(error.Errors);
    }

    [Fact]
    public void RejectsUnknownFragment()
    {
        const string yaml = """
session: Invalid
behaviors:
  - include: missing
""";
        var error = Assert.Throws<AbsParseException>(() => AbsParser.Parse(yaml));
        Assert.Contains("Fragment \"missing\" not found", error.Message);
    }

    [Fact]
    public void LoadsJsonlAndJsonDatasets()
    {
        var directory = Path.Combine(Path.GetTempPath(), "abs-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var jsonl = Path.Combine(directory, "cases.jsonl");
            File.WriteAllText(jsonl, "{\"name\":\"a\"}\n{\"name\":\"b\"}\n");
            var json = Path.Combine(directory, "cases.json");
            File.WriteAllText(json, "[{\"name\":\"c\"}]");

            var jsonlRows = AbsParser.LoadDataset(jsonl);
            var jsonRows = AbsParser.LoadDataset(json);

            Assert.Equal(2, jsonlRows.Count);
            Assert.Equal("a", jsonlRows[0]["name"]);
            Assert.Single(jsonRows);
            Assert.Equal("c", jsonRows[0]["name"]);
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }

    [Fact]
    public void VariableResolutionSupportsDottedKeysAndLeavesUnknown()
    {
        const string yaml = """
session: Variables
behaviors:
  - actor: user
    action: says
    content: "{{cases.message}} / {{unknown}}"
""";
        var session = AbsParser.Parse(yaml, new Dictionary<string, object?>
        {
            ["cases.message"] = "hello",
        });
        Assert.Equal("hello / {{unknown}}", session.Behaviors[0].Content);
    }

    [Fact]
    public void EmptyDocumentIsRejected()
    {
        var error = Assert.Throws<AbsParseException>(() => AbsParser.Parse(""));
        Assert.Contains("No ABS documents", error.Message);
    }
}
