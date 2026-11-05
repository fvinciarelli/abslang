using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Json.Schema;

namespace AbsLang;

/// <summary>
/// Parses ABS documents, validates them against the bundled JSON Schema and
/// resolves fragments and variables.
/// </summary>
public static class AbsParser
{
    private static readonly Lazy<JsonSchema> Schema = new(LoadSchema);
    private static readonly Regex VariableRegex = new(@"\{\{([A-Za-z0-9_.]+)\}\}", RegexOptions.Compiled);

    // ── Public API ────────────────────────────────────────────────────────────

    public static IReadOnlyList<AbsDocument> ParseYaml(string raw)
    {
        var values = YamlValue.ParseStream(raw);
        foreach (var value in values) ValidateRaw(value);
        return values.Select(value => MapDocument(value)).ToList();
    }

    public static IReadOnlyList<AbsDocument> ParseYamlFile(string path)
    {
        if (!File.Exists(path))
        {
            throw new AbsParseException($"File not found: {path}");
        }
        return ParseYaml(File.ReadAllText(path));
    }

    public static NormalizedSession Parse(
        string pathOrRaw,
        IReadOnlyDictionary<string, object?>? runtimeBindings = null)
    {
        var documents = Load(pathOrRaw);
        if (documents.Count == 0)
        {
            throw new AbsParseException("No ABS documents found.");
        }
        if (documents.Count > 1)
        {
            throw new AbsParseException("Multiple sessions detected (--- separator). Use ParseMulti() to get all sessions.");
        }

        var document = documents[0];
        var session = ExpandFragments(document);
        session.Behaviors = ResolveVariables(session.Behaviors, runtimeBindings).ToList();
        return session;
    }

    public static IReadOnlyList<NormalizedSession> ParseMulti(
        string pathOrRaw,
        IReadOnlyDictionary<string, object?>? runtimeBindings = null)
    {
        var documents = Load(pathOrRaw);
        var sessions = new List<NormalizedSession>();
        foreach (var document in documents)
        {
            var session = ExpandFragments(document);
            session.Behaviors = ResolveVariables(session.Behaviors, runtimeBindings).ToList();
            sessions.Add(session);
        }
        return sessions;
    }

    public static NormalizedSession ExpandFragments(AbsDocument document)
    {
        var fragments = document.Fragments ?? new Dictionary<string, List<Behavior>>(StringComparer.Ordinal);

        List<Behavior> Expand(IEnumerable<BehaviorEntry> entries)
        {
            var result = new List<Behavior>();
            foreach (var entry in entries)
            {
                if (entry.Include is { } name)
                {
                    if (!fragments.TryGetValue(name, out var fragment))
                    {
                        throw new AbsParseException(
                            $"Fragment \"{name}\" not found. Available: {string.Join(", ", fragments.Keys)}");
                    }
                    result.AddRange(fragment);
                }
                else if (entry.Behavior is { } behavior)
                {
                    result.Add(behavior);
                }
            }
            return result;
        }

        var session = new NormalizedSession
        {
            Session = document.Session,
            Description = document.Description,
            AbsVersion = document.AbsVersion,
            Dataset = document.Dataset,
            Behaviors = Expand(document.Behaviors),
            Evaluations = document.Evaluations,
        };

        // v0.2 semantic validation: requires must reference an existing id.
        var ids = new HashSet<string>(
            session.Behaviors.Where(b => b.Id != null).Select(b => b.Id!),
            StringComparer.Ordinal);

        foreach (var behavior in session.Behaviors)
        {
            if (behavior.Requires != null && !ids.Contains(behavior.Requires))
            {
                throw new AbsParseException(
                    $"Behavior \"{behavior.Id ?? "(unnamed)"}\" requires \"{behavior.Requires}\" but no behavior with that id exists.");
            }
        }

        // sequence and optional are mutually exclusive.
        foreach (var evaluation in session.Evaluations ?? new List<Evaluation>())
        {
            if (evaluation.Type != "sequence") continue;
            var order = evaluation.GetList("order");
            if (order == null) continue;
            foreach (var entry in order)
            {
                var selector = MapSelector(entry);
                var matched = session.Behaviors.FirstOrDefault(b =>
                    (selector.Actor == null || b.Actor == selector.Actor) &&
                    (selector.Action == null || b.Action == selector.Action) &&
                    (selector.Target == null || b.Target == selector.Target));
                if (matched is { Optional: true })
                {
                    throw new AbsParseException(
                        $"sequence references behavior \"{matched.Id ?? "(unnamed)"}\" which is optional. " +
                        "sequence and optional are mutually exclusive. Use expected + after instead.");
                }
            }
        }

        return session;
    }

    public static IReadOnlyList<Behavior> ResolveVariables(
        IEnumerable<Behavior> behaviors,
        IReadOnlyDictionary<string, object?>? runtimeBindings = null)
    {
        var variables = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (runtimeBindings != null)
        {
            foreach (var pair in runtimeBindings) variables[pair.Key] = pair.Value;
        }

        var result = new List<Behavior>();
        foreach (var source in behaviors)
        {
            var behavior = Clone(source);

            behavior.Content = ResolveValue(behavior.Content, variables);
            behavior.With = ResolveMap(behavior.With, variables);
            behavior.WithOnly = ResolveMap(behavior.WithOnly, variables);

            if (behavior.Evaluations != null)
            {
                foreach (var evaluation in behavior.Evaluations)
                {
                    ResolveEvaluation(evaluation, variables);
                }
            }

            if (behavior.MatchesWhen != null)
            {
                behavior.MatchesWhen.Criteria = ResolveString(behavior.MatchesWhen.Criteria, variables);
                behavior.MatchesWhen.Value = ResolveString(behavior.MatchesWhen.Value, variables);
                behavior.MatchesWhen.Pattern = ResolveString(behavior.MatchesWhen.Pattern, variables);
            }

            if (behavior.Capture != null)
            {
                var capture = new Dictionary<string, object?>(StringComparer.Ordinal);
                foreach (var pair in behavior.Capture)
                {
                    var value = ResolveValue(pair.Value, variables);
                    capture[pair.Key] = value;
                    variables[pair.Key] = value;
                }
                behavior.Capture = capture;
            }

            result.Add(behavior);
        }

        return result;
    }

    public static IReadOnlyList<IReadOnlyDictionary<string, object?>> LoadDataset(string path)
    {
        if (!File.Exists(path))
        {
            throw new AbsParseException($"Dataset not found: {path}");
        }

        var raw = File.ReadAllText(path);
        var rows = new List<IReadOnlyDictionary<string, object?>>();

        if (path.EndsWith(".jsonl", StringComparison.OrdinalIgnoreCase))
        {
            foreach (var line in raw.Split('\n'))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                using var document = JsonDocument.Parse(line);
                if (JsonToObject(document.RootElement) is Dictionary<string, object?> row)
                {
                    rows.Add(row);
                }
            }
            return rows;
        }

        using var parsed = JsonDocument.Parse(raw);
        if (parsed.RootElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var element in parsed.RootElement.EnumerateArray())
            {
                if (JsonToObject(element) is Dictionary<string, object?> row) rows.Add(row);
            }
        }
        else if (JsonToObject(parsed.RootElement) is Dictionary<string, object?> single)
        {
            rows.Add(single);
        }

        return rows;
    }

    // ── Loading / validation ─────────────────────────────────────────────────

    private static IReadOnlyList<AbsDocument> Load(string pathOrRaw)
    {
        if (string.IsNullOrWhiteSpace(pathOrRaw)) return ParseYaml(pathOrRaw);
        if (File.Exists(pathOrRaw))
        {
            return ParseYamlFile(pathOrRaw);
        }

        if (pathOrRaw.Contains("---") || pathOrRaw.Contains("session:") || pathOrRaw.Contains("behaviors:"))
        {
            return ParseYaml(pathOrRaw);
        }

        return ParseYamlFile(pathOrRaw);
    }

    private static void ValidateRaw(object? raw)
    {
        var node = ToJsonNode(raw);
        var json = node?.ToJsonString() ?? "null";
        using var document = JsonDocument.Parse(json);
        var results = Schema.Value.Evaluate(document.RootElement, new EvaluationOptions
        {
            OutputFormat = OutputFormat.List,
            RequireFormatValidation = true,
        });

        if (results.IsValid) return;

        var errors = new List<string>();
        CollectErrors(results, errors);
        if (errors.Count == 0) errors.Add("Document does not match abs.schema.json");
        throw new AbsValidationException(errors);
    }

    private static void CollectErrors(EvaluationResults results, List<string> errors)
    {
        if (!results.IsValid && results.Errors != null)
        {
            foreach (var error in results.Errors)
            {
                errors.Add($"{results.InstanceLocation}: {error.Key}: {error.Value}");
            }
        }

        if (results.Details != null)
        {
            foreach (var detail in results.Details) CollectErrors(detail, errors);
        }
    }

    private static JsonNode? ToJsonNode(object? value)
    {
        switch (value)
        {
            case null:
                return null;
            case bool b:
                return JsonValue.Create(b);
            case string s:
                return JsonValue.Create(s);
            case long l:
                return JsonValue.Create(l);
            case int i:
                return JsonValue.Create(i);
            case double d:
                return JsonValue.Create(d);
            case decimal m:
                return JsonValue.Create(m);
            case Dictionary<string, object?> map:
                var obj = new JsonObject();
                foreach (var pair in map) obj[pair.Key] = ToJsonNode(pair.Value);
                return obj;
            case IReadOnlyList<object?> list:
                var array = new JsonArray();
                foreach (var item in list) array.Add(ToJsonNode(item));
                return array;
            case JsonNode node:
                return node;
            default:
                return JsonValue.Create(value.ToString());
        }
    }

    private static JsonSchema LoadSchema()
    {
        using var stream = typeof(AbsParser).Assembly.GetManifestResourceStream("AbsLang.abs.schema.json")
            ?? throw new AbsException("Embedded abs.schema.json not found.");
        using var reader = new StreamReader(stream);
        return JsonSchema.FromText(reader.ReadToEnd());
    }

    // ── YAML → model mapping ─────────────────────────────────────────────────

    private static AbsDocument MapDocument(object? value)
    {
        if (value is not Dictionary<string, object?> map)
        {
            throw new AbsParseException("An ABS document must be a YAML mapping.");
        }

        var document = new AbsDocument
        {
            Session = Str(map, "session") ?? throw new AbsParseException("Missing required field: session"),
            Description = Str(map, "description"),
            AbsVersion = Str(map, "abs_version"),
        };

        if (map.TryGetValue("dataset", out var datasetValue) && datasetValue is Dictionary<string, object?> dataset)
        {
            document.Dataset = new DatasetDefinition
            {
                Id = Str(dataset, "id") ?? "",
                Path = Str(dataset, "path") ?? "",
            };
        }

        if (map.TryGetValue("behaviors", out var behaviorsValue) && behaviorsValue is List<object?> behaviors)
        {
            foreach (var entry in behaviors)
            {
                if (entry is not Dictionary<string, object?> behaviorMap)
                {
                    throw new AbsParseException("Each behaviors entry must be a mapping.");
                }
                if (behaviorMap.TryGetValue("include", out var includeValue) && includeValue is string include)
                {
                    document.Behaviors.Add(new BehaviorEntry { Include = include });
                }
                else
                {
                    document.Behaviors.Add(new BehaviorEntry { Behavior = MapBehavior(behaviorMap) });
                }
            }
        }
        else
        {
            throw new AbsParseException("Missing required field: behaviors");
        }

        if (map.TryGetValue("fragments", out var fragmentsValue) && fragmentsValue is Dictionary<string, object?> fragments)
        {
            document.Fragments = new Dictionary<string, List<Behavior>>(StringComparer.Ordinal);
            foreach (var pair in fragments)
            {
                if (pair.Value is not List<object?> list)
                {
                    throw new AbsParseException($"Fragment \"{pair.Key}\" must be a list of behaviors.");
                }
                document.Fragments[pair.Key] = list
                    .Select(item => item is Dictionary<string, object?> m
                        ? MapBehavior(m)
                        : throw new AbsParseException($"Fragment \"{pair.Key}\" contains a non-mapping behavior."))
                    .ToList();
            }
        }

        if (map.TryGetValue("evaluations", out var evaluationsValue) && evaluationsValue is List<object?> evaluations)
        {
            document.Evaluations = evaluations
                .Select(item => item is Dictionary<string, object?> m
                    ? MapEvaluation(m)
                    : throw new AbsParseException("Each evaluation must be a mapping."))
                .ToList();
        }

        return document;
    }

    private static Behavior MapBehavior(Dictionary<string, object?> map)
    {
        var behavior = new Behavior
        {
            Id = Str(map, "id"),
            Actor = Str(map, "actor") ?? throw new AbsParseException("Behavior is missing required field: actor"),
            Action = Str(map, "action") ?? throw new AbsParseException("Behavior is missing required field: action"),
            Target = Str(map, "target"),
            Content = map.TryGetValue("content", out var content) ? content : null,
            Capture = MapMap(map, "capture"),
            With = MapMap(map, "with"),
            WithOnly = MapMap(map, "with_only"),
            Optional = Bool(map, "optional"),
            Requires = Str(map, "requires"),
        };

        if (map.TryGetValue("evaluations", out var evaluationsValue) && evaluationsValue is List<object?> evaluations)
        {
            behavior.Evaluations = evaluations
                .Select(item => item is Dictionary<string, object?> m
                    ? MapEvaluation(m)
                    : throw new AbsParseException("Each evaluation must be a mapping."))
                .ToList();
        }

        if (map.TryGetValue("matches_when", out var matchesValue) && matchesValue is Dictionary<string, object?> matches)
        {
            behavior.MatchesWhen = new MatchesWhen
            {
                Type = Str(matches, "type") ?? "",
                Criteria = Str(matches, "criteria"),
                Value = Str(matches, "value"),
                Pattern = Str(matches, "pattern"),
            };
        }

        return behavior;
    }

    private static Evaluation MapEvaluation(Dictionary<string, object?> map)
    {
        var evaluation = new Evaluation();
        foreach (var pair in map) evaluation.Data[pair.Key] = pair.Value;
        if (string.IsNullOrEmpty(evaluation.Type))
        {
            throw new AbsParseException("Evaluation is missing required field: type");
        }
        return evaluation;
    }

    private static Selector MapSelector(object? value)
    {
        if (value is not Dictionary<string, object?> map) return new Selector();
        return new Selector
        {
            Actor = Str(map, "actor"),
            Action = Str(map, "action"),
            Target = Str(map, "target"),
        };
    }

    private static string? Str(IReadOnlyDictionary<string, object?> map, string key)
    {
        if (!map.TryGetValue(key, out var value) || value == null) return null;
        return value as string ?? Convert.ToString(value, CultureInfo.InvariantCulture);
    }

    private static bool Bool(IReadOnlyDictionary<string, object?> map, string key)
    {
        return map.TryGetValue(key, out var value) && value is bool b && b;
    }

    private static Dictionary<string, object?>? MapMap(IReadOnlyDictionary<string, object?> map, string key)
    {
        return map.TryGetValue(key, out var value) ? value as Dictionary<string, object?> : null;
    }

    // ── Variable resolution ──────────────────────────────────────────────────

    private static Behavior Clone(Behavior source)
    {
        return new Behavior
        {
            Id = source.Id,
            Actor = source.Actor,
            Action = source.Action,
            Target = source.Target,
            Content = CloneValue(source.Content),
            Capture = source.Capture == null ? null : CloneMap(source.Capture),
            With = source.With == null ? null : CloneMap(source.With),
            WithOnly = source.WithOnly == null ? null : CloneMap(source.WithOnly),
            Evaluations = source.Evaluations?.Select(CloneEvaluation).ToList(),
            Optional = source.Optional,
            Requires = source.Requires,
            MatchesWhen = source.MatchesWhen == null ? null : new MatchesWhen
            {
                Type = source.MatchesWhen.Type,
                Criteria = source.MatchesWhen.Criteria,
                Value = source.MatchesWhen.Value,
                Pattern = source.MatchesWhen.Pattern,
            },
        };
    }

    private static Evaluation CloneEvaluation(Evaluation source)
    {
        var copy = new Evaluation();
        foreach (var pair in source.Data) copy.Data[pair.Key] = CloneValue(pair.Value);
        return copy;
    }

    private static object? CloneValue(object? value)
    {
        switch (value)
        {
            case Dictionary<string, object?> map:
                return CloneMap(map);
            case List<object?> list:
                return list.Select(CloneValue).ToList();
            default:
                return value;
        }
    }

    private static Dictionary<string, object?> CloneMap(IReadOnlyDictionary<string, object?> map)
    {
        var copy = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var pair in map) copy[pair.Key] = CloneValue(pair.Value);
        return copy;
    }

    private static Dictionary<string, object?>? ResolveMap(
        Dictionary<string, object?>? map,
        IReadOnlyDictionary<string, object?> variables)
    {
        if (map == null) return null;
        var resolved = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var pair in map) resolved[pair.Key] = ResolveValue(pair.Value, variables);
        return resolved;
    }

    private static void ResolveEvaluation(Evaluation evaluation, IReadOnlyDictionary<string, object?> variables)
    {
        foreach (var key in evaluation.Data.Keys.ToList())
        {
            evaluation.Data[key] = ResolveValue(evaluation.Data[key], variables);
        }
    }

    private static object? ResolveValue(object? value, IReadOnlyDictionary<string, object?> variables)
    {
        switch (value)
        {
            case string text:
                return ResolveString(text, variables)!;
            case Dictionary<string, object?> map:
                return ResolveMap(map, variables);
            case List<object?> list:
                return list.Select(item => ResolveValue(item, variables)).ToList();
            default:
                return value;
        }
    }

    private static string? ResolveString(string? value, IReadOnlyDictionary<string, object?> variables)
    {
        if (value == null) return null;
        return VariableRegex.Replace(value, match =>
        {
            var name = match.Groups[1].Value;
            return variables.TryGetValue(name, out var resolved)
                ? Stringify(resolved)
                : match.Value;
        });
    }

    private static string Stringify(object? value)
    {
        switch (value)
        {
            case null:
                return "null";
            case bool b:
                return b ? "true" : "false";
            case string s:
                return s;
            case long l:
                return l.ToString(CultureInfo.InvariantCulture);
            case int i:
                return i.ToString(CultureInfo.InvariantCulture);
            case double d:
                return d.ToString("R", CultureInfo.InvariantCulture);
            case decimal m:
                return m.ToString(CultureInfo.InvariantCulture);
            default:
                return JsonSerializer.Serialize(value);
        }
    }

    // ── JSON dataset conversion ──────────────────────────────────────────────

    private static object? JsonToObject(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Null:
            case JsonValueKind.Undefined:
                return null;
            case JsonValueKind.True:
                return true;
            case JsonValueKind.False:
                return false;
            case JsonValueKind.String:
                return element.GetString();
            case JsonValueKind.Number:
                return element.TryGetInt64(out var integer) ? integer : element.GetDouble();
            case JsonValueKind.Array:
                return element.EnumerateArray().Select(JsonToObject).ToList();
            case JsonValueKind.Object:
                var map = new Dictionary<string, object?>(StringComparer.Ordinal);
                foreach (var property in element.EnumerateObject())
                {
                    map[property.Name] = JsonToObject(property.Value);
                }
                return map;
            default:
                return null;
        }
    }
}
