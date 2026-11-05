# AbsLang C# sample

Runnable console example: parses an ABS session, runs it against an agent, prints
the report and forwards structured events (with timings) to a `RunLogger.Sink`.

## Run it

1. Start the mock agent from the repository root:

   ```bash
   python3 tools/mock_agent.py --scenario missing_info
   ```

2. Run the sample:

   ```bash
   dotnet run --project csharp/samples/AbsLang.Sample -- \
     csharp/samples/sessions/order-status.abs.yaml \
     http://localhost:8080/chat
   ```

Expected result: `6/6` steps matched and `7/7` evaluations passed.

## What it shows

- `AbsParser.Parse` for a multi-turn session with a tool round-trip.
- `AbsRunner.RunAsync` against an OpenAI-compatible agent.
- `RunLogger.Sink` receiving `agent.response`, `behavior.match`,
  `evaluation.result` and `session.end` events with `duration_ms` and `ts`.
- Per-evaluation `DurationMs` and total wall-clock time.
- `AbsReports.FormatTable` for the final report.

In production, replace the console `Sink` with a background queue that ships the
same event dictionaries to Datadog, OpenTelemetry or Serilog.
