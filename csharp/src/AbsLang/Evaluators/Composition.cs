using System.Globalization;

namespace AbsLang;

public static partial class AbsEvaluators
{
    public static EvalResult EvaluateComposition(
        ObservedStep? observed,
        IReadOnlyList<ObservedStep> trace,
        Evaluation rule,
        IReadOnlyList<Behavior> behaviors)
    {
        var nested = new List<Evaluation>();
        var raw = rule.GetList("evaluations");
        if (raw != null)
        {
            foreach (var item in raw)
            {
                if (item is Dictionary<string, object?> map) nested.Add(EvaluationFrom(map));
            }
        }

        var results = nested
            .Select(item => EvaluateStep(observed, item, behaviors, trace))
            .ToList();

        var average = results.Count > 0 ? results.Average(item => item.Score) : 0;
        var passed = rule.Type switch
        {
            "all_of" => results.All(item => item.Passed),
            "any_of" => results.Any(item => item.Passed),
            "none_of" => results.All(item => !item.Passed),
            _ => false,
        };

        return new EvalResult
        {
            Type = rule.Type,
            Passed = passed,
            Score = average,
            Reason =
                $"{results.Count(item => item.Passed)}/{results.Count} sub-evaluations passed " +
                $"(avg score: {average.ToString("F2", CultureInfo.InvariantCulture)})",
        };
    }

    internal static Evaluation EvaluationFrom(Dictionary<string, object?> map)
    {
        var evaluation = new Evaluation();
        foreach (var pair in map) evaluation.Data[pair.Key] = pair.Value;
        return evaluation;
    }
}
