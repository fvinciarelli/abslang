using AbsLang;
using Xunit;

namespace AbsLang.Tests;

public class TraceUtilsTests
{
    [Fact]
    public void TraceToTextIncludesToolArguments()
    {
        var trace = new List<ObservedStep>
        {
            TestData.Step("assistant", "calls", target: "Order MCP", with: new Dictionary<string, object?>
            {
                ["orderId"] = "8291",
            }),
            TestData.Step("tool", "responds", target: "Order MCP", content: new Dictionary<string, object?>
            {
                ["status"] = "in_transit",
            }),
        };

        var text = AbsTrace.TraceToText(trace);
        Assert.Contains("[assistant] calls → Order MCP", text);
        Assert.Contains("8291", text);
        Assert.Contains("[tool] responds → Order MCP", text);
    }

    [Fact]
    public void ResolveRefSupportsSelfIdActionAndActor()
    {
        var trace = new List<ObservedStep>
        {
            TestData.Step("user", "says", "Where is my order?", id: "user_asks"),
            TestData.Step("assistant", "responds", "Please provide the ID", id: "kb_result"),
        };

        Assert.Equal("Where is my order?", AbsTrace.ResolveRef(trace, "user_asks"));
        Assert.Equal("Where is my order?", AbsTrace.ResolveRef(trace, "user.says"));
        Assert.Equal("Please provide the ID", AbsTrace.ResolveRef(trace, "kb_result.responds"));
        Assert.Equal("self", AbsTrace.ResolveRef(trace, "self", "self"));
        Assert.Equal("unknown", AbsTrace.ResolveRef(trace, "unknown"));
    }

    [Fact]
    public void TraceToMessagesGroupsToolCalls()
    {
        var trace = new List<ObservedStep>
        {
            TestData.Step("user", "says", "hi"),
            TestData.Step("assistant", "calls", target: "Order MCP",
                with: new Dictionary<string, object?> { ["orderId"] = "1" }, id: null),
            TestData.Step("tool", "responds", target: "Order MCP",
                content: new Dictionary<string, object?> { ["status"] = "ok" }),
        };
        // Tool calls in the trace carry a tool_call_id when observed from the agent.
        trace[1].ToolCallId = "call_1";
        trace[2].ToolCallId = "call_1";

        var messages = AbsTrace.TraceToMessages(trace);
        Assert.Equal("user", messages[0]["role"]);
        Assert.Equal("assistant", messages[1]["role"]);
        Assert.Equal("tool", messages[2]["role"]);
        Assert.Equal("call_1", messages[2]["tool_call_id"]);
    }

    [Fact]
    public void ExtractToolTrajectory()
    {
        var trace = new List<ObservedStep>
        {
            TestData.Step("assistant", "calls", target: "Order MCP"),
            TestData.Step("assistant", "calls", target: "Inventory API"),
        };
        Assert.Equal(new[] { "Order MCP", "Inventory API" }, AbsTrace.ExtractToolTrajectory(trace));
    }
}
