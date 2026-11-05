using AbsLang;
using Xunit;

namespace AbsLang.Tests;

public class ConfigTests
{
    [Fact]
    public void LoadsTypedSections()
    {
        var path = Path.Combine(Path.GetTempPath(), "abs-config-" + Guid.NewGuid().ToString("N") + ".yaml");
        File.WriteAllText(path, """
agent:
  url: http://agent/chat
  format: openai
  auth: bearer
  token: secret
  forward_auth: true
adapters:
  llm_judge: azure
  Relevance: aievaluator
judge:
  base_url: http://judge/v1
  api_key: key
  api_key_header: api-key
  model: deployment
defaults:
  dataset: cases.jsonl
  filter: "kind:refund"
  timeout: 30
  parallel: 4
  vars:
    locale: es
run:
  format: json
  ci: true
logging:
  format: jsonl
  level: debug
  file: run.jsonl
  no_content: true
report:
  format: junit
  failed: true
  detail: 2
""");

        try
        {
            var config = AbsConfig.LoadConfig(path);
            Assert.Equal("http://agent/chat", config.Agent!.Url);
            Assert.Equal("bearer", config.Agent.Auth);
            Assert.True(config.Agent.ForwardAuth);
            Assert.Equal("azure", config.Adapters!["llm_judge"]);
            Assert.Equal("http://judge/v1", config.Judge!.BaseUrl);
            Assert.Equal("cases.jsonl", config.Defaults!.Dataset);
            Assert.Equal(30, config.Defaults.Timeout);
            Assert.Equal(4, config.Defaults.Parallel);
            Assert.Equal("es", config.Defaults.Vars!["locale"]);
            Assert.True(config.Run!.Ci);
            Assert.Equal("jsonl", config.Logging!.Format);
            Assert.True(config.Logging.NoContent);
            Assert.Equal(2, config.Report!.Detail);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void ReportsUnknownKeys()
    {
        var path = Path.Combine(Path.GetTempPath(), "abs-config-" + Guid.NewGuid().ToString("N") + ".yaml");
        File.WriteAllText(path, """
unknown_section:
  key: value
agent:
  url: http://agent
  typo: true
""");
        try
        {
            var config = AbsConfig.LoadConfig(path);
            Assert.Contains(config.Warnings, warning => warning.Contains("unknown_section"));
            Assert.Contains(config.Warnings, warning => warning.Contains("agent.typo"));
            Assert.Equal(config.Warnings, AbsConfig.ValidateConfig(config));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void RejectsMissingFile()
    {
        Assert.Throws<AbsParseException>(() => AbsConfig.LoadConfig("/does/not/exist.yaml"));
    }

    [Theory]
    [InlineData("1", true)]
    [InlineData("true", true)]
    [InlineData("YES", true)]
    [InlineData("on", true)]
    [InlineData("0", false)]
    [InlineData("nope", false)]
    [InlineData(null, false)]
    public void IsTruthy(string? value, bool expected) => Assert.Equal(expected, AbsConfig.IsTruthy(value));

    [Fact]
    public void BuildsAgentConfig()
    {
        var config = new AbsConfig
        {
            Agent = new AgentConfigSection
            {
                Url = "http://agent",
                Format = "responses",
                Auth = "bearer",
                Token = "tok",
                Model = "model",
                ForwardAuth = true,
                RefreshUrl = "http://auth",
                RefreshToken = "refresh",
                ClientId = "client",
            },
        };

        var agent = config.ToAgentConfig();
        Assert.NotNull(agent);
        Assert.Equal("http://agent", agent!.Url);
        Assert.Equal("responses", agent.Format);
        Assert.Equal("bearer", agent.Auth);
        Assert.Equal("tok", agent.Token);
        Assert.Equal("model", agent.Model);
        Assert.True(agent.ForwardAuth);
        Assert.Equal("refresh", agent.RefreshToken);
    }

    [Fact]
    public void AppliesAdaptersFromConfig()
    {
        var config = new AbsConfig
        {
            Adapters = new Dictionary<string, string>
            {
                ["test_core_type"] = "azure",
                ["test_ai_type"] = "aievaluator",
                ["unknown_type"] = "made-up",
            },
        };

        config.ApplyAdapters();

        Assert.True(AbsAdapterRegistry.HasDefault("test_core_type"));
        Assert.True(AbsAdapterRegistry.HasDefault("test_ai_type"));
        Assert.Contains(config.Warnings, warning => warning.Contains("made-up"));
    }

    [Fact]
    public void Precedence()
    {
        Assert.Equal("cli", AbsConfig.PickValue("cli", "env", "file", "fallback"));
        Assert.Equal("env", AbsConfig.PickValue(null, "env", "file", "fallback"));
        Assert.Equal("file", AbsConfig.PickValue(null, null, "file", "fallback"));
        Assert.Equal("fallback", AbsConfig.PickValue(null, null, null, "fallback"));

        Assert.True(AbsConfig.PickFlag(true, "0", false, false));
        Assert.True(AbsConfig.PickFlag(null, "true", false, false));
        Assert.True(AbsConfig.PickFlag(null, null, true, false));
        Assert.False(AbsConfig.PickFlag(null, null, null, false));
    }
}
