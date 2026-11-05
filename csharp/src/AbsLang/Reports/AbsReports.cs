using System.Globalization;
using System.Text;
using System.Security;
using System.Text.Json;

namespace AbsLang;

/// <summary>Table, JSON and JUnit renderers for a run result.</summary>
public static class AbsReports
{
    public static string FormatJson(RunResult result)
    {
        var payload = new Dictionary<string, object?>
        {
            ["session"] = result.Session,
            ["agent"] = result.Agent,
            ["passed"] = result.Passed,
            ["steps_total"] = result.StepsTotal,
            ["steps_matched"] = result.StepsMatched,
            ["evaluations_total"] = result.EvaluationsTotal,
            ["evaluations_passed"] = result.EvaluationsPassed,
            ["trace"] = result.Steps.Select(SerializeStep).ToList(),
            ["chain_evaluations"] = result.ChainEvaluations.Select(SerializeEvaluation).ToList(),
        };

        return JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true });
    }

    public static string FormatTable(RunResult result, int? rowsTotal = null, int? rowsPassed = null)
    {
        var lines = new List<string>
        {
            "┌──────────────────────────────────────────────────────────────┐",
            "│  ABS — Results                                               │",
            "├──────────────────────────────────────────────────────────────┤",
            $"│  Session:  {Pad(result.Session, 52)}│",
            $"│  Agent:    {Pad(result.Agent, 52)}│",
        };

        if (rowsTotal != null)
        {
            lines.Add($"│  Dataset:  {Pad(rowsTotal.Value.ToString(CultureInfo.InvariantCulture), 48)}rows│");
        }

        lines.Add($"│  Result:   {(result.Passed ? "✅ PASSED" : "❌ FAILED")}".PadRight(64) + "│");

        if (rowsTotal != null && rowsPassed != null)
        {
            lines.Add($"│  Rows:     {rowsPassed}/{rowsTotal} passed".PadRight(64) + "│");
        }

        var skipped = result.Steps.Count(step => step.Skipped);
        var applicable = result.StepsTotal - skipped;
        lines.Add($"│  Steps:    {result.StepsMatched}/{applicable} matched{(skipped > 0 ? $" · {skipped} skipped" : "")} · {result.EvaluationsPassed}/{result.EvaluationsTotal} evaluations passed".PadRight(64) + "│");
        lines.Add("├────┬────────────────────────────────────┬──────────┬─────────┤");
        lines.Add("│  # │ Step                               │ Result   │         │");
        lines.Add("├────┼────────────────────────────────────┼──────────┼─────────┤");

        foreach (var step in result.Steps)
        {
            var description = Pad(StepDescription(step), 34);
            lines.Add(step.Sent
                ? $"│ {step.Step,2} │ {description} │    →     │   sent  │"
                : step.Skipped
                    ? $"│ {step.Step,2} │ {description} │    ⏭    │  skip   │"
                    : step.Matched
                        ? $"│ {step.Step,2} │ {description} │    ✅    │  match  │"
                        : $"│ {step.Step,2} │ {description} │    ❌    │  no match│");

            foreach (var evaluation in step.Evaluations)
            {
                var name = Pad(evaluation.Type, 28);
                var status = evaluation.Inconclusive ? "   ⚠️    │  incon  │"
                    : evaluation.Passed ? "   ✅    │   pass  │"
                    : "   ❌    │  FAIL  │";
                lines.Add($"│    │   └─ {name} │ {status}");
            }
        }

        foreach (var evaluation in result.ChainEvaluations)
        {
            var name = Pad($"chain: {evaluation.Type}", 34);
            var status = evaluation.Inconclusive ? "   ⚠️    │  incon  │"
                : evaluation.Passed ? "   ✅    │   pass  │"
                : "   ❌    │  FAIL  │";
            lines.Add($"│  C │ {name} │ {status}");
        }

        lines.Add("└────┴────────────────────────────────────┴──────────┴─────────┘");

        if (!result.Passed)
        {
            lines.Add("");
            lines.Add("❌ Some evaluations failed:");
            foreach (var step in result.Steps)
            {
                foreach (var evaluation in step.Evaluations.Where(e => !e.Passed && !e.Inconclusive))
                {
                    lines.Add($"  Step {step.Step} · {evaluation.Type}: {evaluation.Reason}");
                }
            }
            foreach (var evaluation in result.ChainEvaluations.Where(e => !e.Passed && !e.Inconclusive))
            {
                lines.Add($"  Chain · {evaluation.Type}: {evaluation.Reason}");
            }
        }

        return string.Join("\n", lines);
    }

    public static string FormatJunit(RunResult result)
    {
        var all = result.Steps.SelectMany(step => step.Evaluations).Concat(result.ChainEvaluations).ToList();
        var failures = all.Count(evaluation => !evaluation.Passed);

        var xml = new StringBuilder();
        xml.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        xml.Append($"<testsuite name=\"ABS: {Escape(result.Session)}\" tests=\"{all.Count}\" failures=\"{failures}\" errors=\"0\">\n");

        foreach (var step in result.Steps)
        {
            foreach (var evaluation in step.Evaluations)
            {
                xml.Append($"  <testcase classname=\"ABS\" name=\"Step {step.Step}: {Escape(evaluation.Type)}\" time=\"0\">\n");
                AppendJunitResult(xml, evaluation);
                xml.Append("  </testcase>\n");
            }
        }

        foreach (var evaluation in result.ChainEvaluations)
        {
            xml.Append($"  <testcase classname=\"ABS\" name=\"Chain: {Escape(evaluation.Type)}\" time=\"0\">\n");
            AppendJunitResult(xml, evaluation);
            xml.Append("  </testcase>\n");
        }

        xml.Append("</testsuite>\n");
        return xml.ToString();
    }

    private static void AppendJunitResult(StringBuilder xml, EvalResult evaluation)
    {
        if (evaluation.Inconclusive)
        {
            xml.Append($"    <skipped message=\"{Escape(evaluation.Reason)}\" />\n");
        }
        else if (!evaluation.Passed)
        {
            xml.Append($"    <failure message=\"{Escape(evaluation.Reason)}\">\n");
            xml.Append($"      Type: {Escape(evaluation.Type)}\n");
            xml.Append($"      Reason: {Escape(evaluation.Reason)}\n");
            xml.Append("    </failure>\n");
        }
    }

    private static Dictionary<string, object?> SerializeStep(StepResult step)
    {
        var behavior = new Dictionary<string, object?>
        {
            ["actor"] = step.Behavior.Actor,
            ["action"] = step.Behavior.Action,
        };
        if (step.Behavior.Target != null) behavior["target"] = step.Behavior.Target;
        if (step.Behavior.Content != null) behavior["content"] = step.Behavior.Content;

        return new Dictionary<string, object?>
        {
            ["step"] = step.Step,
            ["behavior"] = behavior,
            ["matched"] = step.Matched,
            ["sent"] = step.Sent,
            ["skipped"] = step.Skipped,
            ["observed"] = step.Observed == null ? null : SerializeObserved(step.Observed),
            ["evaluations"] = step.Evaluations.Select(SerializeEvaluation).ToList(),
        };
    }

    private static Dictionary<string, object?>? SerializeObserved(ObservedStep? observed)
    {
        if (observed == null) return null;
        var result = new Dictionary<string, object?>
        {
            ["actor"] = observed.Actor,
            ["action"] = observed.Action,
        };
        if (observed.Id != null) result["id"] = observed.Id;
        if (observed.Target != null) result["target"] = observed.Target;
        if (observed.Content != null) result["content"] = observed.Content;
        if (observed.With != null) result["with"] = observed.With;
        if (observed.ToolCallId != null) result["tool_call_id"] = observed.ToolCallId;
        return result;
    }

    private static Dictionary<string, object?> SerializeEvaluation(EvalResult evaluation)
    {
        var result = new Dictionary<string, object?>
        {
            ["type"] = evaluation.Type,
            ["passed"] = evaluation.Passed,
            ["score"] = evaluation.Score,
            ["reason"] = evaluation.Reason,
            ["blocking"] = evaluation.Blocking,
            ["inconclusive"] = evaluation.Inconclusive,
        };

        if (evaluation.Code != null) result["code"] = evaluation.Code;
        if (evaluation.Details != null) result["details"] = evaluation.Details;
        if (evaluation.Threshold != null) result["threshold"] = evaluation.Threshold;
        if (evaluation.Adapter != null) result["adapter"] = evaluation.Adapter;
        if (evaluation.DurationMs != null) result["durationMs"] = evaluation.DurationMs;
        return result;
    }

    private static string StepDescription(StepResult step)
    {
        var target = string.IsNullOrEmpty(step.Behavior.Target) ? "" : $" · {step.Behavior.Target}";
        return $"{step.Behavior.Actor} {step.Behavior.Action}{target}";
    }

    private static string Pad(string value, int width)
    {
        if (value.Length >= width) return value.Substring(0, width);
        return value.PadRight(width);
    }

    private static string Escape(string value) => SecurityElement.Escape(value) ?? "";
}
