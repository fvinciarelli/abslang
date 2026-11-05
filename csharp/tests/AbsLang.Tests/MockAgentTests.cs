using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using AbsLang;
using Xunit;

namespace AbsLang.Tests;

/// <summary>End-to-end run against the repository's Python mock agent.</summary>
public class MockAgentTests
{
    [Fact]
    public async Task RunsMissingInfoAgainstTheRealMockAgent()
    {
        var root = RepoRoot();
        var port = FreePort();
        var start = new ProcessStartInfo
        {
            FileName = "python3",
            Arguments = $"tools/mock_agent.py --port {port} --scenario missing_info",
            WorkingDirectory = root,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        using var process = Process.Start(start);
        Assert.NotNull(process);

        try
        {
            using var probe = new HttpClient { Timeout = TimeSpan.FromSeconds(1) };
            var healthy = false;
            for (var attempt = 0; attempt < 50 && !healthy; attempt++)
            {
                try
                {
                    var response = await probe.GetAsync($"http://127.0.0.1:{port}/health");
                    healthy = response.IsSuccessStatusCode;
                }
                catch
                {
                    // keep waiting
                }
                if (!healthy) await Task.Delay(100);
            }
            Assert.True(healthy, "The mock agent did not become healthy.");

            var session = AbsParser.Parse(Path.Combine(root, "examples", "order-status-missing-info.yaml"));
            var result = await new AbsRunner().RunAsync(
                session,
                new AgentConfig { Url = $"http://127.0.0.1:{port}/chat" });

            Assert.True(result.Passed);
            Assert.Equal(6, result.StepsMatched);
            Assert.Equal(5, result.EvaluationsPassed);
        }
        finally
        {
            if (!process.HasExited) process.Kill(true);
        }
    }

    private static int FreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static string RepoRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory != null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "SPECIFICATION.md"))) return directory.FullName;
            directory = directory.Parent;
        }
        throw new DirectoryNotFoundException("Could not find the repository root.");
    }
}
