using System.Net.Http;
using System.Text;
using AbsLang;
using Xunit;

namespace AbsLang.Tests;

public class RunnerProtocolTests
{
    private static NormalizedSession Session() => AbsParser.Parse("""
session: Protocol test
behaviors:
  - actor: user
    action: says
    content: "hi"
  - actor: assistant
    action: informs
    content: "hello"
""");

    [Fact]
    public async Task ResponsesJsonAdapter()
    {
        var stub = new StubHandler().Json("""{"output":[{"type":"message","content":[{"type":"output_text","text":"hello"}]}]}""");
        using var http = new HttpClient(stub);
        var result = await new AbsRunner(http).RunAsync(Session(), new AgentConfig
        {
            Url = "http://agent/v1/responses",
            Format = "responses",
            Stream = false,
        });

        Assert.True(result.Passed);
        Assert.Equal("hello", result.Steps[1].Observed!.Content);
    }

    [Fact]
    public async Task ResponsesSseAdapter()
    {
        var payload = string.Join("\n", new[]
        {
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"hel\"}",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"lo\"}",
            "data: {\"type\":\"response.completed\",\"response\":{\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"hello\"}]}]}}",
            "",
        });
        var stub = new StubHandler().Sse(payload);
        using var http = new HttpClient(stub);
        var result = await new AbsRunner(http).RunAsync(Session(), new AgentConfig
        {
            Url = "http://agent/v1/responses",
            Format = "responses",
        });

        Assert.True(result.Passed);
        Assert.Equal("hello", result.Steps[1].Observed!.Content);
    }

    [Fact]
    public async Task ClaudeAdapter()
    {
        var stub = new StubHandler().Json("""{"content":[{"text":"hello"}]}""");
        using var http = new HttpClient(stub);
        var result = await new AbsRunner(http).RunAsync(Session(), new AgentConfig
        {
            Url = "http://agent/v1/messages",
            Format = "claude",
            Token = "sk-ant",
        });

        Assert.True(result.Passed);
        Assert.Equal("sk-ant", stub.Requests[0].Headers.GetValues("x-api-key").Single());
        Assert.Contains("claude", stub.Bodies[0]);
    }

    [Fact]
    public async Task GeminiAdapter()
    {
        var stub = new StubHandler().Json("""{"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}""");
        using var http = new HttpClient(stub);
        var result = await new AbsRunner(http).RunAsync(Session(), new AgentConfig
        {
            Url = "http://agent/v1/models/gemini:generateContent",
            Format = "gemini",
            Token = "gem-key",
        });

        Assert.True(result.Passed);
        Assert.Contains("key=gem-key", stub.Requests[0].RequestUri!.ToString());
    }

    [Fact]
    public async Task OAuth2RefreshesTheToken()
    {
        var stub = new StubHandler()
            .Json("""{"access_token":"fresh-token"}""")
            .Json("""{"choices":[{"message":{"role":"assistant","content":"hello"}}]}""");
        var previous = AbsAdapterHttp.Client;
        AbsAdapterHttp.Client = new HttpClient(stub);
        try
        {
            using var http = new HttpClient(stub);
            var result = await new AbsRunner(http).RunAsync(Session(), new AgentConfig
            {
                Url = "http://agent/chat",
                Auth = "oauth2",
                RefreshUrl = "http://auth/token",
                RefreshToken = "refresh",
                ClientId = "client",
            });

            Assert.True(result.Passed);
            Assert.Equal(2, stub.Requests.Count);
            Assert.Equal("Bearer fresh-token", stub.Requests[1].Headers.Authorization!.ToString());
            Assert.Contains("grant_type=refresh_token", stub.Bodies[0]);
        }
        finally
        {
            AbsAdapterHttp.Client = previous;
        }
    }

    [Fact]
    public async Task ApiKeyAuthUsesXApiKey()
    {
        var stub = new StubHandler().Json("""{"choices":[{"message":{"role":"assistant","content":"hello"}}]}""");
        using var http = new HttpClient(stub);
        await new AbsRunner(http).RunAsync(Session(), new AgentConfig
        {
            Url = "http://agent/chat",
            Auth = "api_key",
            Token = "secret",
        });
        Assert.Equal("secret", stub.Requests[0].Headers.GetValues("X-API-Key").Single());
    }

    [Fact]
    public async Task BearerAuthUsesAuthorization()
    {
        var stub = new StubHandler().Json("""{"choices":[{"message":{"role":"assistant","content":"hello"}}]}""");
        using var http = new HttpClient(stub);
        await new AbsRunner(http).RunAsync(Session(), new AgentConfig
        {
            Url = "http://agent/chat",
            Auth = "bearer",
            Token = "secret",
        });
        Assert.Equal("Bearer secret", stub.Requests[0].Headers.Authorization!.ToString());
    }

    [Fact]
    public void ToResponsesInputTranslatesMessages()
    {
        var messages = new List<AgentMessage>
        {
            new() { Role = "system", Content = "Be nice" },
            new() { Role = "user", Content = "hi" },
            new()
            {
                Role = "assistant",
                Content = null,
                ToolCalls = new List<ToolCall>
                {
                    new()
                    {
                        Id = "call_1",
                        Function = new ToolCallFunction { Name = "Order MCP", Arguments = "{\"orderId\":\"1\"}" },
                    },
                },
            },
            new() { Role = "tool", ToolCallId = "call_1", Content = "{\"status\":\"ok\"}" },
        };

        var (instructions, input) = AbsRunner.ToResponsesInput(messages);
        Assert.Equal("Be nice", instructions);
        Assert.Equal(3, input.Count);
        Assert.Equal("function_call", ((Dictionary<string, object?>)input[1]!)["type"]);
        Assert.Equal("function_call_output", ((Dictionary<string, object?>)input[2]!)["type"]);
    }

    [Fact]
    public void ParseResponsesOutputExtractsTextAndCalls()
    {
        var output = new List<object?>
        {
            new Dictionary<string, object?>
            {
                ["type"] = "message",
                ["content"] = new List<object?>
                {
                    new Dictionary<string, object?> { ["type"] = "output_text", ["text"] = "hello " },
                },
            },
            new Dictionary<string, object?>
            {
                ["type"] = "function_call",
                ["call_id"] = "call_1",
                ["name"] = "Order MCP",
                ["arguments"] = "{\"orderId\":\"1\"}",
            },
        };

        var (content, calls) = AbsRunner.ParseResponsesOutput(output);
        Assert.Equal("hello ", content);
        Assert.Single(calls);
        Assert.Equal("Order MCP", calls[0].Function.Name);
    }

    [Fact]
    public void ApplyResponsesEventAccumulatesDeltas()
    {
        var state = new ResponsesStreamState();
        AbsRunner.ApplyResponsesEvent(state, new Dictionary<string, object?>
        {
            ["type"] = "response.output_text.delta",
            ["delta"] = "hel",
        });
        AbsRunner.ApplyResponsesEvent(state, new Dictionary<string, object?>
        {
            ["type"] = "response.output_text.delta",
            ["delta"] = "lo",
        });
        Assert.Equal("hello", state.Text);

        var message = AbsRunner.ResponsesStateToMessage(state);
        Assert.Equal("hello", message.Content);
    }
}
