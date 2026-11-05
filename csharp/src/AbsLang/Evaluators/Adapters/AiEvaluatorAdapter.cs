using System.Text;
using System.Text.Json;

namespace AbsLang;

/// <summary>
/// AI Evaluator adapter (https://aievaluator.dev). Calls the hosted
/// `/api/v1/evaluations/direct` endpoint directly over HTTP.
/// </summary>
public static class AiEvaluatorAdapter
{
    private static readonly Dictionary<string, string> MetricMap = new(StringComparer.Ordinal)
    {
        ["llm_judge"] = "g_eval",
        ["Groundedness"] = "hallucination",
        ["Relevance"] = "answer_relevancy",
        ["Coherence"] = "g_eval",
        ["Fluency"] = "g_eval",
        ["faithfulness"] = "faithfulness",
    };

    private static string _engineUrl = "https://api.aievaluator.dev";
    private static string? _apiKey;

    public static void Configure(string? apiKey = null, string? engineUrl = null)
    {
        if (!string.IsNullOrEmpty(apiKey)) _apiKey = apiKey;
        if (!string.IsNullOrEmpty(engineUrl)) _engineUrl = engineUrl!.TrimEnd('/');
    }

    public static void Register(bool asDefault = true, string name = "aievaluator")
    {
        foreach (var type in MetricMap.Keys)
        {
            AbsAdapterRegistry.Register(type, EvaluateAsync, name);
            if (asDefault) AbsAdapterRegistry.Register(type, EvaluateAsync);
        }
    }

    public static async Task<EvalResult> EvaluateAsync(
        IReadOnlyList<ObservedStep> trace,
        Evaluation evaluation,
        CancellationToken cancellationToken = default)
    {
        var evalType = evaluation.Type;
        var metric = MetricMap.TryGetValue(evalType, out var mapped) ? mapped : "g_eval";

        var input = "";
        var context = "";
        var response = "";
        var selfContent = LastAssistantContent(trace);

        if (evalType == "llm_judge")
        {
            var criteria = evaluation.GetString("criteria") ?? "Is the response helpful and accurate?";
            input = $"Given this conversation:\n\n{AbsTrace.TraceToText(trace)}\n\nEvaluate: {criteria}";
            response = selfContent;
        }
        else
        {
            input = AbsTrace.ResolveRef(trace, evaluation.GetString("query"), selfContent);
            context = AbsTrace.ResolveRef(trace, evaluation.GetString("context"), selfContent);
            response = AbsTrace.ResolveRef(trace, evaluation.GetString("response"), selfContent);
        }

        try
        {
            var row = new Dictionary<string, object?>
            {
                ["input"] = input,
                ["response"] = response,
            };
            if (!string.IsNullOrEmpty(context)) row["context"] = context;

            var body = new Dictionary<string, object?>
            {
                ["rows"] = new List<object?> { row },
                ["metrics"] = new List<object?> { metric },
            };
            if (evaluation.Threshold is { } threshold) body["thresholds"] = new Dictionary<string, object?> { [metric] = threshold };

            using var request = new HttpRequestMessage(
                HttpMethod.Post,
                $"{_engineUrl}/api/v1/evaluations/direct")
            {
                Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
            };
            if (!string.IsNullOrEmpty(_apiKey)) request.Headers.TryAddWithoutValidation("X-API-Key", _apiKey);

            using var httpResponse = await AbsAdapterHttp.Client.SendAsync(request, cancellationToken).ConfigureAwait(false);
            var text = await httpResponse.Content.ReadAsStringAsync().ConfigureAwait(false);
            if (!httpResponse.IsSuccessStatusCode)
            {
                return Error(evalType, "aievaluator", $"AI Evaluator returned {(int)httpResponse.StatusCode}: {Preview(text)}");
            }

            using var document = JsonDocument.Parse(text);
            var root = document.RootElement;
            if (!root.TryGetProperty("results", out var results) || results.GetArrayLength() == 0)
            {
                return Error(evalType, "aievaluator", "No result from AI Evaluator");
            }

            var rowResult = results[0];
            var score = 0.5;
            if (rowResult.TryGetProperty("scores", out var scores) && scores.ValueKind == JsonValueKind.Object)
            {
                if (scores.TryGetProperty(metric, out var metricScore) && metricScore.TryGetDouble(out var parsed))
                    score = parsed;
                else
                {
                    foreach (var property in scores.EnumerateObject())
                    {
                        if (property.Value.TryGetDouble(out parsed)) { score = parsed; break; }
                    }
                }
            }

            var reason = "";
            if (rowResult.TryGetProperty("details", out var details) && details.ValueKind == JsonValueKind.Object)
            {
                if (details.TryGetProperty(metric, out var metricDetails) && metricDetails.ValueKind == JsonValueKind.Object &&
                    metricDetails.TryGetProperty("reason", out var reasonValue))
                {
                    reason = reasonValue.GetString() ?? "";
                }
                else
                {
                    foreach (var property in details.EnumerateObject())
                    {
                        if (property.Value.ValueKind == JsonValueKind.Object &&
                            property.Value.TryGetProperty("reason", out var fallbackReason))
                        {
                            reason = fallbackReason.GetString() ?? "";
                            break;
                        }
                    }
                }
            }
            if (string.IsNullOrEmpty(reason)) reason = JsonSerializer.Serialize(rowResult);

            var thresholdValue = evaluation.Threshold ?? 0.7;
            return new EvalResult
            {
                Type = evalType,
                Adapter = "aievaluator",
                Passed = score >= thresholdValue,
                Score = score,
                Reason = $"[{metric}] {reason}",
            };
        }
        catch (Exception error)
        {
            return Error(evalType, "aievaluator", $"AI Evaluator error: {error.Message}");
        }
    }

    private static EvalResult Error(string type, string adapter, string reason) => new()
    {
        Type = type,
        Adapter = adapter,
        Passed = false,
        Score = 0,
        Code = "adapter.error",
        Reason = reason,
    };

    private static string LastAssistantContent(IReadOnlyList<ObservedStep> trace)
    {
        for (var i = trace.Count - 1; i >= 0; i--)
        {
            if (trace[i].Actor == "assistant" && trace[i].Content != null)
                return AbsTrace.ToText(trace[i].Content);
        }
        return "";
    }

    private static string Preview(string text) => text.Length <= 200 ? text : text.Substring(0, 200);
}
