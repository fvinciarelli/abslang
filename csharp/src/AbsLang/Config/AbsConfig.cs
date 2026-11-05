using System.Globalization;

namespace AbsLang;

public sealed class AgentConfigSection
{
    public string? Url { get; set; }
    public string? Format { get; set; }
    public string? Auth { get; set; }
    public string? Token { get; set; }
    public string? Model { get; set; }
    public bool? ForwardAuth { get; set; }
    public string? Authorization { get; set; }
    public string? RefreshUrl { get; set; }
    public string? RefreshToken { get; set; }
    public string? ClientId { get; set; }
}

public sealed class JudgeConfigSection
{
    public string? BaseUrl { get; set; }
    public string? ApiKey { get; set; }
    public string? ApiKeyHeader { get; set; }
    public string? Model { get; set; }
}

public sealed class DefaultsConfigSection
{
    public string? Dataset { get; set; }
    public string? Filter { get; set; }
    public int? Timeout { get; set; }
    public int? Parallel { get; set; }
    public string? Output { get; set; }
    public Dictionary<string, object?>? Vars { get; set; }
}

public sealed class RunConfigSection
{
    public string? Format { get; set; }
    public bool? Ci { get; set; }
}

public sealed class LoggingConfigSection
{
    public string? Format { get; set; }
    public string? Level { get; set; }
    public string? File { get; set; }
    public bool? NoContent { get; set; }
}

public sealed class ReportConfigSection
{
    public string? Format { get; set; }
    public bool? Failed { get; set; }
    public int? Detail { get; set; }
}

/// <summary>Project-level `abs.config.yaml`.</summary>
public sealed class AbsConfig
{
    public List<string> Warnings { get; } = new();
    public AgentConfigSection? Agent { get; set; }
    public Dictionary<string, string>? Adapters { get; set; }
    public JudgeConfigSection? Judge { get; set; }
    public DefaultsConfigSection? Defaults { get; set; }
    public RunConfigSection? Run { get; set; }
    public LoggingConfigSection? Logging { get; set; }
    public ReportConfigSection? Report { get; set; }

    private static readonly Dictionary<string, string[]?> KnownKeys = new(StringComparer.Ordinal)
    {
        ["agent"] = new[]
        {
            "url", "format", "auth", "token", "model", "forward_auth",
            "authorization", "refresh_url", "refresh_token", "client_id",
        },
        ["adapters"] = null,
        ["judge"] = new[] { "base_url", "api_key", "api_key_header", "model" },
        ["defaults"] = new[] { "dataset", "filter", "timeout", "parallel", "output", "vars" },
        ["run"] = new[] { "format", "ci" },
        ["logging"] = new[] { "format", "level", "file", "no_content" },
        ["report"] = new[] { "format", "failed", "detail" },
    };

    public static AbsConfig LoadConfig(string path)
    {
        if (!File.Exists(path)) throw new AbsParseException($"config file not found: {path}");
        var text = File.ReadAllText(path);
        try
        {
            var documents = YamlValue.ParseStream(text);
            if (documents.Count == 0 || documents[0] is not Dictionary<string, object?> map)
            {
                throw new AbsParseException($"config file {path} must contain a mapping at the top level");
            }
            var config = FromMap(map);
            config.Warnings.AddRange(UnknownKeys(map));
            return config;
        }
        catch (AbsException)
        {
            throw;
        }
        catch (Exception error)
        {
            throw new AbsParseException($"invalid config file {path}: {error.Message}");
        }
    }

    public static AbsConfig? FindConfig()
    {
        var directory = new DirectoryInfo(Directory.GetCurrentDirectory());
        for (var i = 0; i < 10 && directory != null; i++)
        {
            var candidate = Path.Combine(directory.FullName, "abs.config.yaml");
            if (File.Exists(candidate)) return LoadConfig(candidate);
            directory = directory.Parent;
        }
        return null;
    }

    public static AbsConfig LoadCliConfig(string? explicitPath = null) =>
        explicitPath != null ? LoadConfig(explicitPath) : FindConfig() ?? new AbsConfig();

    public static List<string> ValidateConfig(AbsConfig config) => new(config.Warnings);

    public static bool IsTruthy(string? value) =>
        value != null && new[] { "1", "true", "yes", "on" }.Contains(value.Trim().ToLowerInvariant());

    /// <summary>Precedence: CLI &gt; environment &gt; config &gt; fallback.</summary>
    public static string? PickValue(string? cli, string? environment, string? file, string? fallback)
    {
        if (!string.IsNullOrEmpty(cli)) return cli;
        if (!string.IsNullOrEmpty(environment)) return environment;
        return !string.IsNullOrEmpty(file) ? file : fallback;
    }

    public static bool PickFlag(bool? cli, string? environment, bool? file, bool fallback)
    {
        if (cli != null) return cli.Value;
        if (!string.IsNullOrEmpty(environment)) return IsTruthy(environment);
        return file ?? fallback;
    }

    /// <summary>Build an AgentConfig from the `agent:` section.</summary>
    public AgentConfig? ToAgentConfig() => Agent == null ? null : new AgentConfig
    {
        Url = Agent.Url ?? "",
        Format = Agent.Format ?? "openai",
        Auth = Agent.Auth ?? "none",
        Token = Agent.Token,
        Model = Agent.Model,
        ForwardAuth = Agent.ForwardAuth ?? false,
        Authorization = Agent.Authorization,
        RefreshUrl = Agent.RefreshUrl,
        RefreshToken = Agent.RefreshToken,
        ClientId = Agent.ClientId,
    };

    /// <summary>Apply the `judge:` section to the built-in judge.</summary>
    public void ApplyJudge()
    {
        if (Judge == null) return;
        AbsEvaluators.ConfigureBuiltinJudge(new BuiltinJudgeConfig
        {
            BaseUrl = Judge.BaseUrl,
            ApiKey = Judge.ApiKey,
            ApiKeyHeader = Judge.ApiKeyHeader,
            Model = Judge.Model,
        });
    }

    /// <summary>
    /// Apply the `adapters:` section for the adapters bundled in the core
    /// package. Satellite adapters (aws/google) must be registered by the host
    /// after calling their Register() method.
    /// </summary>
    public void ApplyAdapters()
    {
        foreach (var pair in Adapters ?? new Dictionary<string, string>())
        {
            if (!AbsAdapterProviders.Apply(pair.Value, pair.Key))
            {
                Warnings.Add(
                    $"adapter provider '{pair.Value}' is not registered; " +
                    "call its Register() method (for example AwsAdapter.Register()) before applying the config");
            }
        }
    }

    public static List<string> UnknownKeys(Dictionary<string, object?> root)
    {
        var warnings = new List<string>();
        foreach (var pair in root)
        {
            if (!KnownKeys.TryGetValue(pair.Key, out var known))
            {
                warnings.Add($"unknown section '{pair.Key}' in config (ignored)");
                continue;
            }
            if (known == null) continue;
            if (pair.Value is not Dictionary<string, object?> section)
            {
                warnings.Add($"section '{pair.Key}' must be a mapping (ignored)");
                continue;
            }
            foreach (var key in section.Keys)
            {
                if (!known.Contains(key)) warnings.Add($"unknown key '{pair.Key}.{key}' in config (ignored)");
            }
        }
        return warnings;
    }

    private static AbsConfig FromMap(Dictionary<string, object?> root)
    {
        var config = new AbsConfig();
        if (Map(root, "agent") is { } agent)
        {
            config.Agent = new AgentConfigSection
            {
                Url = Str(agent, "url"),
                Format = Str(agent, "format"),
                Auth = Str(agent, "auth"),
                Token = Str(agent, "token"),
                Model = Str(agent, "model"),
                ForwardAuth = Bool(agent, "forward_auth"),
                Authorization = Str(agent, "authorization"),
                RefreshUrl = Str(agent, "refresh_url"),
                RefreshToken = Str(agent, "refresh_token"),
                ClientId = Str(agent, "client_id"),
            };
        }

        if (Map(root, "adapters") is { } adapters)
        {
            config.Adapters = adapters.ToDictionary(
                pair => pair.Key,
                pair => pair.Value?.ToString() ?? "",
                StringComparer.Ordinal);
        }

        if (Map(root, "judge") is { } judge)
        {
            config.Judge = new JudgeConfigSection
            {
                BaseUrl = Str(judge, "base_url"),
                ApiKey = Str(judge, "api_key"),
                ApiKeyHeader = Str(judge, "api_key_header"),
                Model = Str(judge, "model"),
            };
        }

        if (Map(root, "defaults") is { } defaults)
        {
            config.Defaults = new DefaultsConfigSection
            {
                Dataset = Str(defaults, "dataset"),
                Filter = Str(defaults, "filter"),
                Timeout = Int(defaults, "timeout"),
                Parallel = Int(defaults, "parallel"),
                Output = Str(defaults, "output"),
                Vars = Map(defaults, "vars"),
            };
        }

        if (Map(root, "run") is { } run)
        {
            config.Run = new RunConfigSection { Format = Str(run, "format"), Ci = Bool(run, "ci") };
        }

        if (Map(root, "logging") is { } logging)
        {
            config.Logging = new LoggingConfigSection
            {
                Format = Str(logging, "format"),
                Level = Str(logging, "level"),
                File = Str(logging, "file"),
                NoContent = Bool(logging, "no_content"),
            };
        }

        if (Map(root, "report") is { } report)
        {
            config.Report = new ReportConfigSection
            {
                Format = Str(report, "format"),
                Failed = Bool(report, "failed"),
                Detail = Int(report, "detail"),
            };
        }

        return config;
    }

    private static Dictionary<string, object?>? Map(Dictionary<string, object?> map, string key) =>
        map.TryGetValue(key, out var value) ? value as Dictionary<string, object?> : null;

    private static string? Str(Dictionary<string, object?> map, string key) =>
        map.TryGetValue(key, out var value) ? value?.ToString() : null;

    private static bool? Bool(Dictionary<string, object?> map, string key) =>
        map.TryGetValue(key, out var value) && value is bool b ? b : null;

    private static int? Int(Dictionary<string, object?> map, string key)
    {
        if (!map.TryGetValue(key, out var value) || value == null) return null;
        return int.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), out var result) ? result : null;
    }
}
