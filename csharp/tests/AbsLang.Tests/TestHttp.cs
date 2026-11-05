using System.Net;
using System.Text;

namespace AbsLang.Tests;

internal sealed class StubHandler : HttpMessageHandler
{
    private readonly Queue<Func<HttpRequestMessage, HttpResponseMessage>> _responses = new();

    public List<HttpRequestMessage> Requests { get; } = new();
    public List<string> Bodies { get; } = new();

    public StubHandler Enqueue(Func<HttpRequestMessage, HttpResponseMessage> responder)
    {
        _responses.Enqueue(responder);
        return this;
    }

    public StubHandler Json(string json, HttpStatusCode status = HttpStatusCode.OK) =>
        Enqueue(_ => new HttpResponseMessage(status)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        });

    public StubHandler Sse(string payload, HttpStatusCode status = HttpStatusCode.OK) =>
        Enqueue(_ => new HttpResponseMessage(status)
        {
            Content = new StringContent(payload, Encoding.UTF8, "text/event-stream"),
        });

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        Requests.Add(request);
        Bodies.Add(request.Content == null ? "" : await request.Content.ReadAsStringAsync(cancellationToken));
        if (_responses.Count == 0)
        {
            throw new InvalidOperationException($"No stub response for {request.Method} {request.RequestUri}");
        }
        return _responses.Dequeue()(request);
    }
}

internal sealed class EnvScope : IDisposable
{
    private readonly Dictionary<string, string?> _previous = new(StringComparer.Ordinal);

    public EnvScope(params (string Key, string? Value)[] values)
    {
        foreach (var (key, value) in values)
        {
            _previous[key] = Environment.GetEnvironmentVariable(key);
            Environment.SetEnvironmentVariable(key, value);
        }
    }

    public void Dispose()
    {
        foreach (var pair in _previous) Environment.SetEnvironmentVariable(pair.Key, pair.Value);
    }
}

internal static class TestData
{
    public static Evaluation Rule(string type, params (string Key, object? Value)[] fields)
    {
        var rule = new Evaluation { Type = type };
        foreach (var (key, value) in fields) rule.Data[key] = value;
        return rule;
    }

    public static ObservedStep Step(
        string actor,
        string action,
        object? content = null,
        string? target = null,
        Dictionary<string, object?>? with = null,
        string? id = null) => new()
    {
        Actor = actor,
        Action = action,
        Content = content,
        Target = target,
        With = with,
        Id = id,
    };

    public static Behavior Behavior(
        string actor,
        string action,
        object? content = null,
        string? target = null,
        string? id = null,
        Dictionary<string, object?>? with = null,
        List<Evaluation>? evaluations = null,
        Dictionary<string, object?>? capture = null) => new()
    {
        Actor = actor,
        Action = action,
        Content = content,
        Target = target,
        Id = id,
        With = with,
        Evaluations = evaluations,
        Capture = capture,
    };
}
