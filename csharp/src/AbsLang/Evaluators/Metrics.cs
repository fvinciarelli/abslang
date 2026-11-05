using System.Globalization;
using System.Text.RegularExpressions;

namespace AbsLang;

public static partial class AbsEvaluators
{
    public const int BleuMaxN = 4;
    public static readonly string[] RougeVariants = { "rouge1", "rouge2", "rougeL" };
    public static readonly string[] RougeMetrics = { "precision", "recall", "f1" };

    private static readonly Regex TokenRegex = new(@"[\p{L}\p{N}_]+", RegexOptions.Compiled);

    private static List<string> Tokenize(object? text) =>
        TokenRegex.Matches((text == null ? "" : AbsValues.Stringify(text)).ToLowerInvariant())
            .Cast<Match>()
            .Select(match => match.Value)
            .ToList();

    private static Dictionary<string, int> NgramCounts(List<string> tokens, int n)
    {
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var i = 0; i + n <= tokens.Count; i++)
        {
            var key = string.Join("\u0001", tokens.Skip(i).Take(n));
            counts[key] = counts.TryGetValue(key, out var count) ? count + 1 : 1;
        }
        return counts;
    }

    private static int OverlapCount(Dictionary<string, int> left, Dictionary<string, int> right)
    {
        var total = 0;
        foreach (var pair in left)
        {
            if (right.TryGetValue(pair.Key, out var other)) total += Math.Min(pair.Value, other);
        }
        return total;
    }

    private static (double Precision, double Recall, double F1) Prf(int overlap, int totalObserved, int totalReference)
    {
        var precision = totalObserved != 0 ? (double)overlap / totalObserved : 0;
        var recall = totalReference != 0 ? (double)overlap / totalReference : 0;
        var f1 = precision + recall != 0 ? 2 * precision * recall / (precision + recall) : 0;
        return (precision, recall, f1);
    }

    public static (double Score, Dictionary<string, object?> Details) F1ScoreMetric(
        string response,
        string groundTruth)
    {
        var observed = Tokenize(response);
        var reference = Tokenize(groundTruth);
        if (observed.Count == 0 || reference.Count == 0)
        {
            var empty = Prf(0, observed.Count, reference.Count);
            return (0, new Dictionary<string, object?>
            {
                ["precision"] = empty.Precision,
                ["recall"] = empty.Recall,
                ["f1"] = empty.F1,
            });
        }

        var overlap = OverlapCount(NgramCounts(observed, 1), NgramCounts(reference, 1));
        var scores = Prf(overlap, observed.Count, reference.Count);
        return (scores.F1, new Dictionary<string, object?>
        {
            ["precision"] = scores.Precision,
            ["recall"] = scores.Recall,
            ["f1"] = scores.F1,
        });
    }

    public static (double Score, Dictionary<string, object?> Details) BleuMetric(
        string response,
        string groundTruth)
    {
        var observed = Tokenize(response);
        var reference = Tokenize(groundTruth);
        if (observed.Count == 0 || reference.Count == 0)
        {
            return (0, new Dictionary<string, object?>
            {
                ["precisions"] = new List<double>(),
                ["brevity_penalty"] = 0.0,
            });
        }

        var precisions = new List<double>();
        for (var n = 1; n <= BleuMaxN; n++)
        {
            var total = observed.Count - n + 1;
            if (total <= 0) continue;
            var matches = OverlapCount(NgramCounts(observed, n), NgramCounts(reference, n));
            precisions.Add((matches + 1.0) / (total + 1.0));
        }

        if (precisions.Count == 0)
        {
            return (0, new Dictionary<string, object?>
            {
                ["precisions"] = new List<double>(),
                ["brevity_penalty"] = 0.0,
            });
        }

        var logMean = precisions.Sum(value => Math.Log(value)) / precisions.Count;
        var brevityPenalty = Math.Min(1.0, Math.Exp(1.0 - (double)reference.Count / observed.Count));
        return (brevityPenalty * Math.Exp(logMean), new Dictionary<string, object?>
        {
            ["precisions"] = precisions,
            ["brevity_penalty"] = brevityPenalty,
        });
    }

    private static int LcsLength(IReadOnlyList<string> left, IReadOnlyList<string> right)
    {
        if (left.Count == 0 || right.Count == 0) return 0;
        var previous = new int[right.Count + 1];
        foreach (var item in left)
        {
            var current = new int[right.Count + 1];
            for (var j = 1; j <= right.Count; j++)
            {
                current[j] = item == right[j - 1]
                    ? previous[j - 1] + 1
                    : Math.Max(previous[j], current[j - 1]);
            }
            previous = current;
        }
        return previous[right.Count];
    }

    public static (double Score, Dictionary<string, object?> Details) RougeMetric(
        string response,
        string groundTruth,
        string variant = "rougeL")
    {
        var observed = Tokenize(response);
        var reference = Tokenize(groundTruth);
        (double Precision, double Recall, double F1) scores;

        if (variant == "rougeL")
        {
            var lcs = LcsLength(observed, reference);
            scores = Prf(lcs, observed.Count, reference.Count);
        }
        else
        {
            var n = variant == "rouge1" ? 1 : 2;
            var observedNgrams = NgramCounts(observed, n);
            var referenceNgrams = NgramCounts(reference, n);
            var overlap = OverlapCount(observedNgrams, referenceNgrams);
            var totalObserved = observedNgrams.Values.Sum();
            var totalReference = referenceNgrams.Values.Sum();
            scores = Prf(overlap, totalObserved, totalReference);
        }

        return (scores.F1, new Dictionary<string, object?>
        {
            ["precision"] = scores.Precision,
            ["recall"] = scores.Recall,
            ["f1"] = scores.F1,
            ["variant"] = variant,
        });
    }

    public static EvalResult F1Eval(
        ObservedStep? observed,
        Evaluation rule,
        IReadOnlyList<ObservedStep> trace,
        Behavior? behavior = null)
    {
        return ReferenceMetric("f1", F1ScoreMetric, observed, rule, trace, behavior);
    }

    public static EvalResult BleuEval(
        ObservedStep? observed,
        Evaluation rule,
        IReadOnlyList<ObservedStep> trace,
        Behavior? behavior = null)
    {
        return ReferenceMetric("bleu", BleuMetric, observed, rule, trace, behavior);
    }

    public static EvalResult RougeEval(
        ObservedStep? observed,
        Evaluation rule,
        IReadOnlyList<ObservedStep> trace,
        Behavior? behavior = null)
    {
        var variant = rule.GetString("variant") ?? "rougeL";
        var metric = rule.GetString("metric") ?? "f1";
        if (!RougeVariants.Contains(variant))
        {
            return new EvalResult
            {
                Type = "rouge",
                Passed = false,
                Score = 0,
                Code = "evaluator.invalid_option",
                Reason = $"rouge: unknown variant \"{variant}\" (use rouge1, rouge2, rougeL)",
            };
        }
        if (!RougeMetrics.Contains(metric))
        {
            return new EvalResult
            {
                Type = "rouge",
                Passed = false,
                Score = 0,
                Code = "evaluator.invalid_option",
                Reason = $"rouge: unknown metric \"{metric}\" (use precision, recall, f1)",
            };
        }

        (double Score, Dictionary<string, object?> Details) Compute(string response, string groundTruth)
        {
            var result = RougeMetric(response, groundTruth, variant);
            var details = new Dictionary<string, object?>(result.Details) { ["metric"] = metric };
            var score = metric switch
            {
                "precision" => Convert.ToDouble(result.Details["precision"], CultureInfo.InvariantCulture),
                "recall" => Convert.ToDouble(result.Details["recall"], CultureInfo.InvariantCulture),
                _ => Convert.ToDouble(result.Details["f1"], CultureInfo.InvariantCulture),
            };
            return (score, details);
        }

        return ReferenceMetric("rouge", Compute, observed, rule, trace, behavior);
    }

    private static EvalResult ReferenceMetric(
        string type,
        Func<string, string, (double Score, Dictionary<string, object?> Details)> compute,
        ObservedStep? observed,
        Evaluation rule,
        IReadOnlyList<ObservedStep> trace,
        Behavior? behavior)
    {
        string response;
        string groundTruth;
        try
        {
            (response, groundTruth) = ResolveMetricInputs(observed, rule, trace, behavior);
        }
        catch (Exception error)
        {
            return new EvalResult
            {
                Type = type,
                Passed = false,
                Score = 0,
                Code = "evaluator.missing_input",
                Reason = $"{type}: {error.Message}",
            };
        }

        double score;
        Dictionary<string, object?> details;
        try
        {
            (score, details) = compute(response, groundTruth);
        }
        catch (Exception error)
        {
            return new EvalResult
            {
                Type = type,
                Passed = false,
                Score = 0,
                Code = "evaluator.invalid_option",
                Reason = $"{type}: {error.Message}",
            };
        }

        return new EvalResult
        {
            Type = type,
            Passed = score >= 0.5,
            Score = score,
            Reason = $"{type}: score {score.ToString("F2", CultureInfo.InvariantCulture)}",
            Details = details,
        };
    }

    private static (string Response, string GroundTruth) ResolveMetricInputs(
        ObservedStep? observed,
        Evaluation rule,
        IReadOnlyList<ObservedStep> trace,
        Behavior? behavior)
    {
        var declared = behavior?.Content != null ? ValueToText(behavior.Content) : "";
        var observedText = observed != null ? ValueToText(observed.Content) : LastAssistantText(trace);

        var groundTruthRef = rule.GetString("ground_truth");
        if (string.IsNullOrEmpty(groundTruthRef))
        {
            throw new AbsException("requires a \"ground_truth\" field");
        }

        var groundTruth = groundTruthRef == "self"
            ? (declared.Length > 0 ? declared : observedText)
            : (AbsTrace.ResolveRef(trace, groundTruthRef, declared) is { Length: > 0 } resolved
                ? resolved
                : declared);

        var responseRef = rule.GetString("response");
        var response = string.IsNullOrEmpty(responseRef) || responseRef == "self"
            ? observedText
            : (AbsTrace.ResolveRef(trace, responseRef, observedText) is { Length: > 0 } resolvedResponse
                ? resolvedResponse
                : observedText);

        return (response, groundTruth);
    }

    private static string ValueToText(object? value)
    {
        if (value == null) return "";
        return value is string text ? text : AbsValues.Stringify(value);
    }

    private static string LastAssistantText(IReadOnlyList<ObservedStep> trace)
    {
        for (var i = trace.Count - 1; i >= 0; i--)
        {
            var step = trace[i];
            if (step.Actor == "assistant" && step.Content != null) return ValueToText(step.Content);
        }
        return "";
    }
}
