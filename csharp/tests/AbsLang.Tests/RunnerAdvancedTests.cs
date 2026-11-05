using System.Net.Http;
using AbsLang;
using Xunit;

namespace AbsLang.Tests;

public class RunnerAdvancedTests
{
    private static StubHandler Agent(params string[] contents)
    {
        var stub = new StubHandler();
        foreach (var content in contents)
        {
            stub.Json("{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":"
                      + System.Text.Json.JsonSerializer.Serialize(content) + "}}]}");
        }
        return stub;
    }

    [Fact]
    public async Task OptionalSkippedWhenNotMatched()
    {
        var session = AbsParser.Parse("""
session: Optional
behaviors:
  - actor: user
    action: says
    content: "hi"
  - id: ask
    actor: assistant
    action: asks
    optional: true
    matches_when:
      type: contains
      value: "order number"
  - id: follow
    actor: assistant
    action: confirms
    requires: ask
""");
        var stub = Agent("Hello there");
        using var http = new HttpClient(stub);
        var result = await new AbsRunner(http).RunAsync(session, new AgentConfig { Url = "http://agent/chat" });

        Assert.True(result.Passed);
        Assert.True(result.Steps[1].Skipped);
        Assert.True(result.Steps[2].Skipped);
    }

    [Fact]
    public async Task OptionalMatchesAndActivatesRequires()
    {
        var session = AbsParser.Parse("""
session: Optional
behaviors:
  - actor: user
    action: says
    content: "hi"
  - id: ask
    actor: assistant
    action: asks
    optional: true
    matches_when:
      type: contains
      value: "order number"
  - id: follow
    actor: assistant
    action: confirms
    requires: ask
""");
        var stub = Agent("Please provide your order number");
        using var http = new HttpClient(stub);
        var result = await new AbsRunner(http).RunAsync(session, new AgentConfig { Url = "http://agent/chat" });

        Assert.True(result.Passed);
        Assert.False(result.Steps[1].Skipped);
        Assert.True(result.Steps[1].Matched);
        Assert.False(result.Steps[2].Skipped);
    }

    [Fact]
    public async Task MatchesWhenRegex()
    {
        var session = AbsParser.Parse("""
session: Regex matching
behaviors:
  - actor: user
    action: says
    content: "hi"
  - actor: assistant
    action: informs
    optional: true
    matches_when:
      type: regex
      pattern: "R-\\d{4}"
""");
        var stub = Agent("Your reference is R-5512");
        using var http = new HttpClient(stub);
        var result = await new AbsRunner(http).RunAsync(session, new AgentConfig { Url = "http://agent/chat" });

        Assert.False(result.Steps[1].Skipped);
        Assert.True(result.Steps[1].Matched);
    }

    [Fact]
    public async Task MatchesWhenLlmJudgeUsesRegisteredAdapter()
    {
        AdapterFunction overrideJudge = (trace, rule, ct) => Task.FromResult(new EvalResult
        {
            Type = "llm_judge",
            Passed = true,
            Score = 1,
            Reason = "test judge",
        });
        AbsAdapterRegistry.Register("llm_judge", overrideJudge);
        try
        {
            var session = AbsParser.Parse("""
session: LLM matching
behaviors:
  - actor: user
    action: says
    content: "hi"
  - actor: assistant
    action: informs
    optional: true
    matches_when:
      type: llm_judge
      criteria: "The agent greets the user"
""");
            var stub = Agent("Hello!");
            using var http = new HttpClient(stub);
            var result = await new AbsRunner(http).RunAsync(session, new AgentConfig { Url = "http://agent/chat" });

            Assert.False(result.Steps[1].Skipped);
            Assert.True(result.Steps[1].Matched);
        }
        finally
        {
            BuiltinJudge.Register(force: true);
        }
    }

    [Fact]
    public async Task WithOnlyRejectsExtraParameters()
    {
        var session = AbsParser.Parse("""
session: Strict params
behaviors:
  - actor: user
    action: says
    content: "hi"
  - actor: assistant
    action: calls
    target: Order MCP
    with_only:
      orderId: "1"
  - actor: tool
    action: responds
    target: Order MCP
    content: { status: "ok" }
  - actor: assistant
    action: informs
    content: "done"
""");
        var first = new StubHandler().Json("""
{"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"Order MCP","arguments":"{\"orderId\":\"1\",\"locale\":\"es\"}"}}]}}]}
""").Json("""{"choices":[{"message":{"role":"assistant","content":"done"}}]}""");
        using var http = new HttpClient(first);
        var result = await new AbsRunner(http).RunAsync(session, new AgentConfig { Url = "http://agent/chat" });

        Assert.False(result.Steps[1].Matched);
        Assert.True(result.StepsMatched < result.StepsTotal);
    }

    [Fact]
    public async Task BlockingFailureMakesDownstreamEvaluationsInconclusive()
    {
        var session = AbsParser.Parse("""
session: Blocking
behaviors:
  - actor: user
    action: says
    content: "one"
  - actor: assistant
    action: informs
    evaluations:
      - type: contains
        value: "missing"
        blocking: true
  - actor: user
    action: says
    content: "two"
  - actor: assistant
    action: informs
    evaluations:
      - type: contains
        value: "ok"
""");
        var stub = Agent("first", "ok");
        using var http = new HttpClient(stub);
        var result = await new AbsRunner(http).RunAsync(session, new AgentConfig { Url = "http://agent/chat" });

        Assert.False(result.Steps[1].Evaluations[0].Passed);
        Assert.True(result.Steps[3].Evaluations[0].Inconclusive);
        Assert.False(result.Passed); // the blocking failure itself fails the run
    }

    [Fact]
    public async Task ExpectedValidatesAnOptionalBehavior()
    {
        var session = AbsParser.Parse("""
session: Expected
behaviors:
  - actor: user
    action: says
    content: "hi"
  - id: ask
    actor: assistant
    action: asks
    optional: true
    matches_when:
      type: contains
      value: "order number"
evaluations:
  - type: expected
    behavior: ask
    reason: "should ask for the order number"
""");
        var stub = Agent("Hello");
        using var http = new HttpClient(stub);
        var result = await new AbsRunner(http).RunAsync(session, new AgentConfig { Url = "http://agent/chat" });

        Assert.False(result.Passed);
        Assert.Contains("should ask", result.ChainEvaluations[0].Reason);
    }
}
