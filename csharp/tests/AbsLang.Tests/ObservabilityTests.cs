using System.Net.Http;
using AbsLang;
using Xunit;

namespace AbsLang.Tests;

public class ObservabilityTests
{
    [Fact]
    public async Task LoggerEventsCarryTimingAndTimestamp()
    {
        var events = new List<(string Name, IReadOnlyDictionary<string, object?> Fields)>();
        var logger = new RunLogger("Observability", "http://agent", "run-test")
        {
            Sink = (name, fields) => events.Add((name, fields)),
        };

        var session = AbsParser.Parse("""
session: Observability
behaviors:
  - actor: user
    action: says
    content: "hi"
  - actor: assistant
    action: informs
    content: "hello"
""");

        var stub = new StubHandler().Json("""{"choices":[{"message":{"role":"assistant","content":"hello"}}]}""");
        using var http = new HttpClient(stub);
        var result = await new AbsRunner(http).RunAsync(
            session,
            new AgentConfig { Url = "http://agent" },
            logger: logger);

        Assert.True(result.Passed);
        Assert.Contains(events, e => e.Name == "agent.response" && e.Fields.ContainsKey("duration_ms"));
        Assert.Contains(events, e => e.Name == "behavior.match" && e.Fields.ContainsKey("duration_ms"));
        Assert.Contains(events, e => e.Name == "session.end" && e.Fields.ContainsKey("duration_ms"));
        Assert.All(events, e => Assert.True(e.Fields.ContainsKey("ts")));
        Assert.All(events, e => Assert.Equal("run-test", e.Fields["run_id"]));
    }
}
