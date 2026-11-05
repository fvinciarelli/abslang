using System.Text.Json;
using AbsLang;
using Xunit;

namespace AbsLang.Tests;

public class LoggingTests
{
    [Fact]
    public void WritesJsonlEvents()
    {
        var path = Path.Combine(Path.GetTempPath(), "abs-log-" + Guid.NewGuid().ToString("N") + ".jsonl");
        AbsLog.Configure(new AbsLogOptions
        {
            Format = "jsonl",
            Level = "info",
            File = path,
            Meta = new Dictionary<string, object?> { ["app"] = "tests" },
        });

        try
        {
            var logger = new RunLogger("session", "http://agent", "run-1");
            logger.Event("session.start", ("behaviors", 2));
            logger.Event("evaluation.result", ("passed", true), ("duration_ms", 3L));

            var lines = File.ReadAllLines(path);
            Assert.Equal(2, lines.Length);
            using var first = JsonDocument.Parse(lines[0]);
            Assert.Equal(1, first.RootElement.GetProperty("v").GetInt32());
            Assert.Equal("session.start", first.RootElement.GetProperty("event").GetString());
            Assert.Equal("run-1", first.RootElement.GetProperty("run_id").GetString());
            Assert.Equal("session", first.RootElement.GetProperty("session").GetString());
            Assert.Equal("tests", first.RootElement.GetProperty("app").GetString());

            using var second = JsonDocument.Parse(lines[1]);
            Assert.True(second.RootElement.GetProperty("passed").GetBoolean());
            Assert.Equal(3, second.RootElement.GetProperty("duration_ms").GetInt64());
        }
        finally
        {
            AbsLog.Close();
            if (File.Exists(path)) File.Delete(path);
        }
    }

    [Fact]
    public void SinkReceivesEvents()
    {
        var received = new List<(string Event, IReadOnlyDictionary<string, object?> Fields)>();
        var logger = new RunLogger("session", "agent", "run-2")
        {
            Sink = (name, fields) => received.Add((name, fields)),
        };
        logger.Event("custom.event", ("value", 42L));

        Assert.Single(received);
        Assert.Equal("custom.event", received[0].Event);
        Assert.Equal(42L, received[0].Fields["value"]);
        Assert.Equal("run-2", received[0].Fields["run_id"]);
    }

    [Fact]
    public void ContentCanBeDisabled()
    {
        AbsLog.Configure(new AbsLogOptions { Format = "silent", IncludeContent = false });
        try
        {
            Assert.False(AbsLog.ContentEnabled);
            var logger = new RunLogger();
            Assert.False(logger.IncludeContent);
        }
        finally
        {
            AbsLog.Close();
        }
    }

    [Fact]
    public void SilentByDefault()
    {
        AbsLog.Close();
        Assert.False(AbsLog.Enabled);
    }
}
