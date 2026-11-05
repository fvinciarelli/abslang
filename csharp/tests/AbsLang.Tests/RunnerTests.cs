using System.Net;
using System.Text;
using AbsLang;
using Xunit;

namespace AbsLang.Tests;

public class RunnerTests
{
    [Fact]
    public async Task RunsMissingInfoScenario()
    {
        var session = AbsParser.Parse(Path.Combine(RepoRoot(), "examples", "order-status-missing-info.yaml"));
        using var http = new HttpClient(new QueueHandler(new[]
        {
            """{"choices":[{"message":{"role":"assistant","content":"Please provide your order number so I can look that up for you."}}]}""",
            """{"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"Order MCP","arguments":"{\"orderId\": \"12345\"}"}}]}}]}""",
            """{"choices":[{"message":{"role":"assistant","content":"Your order #12345 is on the way! It should arrive by Friday."}}]}""",
        }));

        var runner = new AbsRunner(http);
        var result = await runner.RunAsync(session, new AgentConfig { Url = "http://localhost/chat" });

        Assert.True(result.Passed);
        Assert.Equal(6, result.StepsTotal);
        Assert.Equal(6, result.StepsMatched);
        Assert.Equal(5, result.EvaluationsTotal);
        Assert.Equal(5, result.EvaluationsPassed);

        var types = result.Steps.SelectMany(step => step.Evaluations).Select(evaluation => evaluation.Type).ToList();
        Assert.Contains("contains", types);
        Assert.Contains("tool_call", types);

        var chains = result.ChainEvaluations.Select(evaluation => evaluation.Type).ToList();
        Assert.Equal(new[] { "sequence", "variable_consistency", "never" }, chains);
        Assert.All(result.ChainEvaluations, evaluation => Assert.True(evaluation.Passed));
    }

    [Fact]
    public async Task FailsWhenTheAgentDoesNotMatch()
    {
        var session = AbsParser.Parse(Path.Combine(RepoRoot(), "examples", "order-status-missing-info.yaml"));
        using var http = new HttpClient(new QueueHandler(new[]
        {
            """{"choices":[{"message":{"role":"assistant","content":"Sure, let's get started."}}]}""",
            """{"choices":[{"message":{"role":"assistant","content":"Done."}}]}""",
            """{"choices":[{"message":{"role":"assistant","content":"Done again."}}]}""",
        }));

        var result = await new AbsRunner(http).RunAsync(session, new AgentConfig { Url = "http://localhost/chat" });

        Assert.False(result.Passed);
        Assert.True(result.EvaluationsPassed < result.EvaluationsTotal);
    }


    [Fact]
    public async Task RunsStepLevelEvaluationsOnToolResponds()
    {
        var session = AbsParser.Parse(ToolSession("{ status: \"in_transit\" }"));
        using var http = new HttpClient(ToolAgent());

        var result = await new AbsRunner(http).RunAsync(session, new AgentConfig { Url = "http://localhost/chat" });

        Assert.True(result.Passed);
        Assert.Equal(1, result.EvaluationsTotal);
        Assert.Equal(1, result.EvaluationsPassed);

        var toolStep = result.Steps.Single(step => step.Behavior.Actor == "tool");
        Assert.Single(toolStep.Evaluations);
        Assert.Equal("schema", toolStep.Evaluations[0].Type);
        Assert.True(toolStep.Evaluations[0].Passed);
    }

    [Fact]
    public async Task FailsWhenToolResponseViolatesItsSchema()
    {
        var session = AbsParser.Parse(ToolSession("{ eta: \"2026-01-01\" }"));
        using var http = new HttpClient(ToolAgent());

        var result = await new AbsRunner(http).RunAsync(session, new AgentConfig { Url = "http://localhost/chat" });

        Assert.False(result.Passed);
        Assert.Equal(1, result.EvaluationsTotal);
        Assert.Equal(0, result.EvaluationsPassed);

        var evaluation = result.Steps.Single(step => step.Behavior.Actor == "tool").Evaluations[0];
        Assert.Equal("schema", evaluation.Type);
        Assert.False(evaluation.Passed);
        Assert.Contains("Missing required field: \"status\"", evaluation.Reason);
    }

    private static string ToolSession(string toolContent) => $$"""
session: Tool responds evaluations
behaviors:
  - actor: user
    action: says
    content: "Where is my order?"

  - actor: assistant
    action: calls
    target: Order MCP
    with:
      orderId: "12345"

  - actor: tool
    action: responds
    target: Order MCP
    content: {{toolContent}}
    evaluations:
      - type: schema
        schema:
          type: object
          required: [status]
          properties:
            status: { type: string }

  - actor: assistant
    action: informs
    content: "ok"
""";

    private static QueueHandler ToolAgent() => new(new[]
    {
        """{"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"Order MCP","arguments":"{\"orderId\":\"12345\"}"}}]}}]}""",
        """{"choices":[{"message":{"role":"assistant","content":"ok"}}]}""",
    });

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

    private sealed class QueueHandler : HttpMessageHandler
    {
        private readonly Queue<string> _responses;

        public QueueHandler(IEnumerable<string> responses) => _responses = new Queue<string>(responses);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = _responses.Count > 0
                ? _responses.Dequeue()
                : """{"choices":[{"message":{"role":"assistant","content":"ok"}}]}""";

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            });
        }
    }
}
