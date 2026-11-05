using System.Globalization;
using System.Text.RegularExpressions;
using Amazon;
using Amazon.BedrockRuntime;
using Amazon.BedrockRuntime.Model;

namespace AbsLang.Adapters.Aws;

public sealed class AwsAdapterConfig
{
    public string? Region { get; set; }
    public string? Profile { get; set; }
    public string? EvaluatorModel { get; set; }
    /// <summary>Optional override for tests / custom transports.</summary>
    public Func<string, string, CancellationToken, Task<string>>? ConverseOverride { get; set; }
}

/// <summary>AWS Bedrock LLM-as-judge adapter (Converse API).</summary>
public static class AwsAdapter
{
    public const string DefaultModelId = "anthropic.claude-3-5-haiku-20241022-v1:0";

    private static AwsAdapterConfig _config = new();
    private static AmazonBedrockRuntimeClient? _client;

    public static void Configure(AwsAdapterConfig? config = null)
    {
        _config = config ?? new AwsAdapterConfig();
        if (!string.IsNullOrEmpty(_config.Region)) Environment.SetEnvironmentVariable("AWS_REGION", _config.Region);
        if (!string.IsNullOrEmpty(_config.Profile)) Environment.SetEnvironmentVariable("AWS_PROFILE", _config.Profile);
        _client = null;
    }

    public static void Register(bool asDefault = true, string name = "aws")
    {
        AbsAdapterRegistry.Register("llm_judge", EvaluateAsync, name);
        AbsAdapterRegistry.Register("custom", EvaluateAsync, name);
        if (asDefault)
        {
            AbsAdapterRegistry.Register("llm_judge", EvaluateAsync);
            AbsAdapterRegistry.Register("custom", EvaluateAsync);
        }

        AbsAdapterProviders.Register("aws", (type, applyAsDefault) =>
        {
            AbsAdapterRegistry.Register("llm_judge", EvaluateAsync, "aws");
            AbsAdapterRegistry.Register("custom", EvaluateAsync, "aws");
            if (type != null) AbsAdapterRegistry.Register(type, EvaluateAsync);
            else if (applyAsDefault)
            {
                AbsAdapterRegistry.Register("llm_judge", EvaluateAsync);
                AbsAdapterRegistry.Register("custom", EvaluateAsync);
            }
        });
    }

    public static async Task<EvalResult> EvaluateAsync(
        IReadOnlyList<ObservedStep> trace,
        Evaluation evaluation,
        CancellationToken cancellationToken = default)
    {
        return evaluation.Type switch
        {
            "llm_judge" => await EvaluateLlmJudgeAsync(trace, evaluation, cancellationToken).ConfigureAwait(false),
            "custom" => await EvaluateCustomAsync(trace, evaluation, cancellationToken).ConfigureAwait(false),
            _ => new EvalResult
            {
                Type = evaluation.Type,
                Adapter = "aws",
                Passed = false,
                Score = 0,
                Code = "adapter.unsupported_type",
                Reason = $"AWS adapter does not support '{evaluation.Type}' yet.",
            },
        };
    }

    private static async Task<EvalResult> EvaluateLlmJudgeAsync(
        IReadOnlyList<ObservedStep> trace,
        Evaluation evaluation,
        CancellationToken cancellationToken)
    {
        var criteria = evaluation.GetString("criteria") ?? "Is the response helpful and accurate?";
        var prompt = $"Given this conversation:\n\n{AbsTrace.TraceToText(trace)}\n\nEvaluate: {criteria}";
        var threshold = evaluation.Threshold ?? 0.5;

        try
        {
            var content = await ConverseAsync(BuiltinJudge.JudgeSystem, prompt, cancellationToken).ConfigureAwait(false);
            var (score, reason) = ParseJudgeResponse(content);
            if (score == null)
            {
                return Error("llm_judge", $"[aws] Could not parse score from: {Preview(content)}");
            }
            var normalized = Math.Max(0, Math.Min(1, score.Value));
            return new EvalResult
            {
                Type = "llm_judge",
                Adapter = "aws",
                Passed = normalized >= threshold,
                Score = normalized,
                Reason = $"[aws] {reason}",
            };
        }
        catch (Exception error)
        {
            return Error("llm_judge", $"AWS Bedrock error: {error.Message}");
        }
    }

    private static async Task<EvalResult> EvaluateCustomAsync(
        IReadOnlyList<ObservedStep> trace,
        Evaluation evaluation,
        CancellationToken cancellationToken)
    {
        var id = evaluation.GetString("id") ?? "custom";
        var template = evaluation.GetString("prompt") ?? evaluation.GetString("criteria");
        if (string.IsNullOrEmpty(template))
        {
            return new EvalResult
            {
                Type = "custom",
                Adapter = "aws",
                Passed = false,
                Score = 0,
                Code = "evaluator.missing_input",
                Reason = $"AWS custom evaluator '{id}' requires a 'prompt' (or 'criteria') field.",
            };
        }

        var selfContent = LastAssistantContent(trace);
        var prompt = Interpolate(template!, evaluation, trace, selfContent);
        var scaleMax = ScaleMax(evaluation.GetString("rating_scale") ?? "1-5");
        var system =
            $"You are an expert evaluator. Score the response on a scale of 1 to {scaleMax} " +
            "based on the given criteria. Be strict but fair. Respond in this format:\n\n" +
            $"Score: <number between 1 and {scaleMax}>\nReason: <one sentence explaining the score>";
        var threshold = evaluation.Threshold ?? 0.5;

        try
        {
            var content = await ConverseAsync(system, prompt, cancellationToken).ConfigureAwait(false);
            var (rawScore, reason) = ParseJudgeResponse(content);
            if (rawScore == null)
            {
                return Error("custom", $"[aws:{id}] Could not parse score from: {Preview(content)}");
            }
            var score = Normalize(rawScore.Value, scaleMax);
            return new EvalResult
            {
                Type = "custom",
                Adapter = "aws",
                Passed = score >= threshold,
                Score = score,
                Reason = $"[aws:{id}] {reason}",
            };
        }
        catch (Exception error)
        {
            return Error("custom", $"AWS Bedrock error: {error.Message}");
        }
    }

    private static async Task<string> ConverseAsync(string system, string prompt, CancellationToken cancellationToken)
    {
        if (_config.ConverseOverride != null)
        {
            return await _config.ConverseOverride(system, prompt, cancellationToken).ConfigureAwait(false);
        }

        _client ??= new AmazonBedrockRuntimeClient();
        var response = await _client.ConverseAsync(new ConverseRequest
        {
            ModelId = _config.EvaluatorModel ?? Environment.GetEnvironmentVariable("BEDROCK_EVALUATOR_MODEL_ID") ?? DefaultModelId,
            System = new List<SystemContentBlock> { new() { Text = system } },
            Messages = new List<Message>
            {
                new()
                {
                    Role = ConversationRole.User,
                    Content = new List<ContentBlock> { new() { Text = prompt } },
                },
            },
            InferenceConfig = new InferenceConfiguration { Temperature = 0, MaxTokens = 512 },
        }, cancellationToken).ConfigureAwait(false);

        return string.Concat(response.Output.Message.Content.Select(block => block.Text ?? ""));
    }

    public static (double? Score, string Reason) ParseJudgeResponse(string content)
    {
        double? score = null;
        var reason = Preview(content);
        var scoreMatch = Regex.Match(content, @"Score:\s*(\d+(?:\.\d+)?)");
        if (scoreMatch.Success &&
            double.TryParse(scoreMatch.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed))
        {
            score = parsed;
        }
        var reasonMatch = Regex.Match(content, @"Reason:\s*(.+?)(?:\n|$)", RegexOptions.IgnoreCase);
        if (reasonMatch.Success) reason = Preview(reasonMatch.Groups[1].Value.Trim());
        return (score, reason);
    }

    public static int ScaleMax(string ratingScale)
    {
        var match = Regex.Match(ratingScale, @"(\d+)\s*$");
        return match.Success ? int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture) : 5;
    }

    public static double Normalize(double value, int scaleMax)
    {
        var scaled = scaleMax > 1 ? value / scaleMax : value;
        return Math.Max(0, Math.Min(1, scaled));
    }

    public static string Interpolate(
        string template,
        Evaluation evaluation,
        IReadOnlyList<ObservedStep> trace,
        string selfContent)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["criteria"] = evaluation.GetString("criteria") ?? "",
            ["response"] = ResolveOrSelf(trace, evaluation.GetString("response"), selfContent),
            ["context"] = AbsTrace.ResolveRef(trace, evaluation.GetString("context"), selfContent),
            ["query"] = AbsTrace.ResolveRef(trace, evaluation.GetString("query"), selfContent),
            ["trace"] = AbsTrace.TraceToText(trace),
        };

        return Regex.Replace(template, @"\{\{(\w+)\}\}", match =>
            values.TryGetValue(match.Groups[1].Value, out var value) ? value : "");
    }

    private static string ResolveOrSelf(IReadOnlyList<ObservedStep> trace, string? reference, string selfContent)
    {
        var resolved = AbsTrace.ResolveRef(trace, reference, selfContent);
        return string.IsNullOrEmpty(resolved) ? selfContent : resolved;
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
        Adapter = "aws",
        Passed = false,
        Score = 0,
        Code = "adapter.error",
        Reason = reason,
    };

    private static string Preview(string value) => value.Length <= 200 ? value : value.Substring(0, 200);
}
