using System.Diagnostics;
using AbsLang;

if (args.Length < 2)
{
    Console.Error.WriteLine("usage: dotnet run --project csharp/samples/AbsLang.Sample -- <session.abs.yaml> <agent-url>");
    return 2;
}

var sessionPath = args[0];
var agentUrl = args[1];

var session = AbsParser.Parse(sessionPath);
var agent = new AgentConfig { Url = agentUrl };

var logger = new RunLogger(session.Session, agent.Url);

// Forward every structured event to your telemetry pipeline.
// In production, send this to Datadog / OpenTelemetry / Serilog instead of the console.
logger.Sink = (eventName, fields) =>
{
    var interesting = new[] { "step", "duration_ms", "passed", "evaluation_type", "score" };
    var details = interesting
        .Where(fields.ContainsKey)
        .Select(key => $"{key}={fields[key]}");

    Console.WriteLine($"[event] {eventName} {string.Join(" ", details)}");
};

var total = Stopwatch.StartNew();
var result = await new AbsRunner().RunAsync(session, agent, logger: logger);
total.Stop();

Console.WriteLine();
Console.WriteLine(AbsReports.FormatTable(result));
Console.WriteLine();
Console.WriteLine($"Total run: {total.ElapsedMilliseconds} ms");

foreach (var step in result.Steps)
{
    foreach (var evaluation in step.Evaluations)
    {
        Console.WriteLine(
            $"  step {step.Step} · {evaluation.Type}: " +
            $"passed={evaluation.Passed} score={evaluation.Score:F2} duration={evaluation.DurationMs} ms");
    }
}

return result.Passed ? 0 : 1;
