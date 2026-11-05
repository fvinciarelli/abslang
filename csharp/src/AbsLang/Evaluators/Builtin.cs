using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AbsLang;

/// <summary>
/// Built-in deterministic evaluators. LLM-based evaluators and cloud adapters
/// are registered separately (later phases).
/// </summary>
public static partial class AbsEvaluators
{
    private static readonly Regex VariableRegex = new(@"\{\{([A-Za-z0-9_.]+)\}\}", RegexOptions.Compiled);

    // ── Step-level dispatch ─────────────────────────────────────────────────

    public static EvalResult EvaluateStep(
        ObservedStep? observed,
        Evaluation rule,
        IReadOnlyList<Behavior> behaviors,
        IReadOnlyList<ObservedStep> trace,
        Behavior? behavior = null)
    {
        EvalResult result = rule.Type switch
        {
            "exact_match" => ExactMatch(observed?.Content, rule),
            "contains" => Contains(observed?.Content, rule),
            "regex" => RegexEval(observed?.Content, rule),
            "schema" => SchemaEval(observed?.Content, rule),
            "tool_call" => ToolCall(trace, rule),
            "sequence" => Sequence(trace, rule),
            "eventually" => Eventually(trace, rule),
            "never" => Never(trace, rule),
            "count" => Count(trace, rule),
            "within" => Within(trace, rule),
            "variable_consistency" => VariableConsistency(behaviors, rule),
            "f1" => F1Eval(observed, rule, trace, behavior),
            "bleu" => BleuEval(observed, rule, trace, behavior),
            "rouge" => RougeEval(observed, rule, trace, behavior),
            "all_of" or "any_of" or "none_of" => EvaluateComposition(observed, trace, rule, behaviors),
            "llm_judge" or "Groundedness" or "Relevance" or "Coherence" or "Fluency"
                or "HateUnfairness" or "Violence" or "Sexual" or "SelfHarm" => new EvalResult
            {
                Type = rule.Type,
                Passed = false,
                Score = 0,
                Code = "adapter.not_configured",
                Reason = $"No adapter registered for {rule.Type}. Register one with AbsAdapterRegistry.Register(...).",
            },
            "custom" => new EvalResult
            {
                Type = "custom",
                Passed = false,
                Score = 0,
                Code = "adapter.not_configured",
                Reason = "No custom evaluator adapter registered.",
            },
            _ => new EvalResult
            {
                Type = rule.Type,
                Passed = false,
                Score = 0,
                Code = "evaluator.unsupported",
                Reason = $"Evaluator '{rule.Type}' is not implemented in this build.",
            },
        };

        result.Blocking = rule.Blocking;
        return ApplyThreshold(result, rule);
    }

    public static EvalResult ApplyThreshold(EvalResult result, Evaluation rule)
    {
        result.Adapter ??= rule.Adapter;
        if (rule.Threshold is { } threshold)
        {
            result.Threshold = threshold;
            if (result.Score < threshold)
            {
                result.Passed = false;
                result.Reason = $"{result.Reason} (score {result.Score} < threshold {threshold})";
                result.Code ??= "evaluator.threshold_not_met";
            }
        }
        return result;
    }

    // ── Deterministic step evaluators ───────────────────────────────────────

    public static EvalResult ExactMatch(object? observed, Evaluation rule)
    {
        var expected = rule.Get("value");
        var passed = AbsValues.DeepEquals(observed, expected);
        return new EvalResult
        {
            Type = "exact_match",
            Passed = passed,
            Score = passed ? 1 : 0,
            Reason = passed
                ? $"Content matches \"{AbsValues.Stringify(expected)}\""
                : $"Expected \"{AbsValues.Stringify(expected)}\", got \"{AbsValues.Stringify(observed)}\"",
        };
    }

    public static EvalResult Contains(object? observed, Evaluation rule)
    {
        var text = ToText(observed);
        var expected = rule.GetString("value") ?? "";
        var passed = text.IndexOf(expected, StringComparison.OrdinalIgnoreCase) >= 0;
        return new EvalResult
        {
            Type = "contains",
            Passed = passed,
            Score = passed ? 1 : 0,
            Reason = passed
                ? $"Content contains \"{expected}\""
                : $"Expected content to contain \"{expected}\", got \"{Truncate(text, 100)}\"",
        };
    }

    public static EvalResult RegexEval(object? observed, Evaluation rule)
    {
        var text = ToText(observed);
        var pattern = rule.GetString("pattern") ?? "";
        var passed = Regex.IsMatch(text, pattern);
        return new EvalResult
        {
            Type = "regex",
            Passed = passed,
            Score = passed ? 1 : 0,
            Reason = passed
                ? $"Content matches /{pattern}/"
                : $"Expected content to match /{pattern}/, got \"{Truncate(text, 100)}\"",
        };
    }

    public static EvalResult SchemaEval(object? observed, Evaluation rule)
    {
        var schema = rule.GetMap("schema");
        if (observed is not Dictionary<string, object?> map || schema == null)
        {
            return Fail("schema", $"Expected an object, got {observed?.GetType().Name ?? "null"}");
        }

        var required = new List<string>();
        if (schema.TryGetValue("required", out var requiredValue) && requiredValue is List<object?> requiredList)
        {
            required = requiredList.Select(item => item?.ToString() ?? "").ToList();
        }

        var properties = schema.TryGetValue("properties", out var propertiesValue) &&
                         propertiesValue is Dictionary<string, object?> propertiesMap
            ? propertiesMap
            : new Dictionary<string, object?>();

        var additional = !(schema.TryGetValue("additionalProperties", out var additionalValue) &&
                           additionalValue is false);

        foreach (var key in required)
        {
            if (!map.ContainsKey(key)) return Fail("schema", $"Missing required field: \"{key}\"");
        }

        if (!additional)
        {
            foreach (var key in map.Keys)
            {
                if (!properties.ContainsKey(key)) return Fail("schema", $"Unexpected field: \"{key}\" (additionalProperties: false)");
            }
        }

        foreach (var pair in properties)
        {
            if (!map.TryGetValue(pair.Key, out var value)) continue;
            if (pair.Value is not Dictionary<string, object?> propertySchema) continue;

            var type = propertySchema.TryGetValue("type", out var typeValue) ? typeValue?.ToString() : null;
            if (type == "string" && value is not string)
            {
                return Fail("schema", $"Field \"{pair.Key}\" expected string, got {value?.GetType().Name ?? "null"}");
            }

            if (propertySchema.TryGetValue("enum", out var enumValue) && enumValue is List<object?> allowed &&
                !allowed.Any(item => AbsValues.DeepEquals(item, value)))
            {
                return Fail("schema", $"Field \"{pair.Key}\" must be one of [{string.Join(", ", allowed.Select(AbsValues.Stringify))}], got \"{AbsValues.Stringify(value)}\"");
            }
        }

        return Pass("schema", "Content matches schema");
    }

    // ── Tool call ───────────────────────────────────────────────────────────

    public static EvalResult ToolCall(IReadOnlyList<ObservedStep> trace, Evaluation rule)
    {
        var calls = trace.Where(step => step.Actor == "assistant" && step.Action == "calls").ToList();
        var target = rule.GetString("target");

        if (target != null)
        {
            var matching = calls.Where(call => call.Target == target).ToList();
            if (matching.Count == 0)
            {
                return Fail("tool_call", $"Tool \"{target}\" was never called. Observed calls: {string.Join(", ", calls.Select(c => c.Target))}");
            }

            var expectedWith = rule.GetMap("with");
            if (expectedWith != null)
            {
                foreach (var call in matching)
                {
                    var observedWith = call.With ?? new Dictionary<string, object?>(StringComparer.Ordinal);
                    foreach (var pair in expectedWith)
                    {
                        if (!observedWith.TryGetValue(pair.Key, out var value))
                        {
                            return Fail("tool_call", $"Tool \"{target}\" missing parameter \"{pair.Key}\". Observed: {AbsValues.Stringify(observedWith)}");
                        }
                        if (!AbsValues.DeepEquals(value, pair.Value))
                        {
                            return Fail("tool_call", $"Tool \"{target}\" parameter \"{pair.Key}\" expected {AbsValues.Stringify(pair.Value)}, got {AbsValues.Stringify(value)}");
                        }
                    }
                }
            }

            return Pass("tool_call", $"Tool \"{target}\" called correctly");
        }

        if (calls.Count == 0) return Fail("tool_call", "No tool calls observed in the trace");
        return Pass("tool_call", $"{calls.Count} tool call(s) observed");
    }

    // ── Chain evaluators ────────────────────────────────────────────────────

    public static bool MatchesSelector(ObservedStep step, Selector selector)
    {
        if (selector.Actor != null && step.Actor != selector.Actor) return false;
        if (selector.Action != null && step.Action != selector.Action) return false;
        if (selector.Target != null && step.Target != selector.Target) return false;
        return true;
    }

    public static EvalResult Sequence(IReadOnlyList<ObservedStep> trace, Evaluation rule)
    {
        var order = rule.GetList("order") ?? new List<object?>();
        var traceIndex = 0;
        foreach (var entry in order)
        {
            var selector = SelectorFrom(entry);
            var found = false;
            while (traceIndex < trace.Count)
            {
                if (MatchesSelector(trace[traceIndex], selector))
                {
                    found = true;
                    traceIndex++;
                    break;
                }
                traceIndex++;
            }
            if (!found)
            {
                return Fail("sequence", $"Step not found in expected order: {AbsValues.Stringify(entry)}");
            }
        }
        return Pass("sequence", $"All {order.Count} steps found in order");
    }

    public static EvalResult Eventually(IReadOnlyList<ObservedStep> trace, Evaluation rule)
    {
        var selector = SelectorFrom(rule.Get("match"));
        var found = trace.Any(step => MatchesSelector(step, selector));
        return found
            ? Pass("eventually", "Found matching step")
            : Fail("eventually", $"Never found step matching {AbsValues.Stringify(rule.Get("match"))}");
    }

    public static EvalResult Never(IReadOnlyList<ObservedStep> trace, Evaluation rule)
    {
        var selector = SelectorFrom(rule.Get("match"));
        var found = trace.Any(step => MatchesSelector(step, selector));
        return found
            ? Fail("never", $"Found disallowed step matching {AbsValues.Stringify(rule.Get("match"))}")
            : Pass("never", "Disallowed step never occurred");
    }

    public static EvalResult Count(IReadOnlyList<ObservedStep> trace, Evaluation rule)
    {
        var selector = SelectorFrom(rule.Get("match"));
        var count = trace.Count(step => MatchesSelector(step, selector));
        var min = (int?)rule.GetDouble("min");
        var max = (int?)rule.GetDouble("max");
        var passed = (min == null || count >= min) && (max == null || count <= max);
        var range = $"[{min?.ToString() ?? "0"}, {max?.ToString() ?? "∞"}]";
        return passed
            ? Pass("count", $"Count {count} within {range}")
            : Fail("count", $"Count {count} outside {range}");
    }

    public static EvalResult Within(IReadOnlyList<ObservedStep> trace, Evaluation rule)
    {
        var after = SelectorFrom(rule.Get("after"));
        var match = SelectorFrom(rule.Get("match"));
        var maxSteps = (int)(rule.GetDouble("max_steps") ?? 0);

        var afterIndex = -1;
        for (var i = 0; i < trace.Count; i++)
        {
            if (MatchesSelector(trace[i], after))
            {
                afterIndex = i;
                break;
            }
        }

        if (afterIndex == -1)
        {
            return Fail("within", $"\"after\" selector never matched: {AbsValues.Stringify(rule.Get("after"))}");
        }

        for (var i = afterIndex + 1; i <= afterIndex + maxSteps && i < trace.Count; i++)
        {
            if (MatchesSelector(trace[i], match))
            {
                return Pass("within", $"Found within {i - afterIndex} steps (max {maxSteps})");
            }
        }

        return Fail("within", $"Not found within {maxSteps} steps of {AbsValues.Stringify(rule.Get("after"))}");
    }

    public static EvalResult VariableConsistency(IReadOnlyList<Behavior> behaviors, Evaluation rule)
    {
        var variable = rule.GetString("variable") ?? "";
        var values = new List<(object? Value, string Source)>();
        var variables = new Dictionary<string, object?>(StringComparer.Ordinal);

        foreach (var behavior in behaviors)
        {
            var resolvedWith = ResolveVarRefs(behavior.With, variables);
            var resolvedContent = ResolveVarRefs(behavior.Content, variables);

            if (behavior.With != null && HasVarRef(behavior.With, variable))
            {
                var value = DeepGet(resolvedWith, variable);
                if (value != null) values.Add((value, $"with in step {behavior.Actor}/{behavior.Action}"));
            }

            if (behavior.Content is string content && content.Contains("{{" + variable + "}}"))
            {
                values.Add((resolvedContent, $"content in step {behavior.Actor}/{behavior.Action}"));
            }

            if (behavior.Capture != null && behavior.Capture.TryGetValue(variable, out var captured))
            {
                var value = ResolveVarRefs(captured, variables);
                variables[variable] = value;
                values.Add((value, $"capture in step {behavior.Actor}/{behavior.Action}"));
            }
        }

        if (values.Count <= 1)
        {
            return Pass("variable_consistency", $"Variable \"{variable}\" used {values.Count} time(s) — nothing to compare");
        }

        var first = values[0].Value;
        var consistent = values.All(value => AbsValues.DeepEquals(value.Value, first));
        if (consistent)
        {
            return Pass("variable_consistency", $"Variable \"{variable}\" consistent across {values.Count} uses");
        }

        var details = string.Join(", ", values.Select(value => $"{value.Source}: {AbsValues.Stringify(value.Value)}"));
        return Fail("variable_consistency", $"Variable \"{variable}\" has inconsistent values: {details}");
    }

    // ── Conditional evaluators (v0.2) ───────────────────────────────────────

    public static EvalResult Expected(
        IReadOnlyList<StepResult> stepResults,
        Evaluation rule,
        IReadOnlyDictionary<string, object?> rowVars)
    {
        if (!EvalWhen(rule.GetString("when"), rowVars))
        {
            return Pass("expected", "when condition not met — skipped");
        }

        var behaviorId = rule.GetString("behavior");
        var reference = stepResults.FirstOrDefault(step => step.Behavior.Id == behaviorId);
        if (reference == null)
        {
            return Fail("expected", $"Behavior \"{behaviorId}\" not found in trace");
        }

        if (!reference.Matched)
        {
            return Fail("expected", rule.GetString("reason") ?? $"Expected behavior \"{behaviorId}\" to match, but it did not");
        }

        if (rule.GetMap("after") is { } after)
        {
            var selector = SelectorFrom(after);
            var afterIndex = -1;
            for (var i = 0; i < stepResults.Count; i++)
            {
                if (MatchesSelectorOnBehavior(stepResults[i].Behavior, selector)) { afterIndex = i; break; }
            }
            var referenceIndex = -1;
            for (var i = 0; i < stepResults.Count; i++)
            {
                if (ReferenceEquals(stepResults[i], reference)) { referenceIndex = i; break; }
            }
            if (afterIndex == -1 || referenceIndex <= afterIndex)
            {
                return Fail("expected", rule.GetString("reason") ??
                    $"Expected \"{behaviorId}\" to match after {AbsValues.Stringify(after)}, but it did not");
            }
        }

        return Pass("expected", $"Behavior \"{behaviorId}\" matched as expected");
    }

    public static bool EvalWhen(string? expression, IReadOnlyDictionary<string, object?> rowVars)
    {
        if (string.IsNullOrWhiteSpace(expression)) return true;

        var resolved = VariableRegex.Replace(expression, match =>
        {
            var name = match.Groups[1].Value;
            return rowVars.TryGetValue(name, out var value) ? ToLiteral(value) : "null";
        });

        try
        {
            var parser = new WhenParser(resolved);
            var value = parser.Parse();
            return Truthy(value);
        }
        catch
        {
            return false;
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private static EvalResult Pass(string type, string reason) =>
        new() { Type = type, Passed = true, Score = 1, Reason = reason };

    private static EvalResult Fail(string type, string reason) =>
        new() { Type = type, Passed = false, Score = 0, Reason = reason };

    private static string ToText(object? value) =>
        value is string text ? text : AbsValues.Stringify(value);

    private static string Truncate(string value, int length) =>
        value.Length <= length ? value : value.Substring(0, length);

    internal static Selector SelectorFrom(object? value)
    {
        if (value is not Dictionary<string, object?> map) return new Selector();
        return new Selector
        {
            Actor = map.TryGetValue("actor", out var actor) ? actor?.ToString() : null,
            Action = map.TryGetValue("action", out var action) ? action?.ToString() : null,
            Target = map.TryGetValue("target", out var target) ? target?.ToString() : null,
        };
    }

    private static bool MatchesSelectorOnBehavior(Behavior behavior, Selector selector)
    {
        if (selector.Actor != null && behavior.Actor != selector.Actor) return false;
        if (selector.Action != null && behavior.Action != selector.Action) return false;
        if (selector.Target != null && behavior.Target != selector.Target) return false;
        return true;
    }

    private static bool HasVarRef(object? value, string name)
    {
        return value switch
        {
            string text => text.Contains("{{" + name + "}}"),
            Dictionary<string, object?> map => map.Values.Any(item => HasVarRef(item, name)),
            IReadOnlyList<object?> list => list.Any(item => HasVarRef(item, name)),
            _ => false,
        };
    }

    private static object? ResolveVarRefs(object? value, IReadOnlyDictionary<string, object?> variables)
    {
        switch (value)
        {
            case string text:
                return VariableRegex.Replace(text, match =>
                {
                    var name = match.Groups[1].Value;
                    return variables.TryGetValue(name, out var resolved)
                        ? AbsValues.Stringify(resolved)
                        : match.Value;
                });
            case Dictionary<string, object?> map:
                var resolvedMap = new Dictionary<string, object?>(StringComparer.Ordinal);
                foreach (var pair in map) resolvedMap[pair.Key] = ResolveVarRefs(pair.Value, variables);
                return resolvedMap;
            case List<object?> list:
                return list.Select(item => ResolveVarRefs(item, variables)).ToList();
            default:
                return value;
        }
    }

    private static object? DeepGet(object? value, string key)
    {
        if (value is Dictionary<string, object?> map)
        {
            if (map.TryGetValue(key, out var direct)) return direct;
            foreach (var item in map.Values)
            {
                var found = DeepGet(item, key);
                if (found != null) return found;
            }
        }
        else if (value is IReadOnlyList<object?> list)
        {
            foreach (var item in list)
            {
                var found = DeepGet(item, key);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static string ToLiteral(object? value)
    {
        switch (value)
        {
            case null: return "null";
            case bool b: return b ? "true" : "false";
            case string s: return JsonSerializer.Serialize(s);
            case long l: return l.ToString(CultureInfo.InvariantCulture);
            case int i: return i.ToString(CultureInfo.InvariantCulture);
            case double d: return d.ToString("R", CultureInfo.InvariantCulture);
            case decimal m: return m.ToString(CultureInfo.InvariantCulture);
            default: return JsonSerializer.Serialize(value);
        }
    }

    private static bool Truthy(object? value) => value switch
    {
        null => false,
        bool b => b,
        string s => s.Length > 0,
        _ when AbsValues.IsNumber(value) => AbsValues.ToDouble(value) != 0,
        _ => true,
    };

    // ── Tiny expression parser for `when` ───────────────────────────────────

    private sealed class WhenParser
    {
        private readonly string _text;
        private int _index;

        public WhenParser(string text) => _text = text;

        public object? Parse()
        {
            var value = ParseOr();
            SkipWhitespace();
            if (_index != _text.Length)
            {
                throw new FormatException($"Unexpected token at {_index}: {_text.Substring(_index)}");
            }
            return value;
        }

        private object? ParseOr()
        {
            var value = ParseAnd();
            while (MatchWord("or") || Match("||"))
            {
                var right = ParseAnd();
                value = Truthy(value) || Truthy(right);
            }
            return value;
        }

        private object? ParseAnd()
        {
            var value = ParseComparison();
            while (MatchWord("and") || Match("&&"))
            {
                var right = ParseComparison();
                value = Truthy(value) && Truthy(right);
            }
            return value;
        }

        private object? ParseComparison()
        {
            var left = ParseUnary();
            SkipWhitespace();

            string? op = null;
            foreach (var candidate in new[] { "===", "!==", "==", "!=", "<=", ">=", "<", ">" })
            {
                if (Match(candidate))
                {
                    op = candidate;
                    break;
                }
            }

            if (op == null) return left;
            var right = ParseUnary();
            return op switch
            {
                "==" or "===" => ValuesEqual(left, right),
                "!=" or "!==" => !ValuesEqual(left, right),
                "<" => Compare(left, right) < 0,
                "<=" => Compare(left, right) <= 0,
                ">" => Compare(left, right) > 0,
                ">=" => Compare(left, right) >= 0,
                _ => false,
            };
        }

        private object? ParseUnary()
        {
            if (MatchWord("not") || Match("!"))
            {
                return !Truthy(ParseUnary());
            }
            return ParsePrimary();
        }

        private object? ParsePrimary()
        {
            SkipWhitespace();
            if (_index >= _text.Length) throw new FormatException("Unexpected end of expression");

            if (Match("("))
            {
                var value = ParseOr();
                if (!Match(")")) throw new FormatException("Expected )");
                return value;
            }

            var ch = _text[_index];
            if (ch is '\'' or '"')
            {
                return ParseString(ch);
            }

            if (char.IsDigit(ch) || (ch == '.' && _index + 1 < _text.Length && char.IsDigit(_text[_index + 1])))
            {
                return ParseNumber();
            }

            var word = ParseWord();
            return word.ToLowerInvariant() switch
            {
                "true" => true,
                "false" => false,
                "null" => null,
                _ => throw new FormatException($"Unknown identifier: {word}"),
            };
        }

        private string ParseString(char quote)
        {
            _index++;
            var builder = new System.Text.StringBuilder();
            while (_index < _text.Length)
            {
                var ch = _text[_index++];
                if (ch == quote) return builder.ToString();
                if (ch == '\\' && _index < _text.Length)
                {
                    var escaped = _text[_index++];
                    builder.Append(escaped switch
                    {
                        'n' => '\n',
                        'r' => '\r',
                        't' => '\t',
                        _ => escaped,
                    });
                }
                else
                {
                    builder.Append(ch);
                }
            }
            throw new FormatException("Unterminated string literal");
        }

        private object ParseNumber()
        {
            var start = _index;
            while (_index < _text.Length && (char.IsDigit(_text[_index]) || _text[_index] is '.' or 'e' or 'E' or '+' or '-'))
            {
                _index++;
            }
            var text = _text.Substring(start, _index - start);
            if (text.Contains('.') || text.Contains('e') || text.Contains('E'))
            {
                return double.Parse(text, CultureInfo.InvariantCulture);
            }
            return long.Parse(text, CultureInfo.InvariantCulture);
        }

        private string ParseWord()
        {
            var start = _index;
            while (_index < _text.Length && (char.IsLetterOrDigit(_text[_index]) || _text[_index] == '_'))
            {
                _index++;
            }
            if (start == _index) throw new FormatException($"Unexpected character: {_text[_index]}");
            return _text.Substring(start, _index - start);
        }

        private bool Match(string token)
        {
            SkipWhitespace();
            if (_index + token.Length > _text.Length) return false;
            if (string.CompareOrdinal(_text, _index, token, 0, token.Length) != 0) return false;
            _index += token.Length;
            return true;
        }

        private bool MatchWord(string word)
        {
            SkipWhitespace();
            var start = _index;
            while (_index < _text.Length && (char.IsLetterOrDigit(_text[_index]) || _text[_index] == '_'))
            {
                _index++;
            }
            if (start == _index) return false;
            var found = _text.Substring(start, _index - start);
            if (found.Equals(word, StringComparison.OrdinalIgnoreCase)) return true;
            _index = start;
            return false;
        }

        private void SkipWhitespace()
        {
            while (_index < _text.Length && char.IsWhiteSpace(_text[_index])) _index++;
        }

        private static bool ValuesEqual(object? left, object? right)
        {
            if (left is null && right is null) return true;
            if (left is null || right is null) return false;
            if (AbsValues.IsNumber(left) && AbsValues.IsNumber(right))
            {
                return AbsValues.ToDouble(left) == AbsValues.ToDouble(right);
            }
            if (left is string ls && right is string rs) return ls == rs;
            if (left is bool lb && right is bool rb) return lb == rb;
            return AbsValues.DeepEquals(left, right);
        }

        private static int Compare(object? left, object? right)
        {
            if (AbsValues.IsNumber(left) && AbsValues.IsNumber(right))
            {
                return AbsValues.ToDouble(left).CompareTo(AbsValues.ToDouble(right));
            }
            if (left is string ls && right is string rs) return string.CompareOrdinal(ls, rs);
            throw new FormatException("Cannot compare non-numeric, non-string values");
        }
    }
}
