using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AbsLang;

public sealed class AzureAdapterConfig
{
    public string? Endpoint { get; set; }
    public string? ApiKey { get; set; }
    public string? Deployment { get; set; }
    public string? ApiVersion { get; set; }
}

/// <summary>
/// Azure OpenAI / AI Foundry evaluator adapter. Prompt-based and SDK-free,
/// mirroring the TypeScript implementation.
/// </summary>
public static class AzureAdapter
{
    private const string DefaultApiVersion = "2024-02-15-preview";
    private static AzureAdapterConfig _config = new();

    private static readonly HashSet<string> DimensionTypes = new(StringComparer.Ordinal)
    {
        "Groundedness", "Relevance", "Coherence", "Fluency",
    };

    public static void Configure(AzureAdapterConfig? config = null) => _config = config ?? new AzureAdapterConfig();

    public static void Configure(string endpoint, string apiKey, string deployment, string? apiVersion = null)
        => _config = new AzureAdapterConfig
        {
            Endpoint = endpoint,
            ApiKey = apiKey,
            Deployment = deployment,
            ApiVersion = apiVersion,
        };

    public static void Register(bool asDefault = true, string name = "azure")
    {
        var types = new[] { "llm_judge", "custom" }.Concat(DimensionTypes);
        foreach (var type in types)
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
        var config = ResolveConfig();
        if (config == null)
        {
            return new EvalResult
            {
                Type = evaluation.Type,
                Adapter = "azure",
                Passed = false,
                Score = 0,
                Code = "adapter.not_configured",
                Reason =
                    "Azure AI Evaluation is not configured. Set AZURE_OPENAI_ENDPOINT, " +
                    "AZURE_OPENAI_KEY and AZURE_OPENAI_DEPLOYMENT.",
            };
        }

        return evaluation.Type switch
        {
            "llm_judge" => await EvaluateLlmJudgeAsync(trace, evaluation, config, cancellationToken).ConfigureAwait(false),
            "custom" => await EvaluateCustomAsync(trace, evaluation, config, cancellationToken).ConfigureAwait(false),
            _ when DimensionTypes.Contains(evaluation.Type) =>
                await EvaluateDimensionAsync(trace, evaluation, config, cancellationToken).ConfigureAwait(false),
            _ => new EvalResult
            {
                Type = evaluation.Type,
                Adapter = "azure",
                Passed = false,
                Score = 0,
                Code = "adapter.unsupported_type",
                Reason = $"Azure adapter does not support evaluator type: {evaluation.Type}",
            },
        };
    }

    private static async Task<EvalResult> EvaluateLlmJudgeAsync(
        IReadOnlyList<ObservedStep> trace,
        Evaluation evaluation,
        RequiredConfig config,
        CancellationToken cancellationToken)
    {
        var criteria = evaluation.GetString("criteria") ?? "Is the response helpful and accurate?";
        var prompt = $"Given this conversation:\n\n{AbsTrace.TraceToText(trace)}\n\nEvaluate: {criteria}";
        try
        {
            var content = await ChatCompletionAsync(config, BuiltinJudge.JudgeSystem, prompt, false, cancellationToken)
                .ConfigureAwait(false);
            var result = BuiltinJudge.ParseJudgeResponse(content, "azure", evaluation.Threshold ?? 0.5);
            result.Adapter = "azure";
            return result;
        }
        catch (Exception error)
        {
            return Error("llm_judge", $"Azure judge error: {error.Message}");
        }
    }

    private static async Task<EvalResult> EvaluateDimensionAsync(
        IReadOnlyList<ObservedStep> trace,
        Evaluation evaluation,
        RequiredConfig config,
        CancellationToken cancellationToken)
    {
        var type = evaluation.Type;
        var selfContent = LastAssistantContent(trace);
        var response = AbsTrace.ResolveRef(trace, evaluation.GetString("response"), selfContent);
        if (string.IsNullOrEmpty(response)) response = selfContent;

        string criteria;
        if (type == "Groundedness")
        {
            var query = AbsTrace.ResolveRef(trace, evaluation.GetString("query"), selfContent);
            var context = AbsTrace.ResolveRef(trace, evaluation.GetString("context"), selfContent);
            criteria =
                "Evaluate whether the response is supported by the provided context. " +
                $"Context:\n{context}\nResponse:\n{response}";
        }
        else if (type == "Relevance")
        {
            var query = AbsTrace.ResolveRef(trace, evaluation.GetString("query"), selfContent);
            criteria = $"Evaluate whether the response addresses the query.\nQuery:\n{query}\nResponse:\n{response}";
        }
        else if (type == "Coherence")
        {
            criteria = $"Evaluate the logical coherence of the response.\nResponse:\n{response}";
        }
        else
        {
            criteria = $"Evaluate the quality of the response.\nResponse:\n{response}";
        }
        return await EvaluateRubricAsync(type, criteria, evaluation, config, cancellationToken).ConfigureAwait(false);
    }

    private static async Task<EvalResult> EvaluateCustomAsync(
        IReadOnlyList<ObservedStep> trace,
        Evaluation evaluation,
        RequiredConfig config,
        CancellationToken cancellationToken)
    {
        var id = evaluation.GetString("id") ?? "custom";
        var criteria = evaluation.GetString("criteria") ?? evaluation.GetString("prompt");
        criteria ??= id switch
        {
            "azure.task_adherence" =>
                "Evaluate whether the assistant followed the user's instructions and completed the task. " +
                "Consider goal adherence, rule adherence and procedural adherence.",
            "azure.intent_resolution" =>
                "Evaluate how well the assistant resolved the user's intent in the conversation.",
            "azure.tool_call_accuracy" =>
                "Evaluate the accuracy and relevance of the assistant's tool calls.",
            _ => null,
        };
        if (string.IsNullOrEmpty(criteria))
        {
            return new EvalResult
            {
                Type = "custom",
                Adapter = "azure",
                Passed = false,
                Score = 0,
                Code = "evaluator.missing_input",
                Reason = $"Azure custom evaluator '{id}' requires a 'criteria' or 'prompt' field.",
            };
        }

        var content = criteria + "\n\nConversation:\n" + AbsTrace.TraceToText(trace);
        var result = await EvaluateRubricAsync("custom", content, evaluation, config, cancellationToken).ConfigureAwait(false);
        result.Type = "custom";
        result.Reason = $"[{id}] {result.Reason}";
        return result;
    }

    private static async Task<EvalResult> EvaluateRubricAsync(
        string type,
        string criteria,
        Evaluation evaluation,
        RequiredConfig config,
        CancellationToken cancellationToken)
    {
        var system =
            "You are an expert evaluator. Score the response on a scale of 1 to 5 based on the criteria. " +
            "Be strict but fair. Output only a JSON object with keys: score (integer 1-5) and reason (string).";
        var user = criteria + "\n\nReturn the JSON object.";
        try
        {
            var content = await ChatCompletionAsync(config, system, user, true, cancellationToken).ConfigureAwait(false);
            var parsed = ParseJsonJudge(content);
            var score = NormalizeScore(parsed.Score);
            var threshold = evaluation.Threshold ?? 0.5;
            return new EvalResult
            {
                Type = type,
                Adapter = "azure",
                Passed = score >= threshold,
                Score = score,
                Reason = $"[azure] {(string.IsNullOrEmpty(parsed.Reason) ? $"score {score.ToString("F2", CultureInfo.InvariantCulture)}" : parsed.Reason)}",
                Details = parsed.Properties,
            };
        }
        catch (Exception error)
        {
            return Error(type, $"Azure {type} error: {error.Message}");
        }
    }

    private static async Task<string> ChatCompletionAsync(
        RequiredConfig config,
        string system,
        string user,
        bool json,
        CancellationToken cancellationToken)
    {
        var baseUrl = config.Endpoint.TrimEnd('/');
        var url =
            $"{baseUrl}/openai/deployments/{Uri.EscapeDataString(config.Deployment)}" +
            $"/chat/completions?api-version={Uri.EscapeDataString(config.ApiVersion)}";

        var body = new Dictionary<string, object?>
        {
            ["messages"] = new List<object?>
            {
                new Dictionary<string, object?> { ["role"] = "system", ["content"] = system },
                new Dictionary<string, object?> { ["role"] = "user", ["content"] = user },
            },
            ["temperature"] = 0,
            ["max_tokens"] = 800,
        };
        if (json) body["response_format"] = new Dictionary<string, object?> { ["type"] = "json_object" };

        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        request.Headers.TryAddWithoutValidation("api-key", config.ApiKey);

        using var response = await AbsAdapterHttp.Client.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var text = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            throw new AbsException($"Azure judge returned {(int)response.StatusCode}: {Preview(text)}");
        }

        using var document = JsonDocument.Parse(text);
        return document.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString() ?? "";
    }

    private static RequiredConfig? ResolveConfig()
    {
        var endpoint = _config.Endpoint ?? Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT");
        var apiKey = _config.ApiKey ?? Environment.GetEnvironmentVariable("AZURE_OPENAI_KEY");
        var deployment = _config.Deployment ?? Environment.GetEnvironmentVariable("AZURE_OPENAI_DEPLOYMENT");
        var apiVersion = _config.ApiVersion ?? Environment.GetEnvironmentVariable("AZURE_OPENAI_API_VERSION")
            ?? DefaultApiVersion;
        if (string.IsNullOrEmpty(endpoint) || string.IsNullOrEmpty(apiKey) || string.IsNullOrEmpty(deployment))
            return null;
        return new RequiredConfig(endpoint, apiKey, deployment, apiVersion);
    }

    private static (double? Score, string Reason, Dictionary<string, object?>? Properties) ParseJsonJudge(string content)
    {
        try
        {
            var match = Regex.Match(content, @"\{[\s\S]*\}");
            var json = match.Success ? match.Value : content;
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            double? score = null;
            if (root.TryGetProperty("score", out var scoreValue) && scoreValue.ValueKind == JsonValueKind.Number)
                score = scoreValue.GetDouble();
            else if (root.TryGetProperty("result", out var resultValue) && resultValue.ValueKind == JsonValueKind.Number)
                score = resultValue.GetDouble();
            var reason = root.TryGetProperty("reason", out var reasonValue) ? reasonValue.GetString() ?? "" : "";
            return (score, reason, null);
        }
        catch
        {
            var scoreMatch = Regex.Match(content, @"Score:\s*(\d+(?:\.\d+)?)", RegexOptions.IgnoreCase);
            var reasonMatch = Regex.Match(content, @"Reason:\s*(.+?)(?:\n|$)", RegexOptions.IgnoreCase);
            double? score = scoreMatch.Success &&
                            double.TryParse(scoreMatch.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
                ? parsed
                : null;
            return (score, reasonMatch.Success ? reasonMatch.Groups[1].Value.Trim() : Preview(content), null);
        }
    }

    private static double NormalizeScore(double? value)
    {
        if (value == null) return 0;
        var scaled = value.Value > 1 ? value.Value / 5.0 : value.Value;
        return Math.Max(0, Math.Min(1, scaled));
    }

    private static string LastAssistantContent(IReadOnlyList<ObservedStep> trace)
    {
        for (var i = trace.Count - 1; i >= 0; i--)
        {
            if (trace[i].Actor == "assistant" && trace[i].Content != null)
                return AbsTrace.ToText(trace[i].Content);
        }
        return "";
    }

    private static EvalResult Error(string type, string reason) => new()
    {
        Type = type,
        Adapter = "azure",
        Passed = false,
        Score = 0,
        Code = "adapter.error",
        Reason = reason,
    };

    private static string Preview(string value) => value.Length <= 200 ? value : value.Substring(0, 200);

    private sealed class RequiredConfig
    {
        public RequiredConfig(string endpoint, string apiKey, string deployment, string apiVersion)
        {
            Endpoint = endpoint;
            ApiKey = apiKey;
            Deployment = deployment;
            ApiVersion = apiVersion;
        }

        public string Endpoint { get; }
        public string ApiKey { get; }
        public string Deployment { get; }
        public string ApiVersion { get; }
    }
}
