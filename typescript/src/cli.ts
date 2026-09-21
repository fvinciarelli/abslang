#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import chalk from "chalk";
import {
  parse,
  parseMulti,
  loadDataset,
  NormalizedSession,
  resolveVariables,
} from "./parser";
import { run, AgentConfig, RunResult } from "./runner";
import { registerAdapter } from "./evaluators";
import { formatTable, formatJson, formatJunit } from "./formatters/table";
import { mergeConfig } from "./config";
import { configureBuiltinJudge } from "./evaluators/builtin_judge";
import { configureLogging, closeLogging, newRunId, RunLogger } from "./log";
import { serializeEval, serializeObserved } from "./report";
import { renderSequenceDiagram } from "./mermaid-ascii";

const program = new Command();

program
  .name("abs")
  .description("ABS — Agent Behavior Specification CLI")
  .version("0.5.1");

// ── init ──

const SMOKE_SESSION = `session: Order status
description: User asks about an order. Happy path.
dataset:
  id: cases
  path: order-status.jsonl
behaviors:
  - actor: user
    action: says
    content: "Where is my order {{cases.orderId}}?"

  - actor: assistant
    action: asks
    content: "Please provide your order number"

  - actor: user
    action: says
    content: "{{cases.orderId}}"
    capture:
      orderId: "{{cases.orderId}}"

  - actor: assistant
    action: calls
    target: Order MCP
    with:
      orderId: "{{orderId}}"

  - actor: tool
    action: responds
    target: Order MCP
    content:
      status: "in_transit"

  - actor: assistant
    action: informs
    content: "{{cases.expectedResponse}}"
    evaluations:
      - type: contains
        value: "{{cases.expectedKeyword}}"
`;

const SMOKE_DATASET = [
  { orderId: "12345", expectedResponse: "Your order is on the way", expectedKeyword: "on the way" },
  { orderId: "67890", expectedResponse: "Your order is being prepared", expectedKeyword: "prepared" },
  { orderId: "99999", expectedResponse: "Your order has been delivered", expectedKeyword: "delivered" },
];

program
  .command("init")
  .description("Initialize a new ABS project")
  .action(() => {
    const cwd = process.cwd();

    // 1. abs.config.yaml
    const configPath = join(cwd, "abs.config.yaml");
    if (!existsSync(configPath)) {
      writeFileSync(
        configPath,
        `# ABS project configuration
agent:
  url: http://localhost:8080/chat
  format: openai          # openai | responses | claude | gemini
  auth: none              # none | api_key | bearer | oauth2
  # model: gpt-4o         # required by the Responses API
  # forward_auth: true    # forward the caller's Authorization header upstream
  # authorization: "Bearer eyJ..."  # or pass the header value explicitly

adapters:
  llm_judge: aievaluator

defaults:
  timeout: 300
`
      );
      console.log(chalk.green("✅ Created abs.config.yaml"));
    } else {
      console.log("⏭️  abs.config.yaml already exists, skipping");
    }

    // 2. sessions/
    const sessionsDir = join(cwd, "sessions");
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir);
    }
    const sessionPath = join(sessionsDir, "order-status.abs.yaml");
    if (!existsSync(sessionPath)) {
      writeFileSync(sessionPath, SMOKE_SESSION);
      console.log(chalk.green("✅ Created sessions/order-status.abs.yaml"));
    } else {
      console.log("⏭️  sessions/order-status.abs.yaml already exists, skipping");
    }

    // 3. Create dataset next to the session
    const datasetPath = join(sessionsDir, "order-status.jsonl");
    if (!existsSync(datasetPath)) {
      writeFileSync(
        datasetPath,
        SMOKE_DATASET.map((r) => JSON.stringify(r)).join("\n") + "\n"
      );
      console.log(chalk.green("✅ Created sessions/order-status.jsonl (3 rows)"));
    } else {
      console.log("⏭️  sessions/order-status.jsonl already exists, skipping");
    }

    // 4. .gitignore
    const gitignorePath = join(cwd, ".gitignore");
    const entry = "abs.config.yaml";
    let lines: string[] = [];
    if (existsSync(gitignorePath)) {
      lines = readFileSync(gitignorePath, "utf-8").split("\n");
    }
    if (!lines.includes(entry)) {
      writeFileSync(gitignorePath, (lines.join("\n") + "\n" + entry + "\n").trimStart());
      console.log(chalk.green(`✅ Added ${entry} to .gitignore`));
    }

    console.log();
    console.log("Next steps:");
    console.log("  abs run sessions/order-status.abs.yaml --agent $AGENT_URL");
    console.log("  abs run sessions/order-status.abs.yaml --agent $AGENT_URL --dataset datasets/order-status.jsonl");
  });

// ── run ──

program
  .command("run")
  .description("Execute ABS sessions against an agent")
  .argument("[session]", "Path to a .abs.yaml file or directory")
  .option("--agent <url>", "Agent endpoint URL")
  .option("--dataset <path>", "Dataset file or directory")
  .option("--var <binding>", "Single variable binding (repeatable)", collectVar, {} as Record<string, string>)
  .option("--filter <kv>", "Filter dataset rows by key:value")
  .option("--agent-format <format>", "openai, responses, claude, or gemini", "openai")
  .option("--agent-auth <auth>", "none, api_key, bearer, or oauth2", "none")
  .option("--agent-token <token>", "Token or API key")
  .option("--agent-model <model>", "Model name for protocols that require it (Responses API)")
  .option("--agent-forward-auth", "Forward the caller's Authorization header to the agent", false)
  .option("--agent-authorization <value>", "Raw Authorization header value to forward (e.g. 'Bearer eyJ...')")
  .option("--agent-refresh-url <url>", "OAuth2 token refresh URL")
  .option("--agent-refresh-token <token>", "OAuth2 refresh token")
  .option("--agent-client-id <id>", "OAuth2 client ID")
  .option("--adapter <binding>", "Evaluator adapter binding", collectAdapter, {} as Record<string, string>)
  .option("--judge-base-url <url>", "Built-in judge: OpenAI-compatible base URL (e.g. Azure/Foundry, Ollama)")
  .option("--judge-api-key <key>", "Built-in judge: API key (overrides ABS_JUDGE_API_KEY / OPENAI_API_KEY)")
  .option("--judge-api-key-header <header>", "Built-in judge: header for the API key (default: Authorization; use api-key for Azure)")
  .option("--judge-model <model>", "Built-in judge: model or Azure deployment name")
  .option("--format <format>", "table, json, or junit", "table")
  .option("--ci", "CI mode (no colors, no prompts)", false)
  .option("--timeout <n>", "Timeout per session run in seconds", "300")
  .option("--output <path>", "Write report to file")
  .option("--parallel <n>", "Run N dataset rows in parallel", "1")
  .option("--log-format <format>", "pretty (human) or jsonl (one event per line)", "pretty")
  .option("--log-level <level>", "error, warn, info, or debug", "info")
  .option("--log-file <path>", "Write machine-readable JSONL events to a file")
  .option("--no-log-content", "Omit trace content and reasons from logs (privacy)")
  .action(async (session, options) => {
    const sessionPath = session || options.session;
    if (!sessionPath) {
      console.error(chalk.red("❌ Provide a session path."));
      process.exit(2);
    }

    const agentUrl = options.agent || process.env.ABS_AGENT_URL;

    // Load config file and merge with CLI options (CLI wins)
    const cfg = mergeConfig({
      agent_url: agentUrl,
      agent_format: options.agentFormat,
      agent_auth: options.agentAuth,
      agent_token: options.agentToken,
      agent_model: options.agentModel,
      agent_forward_auth: options.agentForwardAuth,
      agent_authorization: options.agentAuthorization,
      dataset: options.dataset,
      adapters: options.adapter,
    });

    if (!cfg.agent_url) {
      console.error(chalk.red("❌ Provide --agent or set ABS_AGENT_URL."));
      process.exit(2);
    }

    // Configure evaluator adapters (CLI --adapter + abs.config.yaml adapters:)
    setupAdapters(options.adapter ?? {}, cfg.adapters);

    // Configure built-in LLM judge (CLI flags override env vars)
    configureBuiltinJudge({
      baseUrl: options.judgeBaseUrl,
      apiKey: options.judgeApiKey,
      apiKeyHeader: options.judgeApiKeyHeader,
      model: options.judgeModel,
    });

    const agentConfig: AgentConfig = {
      url: cfg.agent_url,
      format: cfg.agent_format,
      auth: cfg.agent_auth,
      token: cfg.agent_token,
      model: cfg.agent_model,
      forwardAuth: cfg.agent_forward_auth,
      authorization: cfg.agent_authorization,
      refreshUrl: options.agentRefreshUrl,
      refreshToken: options.agentRefreshToken,
      clientId: options.agentClientId,
      timeout: parseInt(options.timeout) || 300,
    };

    // Structured logging: stderr (+ optional JSONL file), never stdout.
    configureLogging({
      level: options.logLevel,
      format: options.logFormat,
      file: options.logFile,
      includeContent: options.logContent !== false,
      meta: { abslang: "0.5.1", agent: cfg.agent_url, agent_format: cfg.agent_format },
    });
    const runLogger = new RunLogger({ runId: newRunId() });

    const runtimeVars: Record<string, any> = {};
    if (options.var) {
      for (const [k, v] of Object.entries(options.var as Record<string, string>)) {
        runtimeVars[k] = v;
      }
    }
    // Also pick up ABS_VAR_* env vars
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith("ABS_VAR_") && value) {
        runtimeVars[key.replace("ABS_VAR_", "")] = value;
      }
    }

    // Parse session
    let sessions: NormalizedSession[];
    try {
      sessions = parseMulti(sessionPath);
    } catch (err: any) {
      console.error(chalk.red(`❌ ${err.message}`));
      process.exit(2);
    }

    // Load dataset — from session's dataset: block, or --dataset flag
    let dataset: Record<string, any>[] | null = null;
    let datasetId: string | undefined;

    // In-file dataset: block takes precedence
    const inFileDataset = sessions[0]?.dataset;
    if (inFileDataset?.path) {
      try {
        const resolvedPath = resolve(
          sessionPath.endsWith(".yaml") || sessionPath.endsWith(".abs.yaml")
            ? dirname(sessionPath)
            : sessionPath,
          inFileDataset.path
        );
        dataset = loadDataset(resolvedPath);
        datasetId = inFileDataset.id;
      } catch (err: any) {
        console.error(chalk.red(`❌ Cannot load dataset '${inFileDataset.path}': ${err.message}`));
        process.exit(2);
      }
    } else if (cfg.dataset || options.dataset) {
      try {
        dataset = loadDataset(cfg.dataset || options.dataset);
      } catch (err: any) {
        console.error(chalk.red(`❌ Cannot load dataset: ${err.message}`));
        process.exit(2);
      }
    }

    // Apply filter
    if (dataset && options.filter) {
      const [fk, fv] = options.filter.split(":");
      dataset = dataset.filter((row) => String(row[fk]) === fv);
    }

    // Run
    const allResults: (RunResult & { rowVars?: Record<string, any> })[] = [];
    const parallel = parseInt(options.parallel || "1");

    runLogger.event("run.start", "info", {
      sessions: sessions.length,
      dataset_rows: dataset ? dataset.length : undefined,
      adapters:
        options.adapter && Object.keys(options.adapter).length
          ? options.adapter
          : cfg.adapters && Object.keys(cfg.adapters).length
            ? cfg.adapters
            : undefined,
    });

    const runOne = async (session: NormalizedSession, vars: Record<string, any>, rowVars?: Record<string, any>, rowIndex?: number) => {
      const resolved = {
        ...session,
        behaviors: resolveVariables(
          JSON.parse(JSON.stringify(session.behaviors)),
          vars
        ),
      };
      const sessionLogger = new RunLogger({
        runId: runLogger.runId,
        session: session.session,
        ...(dataset ? { row: rowIndex ?? 0 } : {}),
        ...(rowVars || (vars && Object.keys(vars).length) ? { row_vars: rowVars ?? vars } : {}),
      });
      const result = await run(resolved, agentConfig, vars, sessionLogger);
      (result as any).rowVars = rowVars || vars;
      (result as any).rowIndex = rowIndex;
      return result;
    };

    if (dataset) {
      const semaphore = new Array(parallel).fill(null).map(() => Promise.resolve());
      let semIdx = 0;
      const tasks = dataset.map(async (row, rowIndex) => {
        const idx = semIdx++ % parallel;
        await semaphore[idx];
        // Prefix columns with dataset id if declared in-file
        const prefixedRow: Record<string, any> = datasetId
          ? Object.fromEntries(Object.entries(row).map(([k, v]) => [`${datasetId}.${k}`, v]))
          : row;
        const vars = { ...runtimeVars, ...prefixedRow };
        const results = await Promise.all(sessions.map(s => runOne(s, vars, row, rowIndex)));
        results.forEach(r => allResults.push(r));
      });
      await Promise.all(tasks);
    } else if (Object.keys(runtimeVars).length > 0) {
      // Single run with var bindings
      for (const session of sessions) {
        allResults.push(await runOne(session, runtimeVars));
      }
    } else {
      // Single run, no dataset
      for (const session of sessions) {
        allResults.push(await runOne(session, {}));
      }
    }

    // Aggregate
    const rowsTotal = allResults.length;
    const rowsPassed = allResults.filter((r) => r.passed).length;
    const overallPassed = allResults.every((r) => r.passed);

    // Format output
    let output: string;
    if (options.format === "json") {
      output = JSON.stringify(
        {
          run_id: runLogger.runId,
          passed: overallPassed,
          rows_total: rowsTotal,
          rows_passed: rowsPassed,
          results: allResults.map((r) => ({
            session: r.session,
            row_index: (r as any).rowIndex,
            row_vars: r.rowVars,
            passed: r.passed,
            steps_total: r.stepsTotal,
            steps_matched: r.stepsMatched,
            evaluations_total: r.evaluationsTotal,
            evaluations_passed: r.evaluationsPassed,
            trace: r.steps.map((s) => ({
              step: s.step,
              behavior: {
                id: s.behavior.id,
                actor: s.behavior.actor,
                action: s.behavior.action,
                target: s.behavior.target,
                optional: s.behavior.optional,
              },
              matched: s.matched,
              sent: s.sent,
              skipped: s.skipped,
              observed: serializeObserved(s.observed),
              evaluations: s.evaluations.map(serializeEval),
            })),
            chain_evaluations: r.chainEvaluations.map(serializeEval),
          })),
        },
        null,
        2
      );
    } else if (options.format === "junit") {
      // Merge all results into one testsuite
      const allEvals = allResults.flatMap((r) => {
        const stepEvals = r.steps.flatMap((s) =>
          s.evaluations.map((e) => ({
            ...e,
            session: r.session,
            step: s.step,
            isChain: false,
          }))
        );
        const chainEvals = r.chainEvaluations.map((e) => ({
          ...e,
          session: r.session,
          isChain: true,
        }));
        return [...stepEvals, ...chainEvals];
      });

      const failures = allEvals.filter((e) => !e.passed).length;
      output = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      output += `<testsuite name="ABS" tests="${allEvals.length}" failures="${failures}" errors="0">\n`;
      for (const ev of allEvals) {
        const name = `[${(ev as any).session}] ${(ev as any).isChain ? "Chain" : `Step ${(ev as any).step}`}: ${ev.type}`;
        output += `  <testcase classname="ABS" name="${escapeXml(name)}" time="0">\n`;
        if (!ev.passed) {
          output += `    <failure message="${escapeXml(ev.reason)}">${escapeXml(ev.reason)}</failure>\n`;
        }
        output += `  </testcase>\n`;
      }
      output += `</testsuite>\n`;
    } else {
      // Table format — show first result in full, then summary for datasets
      if (allResults.length === 1) {
        output = formatTable(allResults[0]);
      } else {
        const lines: string[] = [];
        lines.push("┌──────────────────────────────────────────────────────────────┐");
        lines.push("│  ABS — Results                                               │");
        lines.push("├──────────────────────────────────────────────────────────────┤");
        lines.push(`│  Session:  ${allResults[0].session.padEnd(52)}│`);
        lines.push(`│  Agent:    ${cfg.agent_url.padEnd(52)}│`);
        lines.push(`│  Dataset:  ${String(rowsTotal).padEnd(52)} rows│`);
        const status = overallPassed ? chalk.green("✅ PASSED") : chalk.red("❌ FAILED");
        lines.push(`│  Result:   ${status.padEnd(62)}│`);
        lines.push(`│  Rows:     ${String(rowsPassed)}/${String(rowsTotal)} passed · ${String(rowsTotal - rowsPassed)} failed`.padEnd(64) + "│");
        lines.push("├──────┬──────────────────────────────┬──────────┬─────────────┤");
        lines.push("│  Row │ Variables                    │ Steps    │ Evaluations │");
        lines.push("├──────┼──────────────────────────────┼──────────┼─────────────┤");

        let rowNum = 0;
        for (const r of allResults) {
          rowNum++;
          const vars = r.rowVars
            ? Object.entries(r.rowVars)
                .map(([k, v]) => `${k}=${v}`)
                .join(" ")
                .substring(0, 28)
                .padEnd(28)
            : "(none)".padEnd(28);
          const skipped = r.steps.filter((s) => s.skipped).length;
          const applicable = r.stepsTotal - skipped;
          const steps = `${r.stepsMatched}/${applicable} ${r.stepsMatched === applicable ? "✅" : "❌"}`.padEnd(8);
          const evals = `${r.evaluationsPassed}/${r.evaluationsTotal} ${r.evaluationsPassed === r.evaluationsTotal ? "✅" : "❌"}`.padEnd(11);
          lines.push(`│ ${String(rowNum).padStart(4)} │ ${vars} │ ${steps} │ ${evals} │`);
        }

        lines.push("└──────┴──────────────────────────────┴──────────┴─────────────┘");

        if (!overallPassed) {
          lines.push("");
          lines.push(chalk.red(`❌ ${rowsTotal - rowsPassed} rows failed.`));
          for (const r of allResults) {
            if (!r.passed) {
              const vars = r.rowVars
                ? Object.entries(r.rowVars)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(", ")
                : "";
              lines.push(chalk.red(`\n  Row (${vars}):`));
              for (const s of r.steps) {
                for (const e of s.evaluations) {
                  if (!e.passed) {
                    lines.push(chalk.red(`    Step ${s.step} — ${e.type}: ${e.reason}`));
                  }
                }
              }
              for (const e of r.chainEvaluations) {
                if (!e.passed) {
                  lines.push(chalk.red(`    Chain — ${e.type}: ${e.reason}`));
                }
              }
            }
          }
        }

        output = lines.join("\n");
      }
    }

    runLogger.event("run.end", "info", {
      passed: overallPassed,
      rows_total: rowsTotal,
      rows_passed: rowsPassed,
      duration_ms: runLogger.elapsedMs(),
    });
    if (options.output) {
      writeFileSync(options.output, output);
      runLogger.event("report.written", "info", { path: options.output, format: options.format });
      console.log(`Report written to ${options.output}`);
    } else {
      console.log(output);
    }

    closeLogging();
    process.exit(overallPassed ? 0 : 1);
  });

// ── report ──

program
  .command("report")
  .description("View results from a previous run")
  .argument("[file]", "JSON report file")
  .option("--format <format>", "table, json, or junit", "table")
  .option("--failed", "Show only failed cases", false)
  .option("--detail <n>", "Show full trace for a specific row")
  .action(async (file, options) => {
    if (!file) {
      console.error(chalk.red("❌ Provide a report file."));
      process.exit(2);
    }

    let data: any;
    try {
      data = JSON.parse(readFileSync(file, "utf-8"));
    } catch (err: any) {
      console.error(chalk.red(`❌ Cannot read report: ${err.message}`));
      process.exit(2);
    }

    // Handle multi-row reports (from dataset runs)
    const results: any[] = data.results ?? [data];

    // --detail: show full trace for a specific row (1-indexed)
    if (options.detail) {
      const idx = parseInt(options.detail) - 1;
      if (idx < 0 || idx >= results.length) {
        console.error(chalk.red(`❌ Row ${options.detail} not found. Report has ${results.length} rows.`));
        process.exit(2);
      }
      const row = results[idx];
      console.log(formatTable({
        session: row.session ?? data.session ?? "",
        agent: data.agent ?? "",
        passed: row.passed,
        steps: row.trace ?? [],
        chainEvaluations: row.chain_evaluations ?? [],
        stepsTotal: row.steps_total ?? 0,
        stepsMatched: row.steps_matched ?? 0,
        evaluationsTotal: row.evaluations_total ?? 0,
        evaluationsPassed: row.evaluations_passed ?? 0,
      }));
      return;
    }

    if (options.format === "json") {
      if (options.failed) {
        const failed = results.filter((r: any) => !r.passed);
        console.log(JSON.stringify({ ...data, results: failed }, null, 2));
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
    } else if (options.format === "junit") {
      const filtered = options.failed ? results.filter((r: any) => !r.passed) : results;
      console.log(formatJunit({ ...data, results: filtered }));
    } else {
      // Table format — show aggregated view for multi-row, or single-row view
      if (results.length === 1) {
        const row = results[0];
        console.log(formatTable({
          session: row.session ?? data.session ?? "",
          agent: data.agent ?? "",
          passed: row.passed,
          steps: row.trace ?? [],
          chainEvaluations: row.chain_evaluations ?? [],
          stepsTotal: row.steps_total ?? 0,
          stepsMatched: row.steps_matched ?? 0,
          evaluationsTotal: row.evaluations_total ?? 0,
          evaluationsPassed: row.evaluations_passed ?? 0,
        }));
      } else {
        // Multi-row: show summary + failed rows
        const rows = options.failed ? results.filter((r: any) => !r.passed) : results;
        const passed = results.filter((r: any) => r.passed).length;
        const lines: string[] = [];
        lines.push("┌──────────────────────────────────────────────────────────────┐");
        lines.push("│  ABS — Report                                                │");
        lines.push("├──────────────────────────────────────────────────────────────┤");
        lines.push(`│  Session:  ${(data.session ?? "").padEnd(52)}│`);
        lines.push(`│  Agent:    ${(data.agent ?? "").padEnd(52)}│`);
        lines.push(`│  Rows:     ${String(results.length).padEnd(52)}│`);
        const status = data.passed ? chalk.green("✅ PASSED") : chalk.red("❌ FAILED");
        lines.push(`│  Result:   ${status.padEnd(62)}│`);
        lines.push(`│  Passed:   ${String(passed)}/${String(results.length)}`.padEnd(64) + "│");
        lines.push("├──────┬──────────────────────────────┬──────────┬─────────────┤");
        lines.push("│  Row │ Session                      │ Steps    │ Evaluations │");
        lines.push("├──────┼──────────────────────────────┼──────────┼─────────────┤");

        let rowNum = 0;
        for (const r of rows) {
          rowNum++;
          const actualNum = results.indexOf(r) + 1;
          const sessionName = (r.session || "").substring(0, 28).padEnd(28);
          const skipped = (r.trace ?? []).filter((s: any) => s.skipped).length;
          const applicable = (r.steps_total ?? 0) - skipped;
          const steps = `${r.steps_matched ?? 0}/${applicable} ${(r.steps_matched ?? 0) === applicable ? "✅" : "❌"}`.padEnd(8);
          const evals = `${r.evaluations_passed ?? 0}/${r.evaluations_total ?? 0} ${(r.evaluations_passed ?? 0) === (r.evaluations_total ?? 0) ? "✅" : "❌"}`.padEnd(11);
          lines.push(`│ ${String(actualNum).padStart(4)} │ ${sessionName} │ ${steps} │ ${evals} │`);
        }

        lines.push("└──────┴──────────────────────────────┴──────────┴─────────────┘");

        if (!options.failed && !data.passed) {
          const failedRows = results.filter((r: any) => !r.passed);
          lines.push("");
          lines.push(chalk.red(`❌ ${failedRows.length} rows failed:`) + "\n");
          for (const r of failedRows) {
            const idx = results.indexOf(r) + 1;
            lines.push(chalk.red(`  Row ${idx}: ${r.session || ""}`));
            const failedSteps = (r.trace || []).filter((s: any) =>
              (s.evaluations || []).some((e: any) => !e.passed && !e.inconclusive)
            );
            for (const s of failedSteps) {
              for (const e of (s.evaluations || [])) {
                if (!e.passed && !e.inconclusive) {
                  lines.push(chalk.red(`    Step ${s.step} — ${e.type}: ${e.reason}`));
                }
              }
            }
            for (const e of (r.chain_evaluations || [])) {
              if (!e.passed && !e.inconclusive) {
                lines.push(chalk.red(`    Chain — ${e.type}: ${e.reason}`));
              }
            }
          }
          lines.push(`\nRun ${chalk.bold(`abs report ${file} --detail <row>`)} to see a full trace.`);
        }
        console.log(lines.join("\n"));
      }
    }
  });

// ── helpers ──

function collectVar(value: string, previous: Record<string, string>): Record<string, string> {
  const [k, v] = value.split("=");
  previous[k] = v;
  return previous;
}

function collectAdapter(
  value: string,
  previous: Record<string, string>
): Record<string, string> {
  if (value.includes("=")) {
    const [k, ...rest] = value.split("=");
    previous[k.trim()] = rest.join("=").trim();
  } else {
    // Bare provider: `--adapter azure` becomes the default for all its types.
    previous[value.trim()] = "";
  }
  return previous;
}

// ── Evaluator adapter registry ──

interface AdapterProvider {
  module: string;
  fn: string;
  configure?: string;
  /** Evaluator types this provider can handle. */
  supported: string[];
}

const ADAPTER_PROVIDERS: Record<string, AdapterProvider> = {
  aievaluator: {
    module: "./evaluators/adapters/aievaluator",
    fn: "aievaluatorAdapter",
    configure: "configureAIEvaluator",
    supported: ["llm_judge", "Groundedness", "Relevance", "Coherence", "Fluency"],
  },
  azure: {
    module: "./evaluators/adapters/azure",
    fn: "azureAdapter",
    configure: "configureAzure",
    supported: ["llm_judge", "Groundedness", "Relevance", "Coherence", "Fluency", "custom"],
  },
  aws: {
    module: "./evaluators/adapters/aws",
    fn: "awsAdapter",
    configure: "configureAws",
    supported: ["llm_judge", "custom"],
  },
  google: {
    module: "./evaluators/adapters/google",
    fn: "googleAdapter",
    configure: "configureGoogle",
    supported: [
      "llm_judge",
      "Groundedness",
      "Relevance",
      "Coherence",
      "Fluency",
      "HateUnfairness",
      "Violence",
      "Sexual",
      "SelfHarm",
      "custom",
    ],
  },
};

/**
 * Configure evaluator adapters from `--adapter` and `abs.config.yaml`.
 *
 *   --adapter azure            → azure becomes the default for all its types
 *   --adapter llm_judge=azure  → azure becomes the default for llm_judge only
 *   adapters: { llm_judge: aievaluator } in abs.config.yaml
 *
 * Every provider is also registered by name so a rule can select it with
 * `adapter: <provider>`.
 */
function setupAdapters(
  cliAdapters: Record<string, string>,
  configAdapters: Record<string, string> | undefined
): void {
  const specs: { type?: string; provider: string }[] = [];
  if (configAdapters) {
    for (const [type, provider] of Object.entries(configAdapters)) {
      specs.push({ type, provider: String(provider) });
    }
  }
  for (const [key, value] of Object.entries(cliAdapters ?? {})) {
    if (value) specs.push({ type: key, provider: value });
    else specs.push({ provider: key });
  }

  for (const { type, provider } of specs) {
    const entry = ADAPTER_PROVIDERS[provider];
    if (!entry) {
      console.error(chalk.yellow(`⚠️  Unknown adapter provider: ${provider}`));
      continue;
    }
    let mod: any;
    try {
      mod = require(entry.module);
    } catch (err: any) {
      console.error(chalk.red(`❌ Cannot load adapter '${provider}': ${err.message}`));
      continue;
    }
    if (entry.configure && typeof mod[entry.configure] === "function") {
      mod[entry.configure]();
    }
    const fn = mod[entry.fn];
    if (typeof fn !== "function") {
      console.error(chalk.red(`❌ Adapter '${provider}' does not export ${entry.fn}`));
      continue;
    }
    // Named registration → selectable per-rule via `adapter: <provider>`
    for (const t of entry.supported) registerAdapter(t, fn, provider);
    // Default registration
    for (const t of type ? [type] : entry.supported) {
      if (entry.supported.includes(t)) registerAdapter(t, fn);
    }
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

program
  .command("generate-ci")
  .description("Generate a CI/CD workflow for GitHub Actions or GitLab CI")
  .option("--platform <platform>", "github or gitlab", "github")
  .option("--session <path>", "Session path", "./sessions/")
  .option("--dataset <path>", "Dataset path", "./datasets/")
  .option("--agent <url>", "Agent URL (uses ABS_AGENT_URL env var if not set)")
  .option("--output <path>", "Output file (default: stdout)")
  .action((options) => {
    const agent = options.agent || "${{ vars.STAGING_AGENT_URL }}";

    let snippet: string;
    if (options.platform === "gitlab") {
      snippet = `# GitLab CI — ABS Agent Quality Gate
# Generated by abs generate-ci
# Place in .gitlab-ci.yml or include in your existing pipeline

abs-quality-gate:
  stage: test
  image: node:20
  before_script:
    - npm install -g abslang
  script:
    - |
      abslang run ${options.session} \\
        --agent $AGENT_URL \\
        --dataset ${options.dataset} \\
        --format junit \\
        --ci > report.xml
  artifacts:
    reports:
      junit: report.xml
    when: always
  rules:
    - if: \$CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    AGENT_URL: "${agent}"
`;
    } else {
      snippet = `# GitHub Actions — ABS Agent Quality Gate
# Generated by abs generate-ci
# Place in .github/workflows/abs-quality-gate.yml

name: ABS Agent Quality Gate

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  quality-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install ABS
        run: npm install -g abslang

      - name: Run ABS evaluations
        env:
          ABS_AGENT_URL: \${{ vars.STAGING_AGENT_URL }}
        run: |
          abslang run ${options.session} \\
            --agent \$ABS_AGENT_URL \\
            --dataset ${options.dataset} \\
            --format junit \\
            --ci > report.xml

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: abs-report
          path: report.xml

      - name: Publish test results
        if: always()
        uses: dorny/test-reporter@v1
        with:
          name: ABS Results
          path: report.xml
          reporter: java-junit
`;
    }

    if (options.output) {
      const { writeFileSync } = require("fs");
      writeFileSync(options.output, snippet);
      console.log(`✅ Workflow written to ${options.output}`);
    } else {
      console.log(snippet);
    }
  });

// ── Terminal markdown renderer ──

// ── Code highlighting (zero dependencies, mirrors cli.py) ──

function highlightCodeLine(lang: string, line: string): string {
  if (lang === "yaml" || lang === "yml") return highlightYamlLine(line);
  if (lang === "json" || lang === "jsonl") return highlightJsonLine(line);
  if (lang === "bash" || lang === "sh" || lang === "shell") return highlightBashLine(line);
  return chalk.dim(line);
}

function highlightYamlLine(line: string): string {
  if (/^\s*#/.test(line)) return chalk.green.dim(line);
  const km = line.match(/^(\s*-?\s*)([A-Za-z0-9_.]+)(\s*:\s*)(.*)$/);
  if (km) return km[1] + chalk.cyan(km[2]) + km[3] + highlightYamlValue(km[4]);
  return highlightYamlValue(line);
}

function highlightYamlValue(rest: string): string {
  let out = "";
  let i = 0;
  while (i < rest.length) {
    const ch = rest[i];
    if (ch === "#" && (i === 0 || rest[i - 1] === " ")) {
      out += chalk.green.dim(rest.slice(i));
      break;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < rest.length && rest[j] !== ch) j++;
      j = Math.min(rest.length, j + 1);
      out += chalk.yellow(rest.slice(i, j));
      i = j;
      continue;
    }
    if (ch === "{" && rest[i + 1] === "{") {
      let j = rest.indexOf("}}", i);
      j = j === -1 ? rest.length : j + 2;
      out += chalk.cyan.bold(rest.slice(i, j));
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < rest.length && /[0-9.]/.test(rest[j])) j++;
      out += chalk.magenta(rest.slice(i, j));
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < rest.length && /[A-Za-z_]/.test(rest[j])) j++;
      const word = rest.slice(i, j);
      out += /^(true|false|null)$/i.test(word) ? chalk.magenta(word) : word;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function highlightJsonLine(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') {
        if (line[j] === "\\") j++;
        j++;
      }
      j = Math.min(line.length, j + 1);
      let k = j;
      while (k < line.length && line[k] === " ") k++;
      out += line[k] === ":" ? chalk.cyan(line.slice(i, j)) : chalk.yellow(line.slice(i, j));
      i = j;
      continue;
    }
    if (ch === "{" && line[i + 1] === "{") {
      let j = line.indexOf("}}", i);
      j = j === -1 ? line.length : j + 2;
      out += chalk.cyan.bold(line.slice(i, j));
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(line[i + 1] || ""))) {
      let j = i + 1;
      while (j < line.length && /[0-9.eE+-]/.test(line[j])) j++;
      out += chalk.magenta(line.slice(i, j));
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < line.length && /[A-Za-z_]/.test(line[j])) j++;
      const word = line.slice(i, j);
      out += /^(true|false|null)$/i.test(word) ? chalk.magenta(word) : word;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function highlightBashLine(line: string): string {
  if (/^\s*#/.test(line)) return chalk.green.dim(line);
  return line.replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, (v) => chalk.cyan(v));
}

function renderMd(text: string, opts: { renderMermaid?: boolean } = {}): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let codeBuf: string[] | null = null;
  let codeLang = "";
  let mermaidBuf: string[] | null = null;

  const emitCodeBlock = (buf: string[], lang: string) => {
    const label = lang || "code";
    const cols = Math.max(24, Math.max(...buf.map((l) => l.length), 0) + 4);
    const pad = "─".repeat(Math.max(0, cols - 4 - label.length - 1));
    out.push(chalk.dim(`┌─ ${label} ` + pad));
    for (const l of buf) out.push(chalk.dim("│ ") + highlightCodeLine(lang, l));
    out.push(chalk.dim("└" + "─".repeat(cols - 1)));
  };

  for (const line of lines) {
    // Code blocks
    if (line.startsWith("```")) {
      if (codeBuf !== null) {
        const buf = codeBuf;
        const lang = codeLang;
        codeBuf = null;
        codeLang = "";
        emitCodeBlock(buf, lang);
        continue;
      }
      if (mermaidBuf !== null) {
        const buf = mermaidBuf;
        mermaidBuf = null;
        const cols = process.stdout.columns ?? 100;
        const rendered = renderSequenceDiagram(buf.join("\n"), cols > 0 ? cols : 100);
        if (rendered) {
          out.push(rendered);
        } else {
          emitCodeBlock(buf, "mermaid");
        }
        continue;
      }
      const lang = line.slice(3).trim().toLowerCase();
      if (lang.startsWith("mermaid") && opts.renderMermaid !== false) {
        mermaidBuf = [];
      } else {
        codeBuf = [];
        codeLang = lang;
      }
      continue;
    }
    if (codeBuf !== null) {
      codeBuf.push(line);
      continue;
    }
    if (mermaidBuf !== null) {
      mermaidBuf.push(line);
      continue;
    }

    let rendered = line;

    // Headers
    if (/^### /.test(rendered)) {
      rendered = chalk.bold.underline(rendered.replace(/^### /, ""));
    } else if (/^## /.test(rendered)) {
      rendered = chalk.bold.underline(rendered.replace(/^## /, ""));
    } else if (/^# /.test(rendered)) {
      rendered = chalk.bold.underline(rendered.replace(/^# /, ""));
    }

    // Bold
    rendered = rendered.replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t));

    // Inline code
    rendered = rendered.replace(/`([^`]+)`/g, (_, t) => chalk.cyan(t));

    // Bullet lists
    if (/^\s*- \s/.test(rendered)) {
      rendered = rendered.replace(/^(\s*)- /, "$1  • ");
    }

    // Numbered lists — indent slightly
    if (/^\d+\.\s/.test(rendered)) {
      rendered = "  " + rendered;
    }

    out.push(rendered);
  }

  return out.join("\n");
}

// ── chat ──

program
  .command("chat")
  .description("Start an ABS assistant chat session")
  .option("--provider <provider>", "openai, anthropic, or deepseek (auto-detects from env if not set)")
  .option("--api-key <key>", "API key (or set OPENAI_API_KEY / ANTHROPIC_API_KEY / DEEPSEEK_API_KEY)")
  .option("--model <name>", "model or Azure deployment name (overrides ABS_CHAT_MODEL)")
  .option("--base-url <url>", "API base URL (overrides ABS_CHAT_BASE_URL)")
  .option("--max-tokens <n>", "max output tokens (default: 4096)")
  .option("--temperature <n>", "sampling temperature (default: 0.3)")
  .option("--omit-temperature", "never send temperature (for models that reject it)")
  .option("--max-tokens-param <name>", "token-limit field name: max_tokens (default) or max_completion_tokens (gpt-5/o-series)")
  .option("--param <key=value>", "extra request body parameter, repeatable (e.g. --param reasoning_effort=low)", (value: string, previous: string[]) => previous.concat([value]), [])
  .action(async (options) => {
    const { detectProvider, getProviderKey, getProviderKeyEnv, getProviderConfig } = await import("./providers");

    const provider = options.provider || detectProvider();
    const apiKey = options.apiKey || getProviderKey(provider as any);
    if (!apiKey) {
      console.error(chalk.red(`❌ No API key found for ${provider}.`));
      console.error(`   Set ${getProviderKeyEnv(provider as any)} or pass --api-key.`);
      process.exit(2);
    }

    const providerConfig = getProviderConfig(provider as any);
    const model = options.model || providerConfig.model;
    const baseUrl = options.baseUrl || providerConfig.baseUrl;

    const maxTokens = options.maxTokens !== undefined ? Number(options.maxTokens) : undefined;
    if (maxTokens !== undefined && (!Number.isFinite(maxTokens) || maxTokens <= 0)) {
      console.error(chalk.red(`❌ --max-tokens must be a positive number, got '${options.maxTokens}'.`));
      process.exit(2);
    }

    const temperature = options.temperature !== undefined ? Number(options.temperature) : undefined;
    if (temperature !== undefined && !Number.isFinite(temperature)) {
      console.error(chalk.red(`❌ --temperature must be a number, got '${options.temperature}'.`));
      process.exit(2);
    }

    const maxTokensParam = options.maxTokensParam;
    if (maxTokensParam && maxTokensParam !== "max_tokens" && maxTokensParam !== "max_completion_tokens") {
      console.error(chalk.red(`❌ --max-tokens-param must be max_tokens or max_completion_tokens, got '${maxTokensParam}'.`));
      process.exit(2);
    }

    const extraParams: Record<string, unknown> = {};
    for (const raw of options.param as string[]) {
      const eq = raw.indexOf("=");
      if (eq <= 0) {
        console.error(chalk.red(`❌ --param expects key=value, got '${raw}'.`));
        process.exit(2);
      }
      const key = raw.slice(0, eq).trim();
      const value = raw.slice(eq + 1);
      try {
        extraParams[key] = JSON.parse(value);
      } catch {
        extraParams[key] = value;
      }
    }

    const { chat, newConversation, extractYaml, extractMermaid } = await import("./assistant");
    const { PasteAwareInput, RawChatInput, enableBracketedPaste, disableBracketedPaste } = await import("./paste-input");
    const messages = newConversation();
    const collector = new PasteAwareInput();

    // TTY sessions use a raw-mode editor (Node readline swallows the
    // bracketed-paste markers); piped input falls back to plain readline.
    const isTTY = process.stdin.isTTY && process.stdout.isTTY;
    const editor = isTTY ? new RawChatInput() : null;
    const rl = isTTY
      ? null
      : (await import("readline")).createInterface({
          input: process.stdin,
          output: process.stdout,
        });

    enableBracketedPaste();
    process.on("exit", () => {
      editor?.stop();
      disableBracketedPaste();
    });

    console.log(chalk.dim(`  Provider: ${provider} · model: ${model}\n`));
    console.log(chalk.bold("\n🤖 ABS Assistant — describe the agent behavior you want to test\n"));
    console.log(chalk.dim("  I'll ask you guided questions to understand your flow and build the best possible test."));
    console.log(chalk.dim("  Some questions may feel extra — they're there to make sure we don't miss edge cases.\n"));
    console.log(chalk.dim("  Type /mermaid to paste a Mermaid diagram, /render off to show diagrams as raw text, /save <filename> to save, /quit to exit.\n"));
    console.log(chalk.dim("  💡 Paste long text (even multi-line) and press Enter to send it as one message."));
    console.log(chalk.dim("  End a line with \\ to keep typing on the next line (finish with an empty line).\n"));
    console.log(chalk.dim("  ⚠️  Not all agents expose intermediate steps. The assistant will ask about this first.\n"));

    let lastYaml: string | null = null;
    let mermaidLines: string[] | null = null;
    let multiline: string[] | null = null;
    let renderDiagrams = true;

    const spinner = (running: boolean) => {
      if (!running) return;
      const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      let i = 0;
      const timer = setInterval(() => {
        process.stdout.write(`\r${chalk.blue(frames[i++ % frames.length])} `);
      }, 80);
      return () => {
        clearInterval(timer);
        process.stdout.write("\r");
      };
    };

    const sendMessage = async (content: string) => {
      const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      messages.push({ role: "user", content: normalized });
      try {
        const stop = spinner(true);
        const response = await chat(messages, {
          apiKey,
          model,
          baseUrl,
          provider,
          maxTokens,
          temperature,
          omitTemperature: !!options.omitTemperature,
          maxTokensParam,
          extraParams,
        });
        stop?.();
        console.log(chalk.blue("Assistant: "));
        console.log(renderMd(response, { renderMermaid: renderDiagrams }));
        console.log();

        messages.push({ role: "assistant", content: response });

        const yaml = extractYaml(response);
        if (yaml) {
          // Validate extracted YAML
          try {
            const { parseYaml, expandFragments } = await import("./parser");
            const docs = parseYaml(yaml);
            expandFragments(docs[0]);
            lastYaml = yaml;
            console.log(chalk.dim("  ✅ Valid YAML extracted. Use /save <name> (e.g. /save refunds) or /save path/name\n"));
          } catch (err: any) {
            lastYaml = yaml; // still save it so user can /force
            console.log(chalk.yellow(`  ⚠️  YAML extracted but has issues: ${err.message}`));
            console.log(chalk.dim("  Use /save <path> to try anyway, or keep chatting to fix.\n"));
          }
        }

        const mermaid = extractMermaid(response);
        if (mermaid) {
          console.log(chalk.dim(`  📊 Mermaid diagram ${renderDiagrams ? "rendered above" : "included"} — edit it and paste it back with /mermaid to refine.\n`));
        }
      } catch (err: any) {
        console.error(chalk.red(`\nError: ${err.message}\n`));
      }
    };

    const readLine = (prompt: string): Promise<string | null> => {
      if (editor) {
        editor.start();
        return editor.requestLine(prompt, () => {
          console.log(chalk.dim("\nBye!\n"));
          editor.stop();
          disableBracketedPaste();
          process.exit(0);
        });
      }
      return new Promise<string | null>((resolve) => {
        rl!.question(prompt, resolve);
        rl!.once("close", () => resolve(null));
      });
    };

    const ask = async () => {
      const prompt = chalk.green(multiline ? "… " : mermaidLines ? "mermaid> " : "You: ");
      const input = await readLine(prompt);
      if (input === null) {
        console.log(chalk.dim("\nBye!\n"));
        editor?.stop();
        rl?.close();
        return;
      }

      const message = collector.feed(input);
      if (message === null) {
        ask();
        return;
      }

      // Manual multi-line mode (started with a trailing "\\").
      if (multiline) {
        if (message.trim() === "") {
          const block = multiline.join("\n");
          multiline = null;
          console.log(chalk.dim(`  → message captured (${block.split("\n").length} lines)\n`));
          await sendMessage(block);
        } else {
          multiline.push(...message.split("\n"));
        }
        ask();
        return;
      }

      // Collecting a pasted diagram: keep raw lines (indentation matters) until an empty line.
      if (mermaidLines) {
        if (message.trim() === "") {
          const diagram = mermaidLines.join("\n");
          mermaidLines = null;
          console.log(chalk.dim(`  → diagram captured (${diagram.split("\n").length} lines)\n`));
          await sendMessage("```mermaid\n" + diagram + "\n```");
        } else {
          mermaidLines.push(...message.split("\n"));
        }
        ask();
        return;
      }

      if (!message.trim()) {
        ask();
        return;
      }

      const trimmed = message.trim();

      if (trimmed === "/quit" || trimmed === "/q") {
        console.log(chalk.dim("\nBye!\n"));
        editor?.stop();
        rl?.close();
        return;
      }

      if (trimmed === "/mermaid" || trimmed === "/mmd") {
        mermaidLines = [];
        console.log(chalk.dim("  Paste the Mermaid diagram. Finish with an empty line.\n"));
        ask();
        return;
      }

      if (trimmed === "/render off" || trimmed === "/render on") {
        renderDiagrams = trimmed.endsWith("on");
        console.log(chalk.dim(`  Mermaid rendering ${renderDiagrams ? "on" : "off"} (raw text).\n`));
        ask();
        return;
      }

      if (trimmed.startsWith("/save")) {
          let path = trimmed.split(/\s+/)[1];
          if (!lastYaml) {
            console.log(chalk.yellow("No YAML generated yet. Chat a bit first.\n"));
          } else if (!path) {
            console.log(chalk.dim("Usage: /save <filename>  (e.g. /save refunds → refunds.abs.yaml)\n"));
          } else {
            // Auto-append .abs.yaml if no yaml extension
            if (!path.endsWith(".yaml") && !path.endsWith(".abs.yaml")) {
              path = path + ".abs.yaml";
            }

            // Check for directory
            const { existsSync, statSync } = await import("fs");
            try {
              if (existsSync(path) && statSync(path).isDirectory()) {
                console.log(chalk.red(`❌ '${path}' is a directory. Provide a filename, e.g. /save refunds\n`));
                ask();
                return;
              }
            } catch (_) {}

            // Validate YAML before saving
            try {
              const { parseYaml, expandFragments } = await import("./parser");
              const docs = parseYaml(lastYaml);
              expandFragments(docs[0]);
              const { writeFileSync } = await import("fs");
              writeFileSync(path, lastYaml);
              console.log(chalk.green(`✅ Saved to ${path}\n`));
            } catch (err: any) {
              console.log(chalk.red(`❌ Invalid YAML: ${err.message}`));
              console.log(chalk.yellow("  Keep chatting to refine it, or use /force to save anyway.\n"));
            }
          }
          ask();
          return;
        }

        if (trimmed.startsWith("/force")) {
          let path = trimmed.split(/\s+/)[1];
          if (!lastYaml) {
            console.log(chalk.yellow("No YAML generated yet.\n"));
          } else if (path) {
            if (!path.endsWith(".yaml") && !path.endsWith(".abs.yaml")) {
              path = path + ".abs.yaml";
            }
            const { writeFileSync } = await import("fs");
            writeFileSync(path, lastYaml);
            console.log(chalk.yellow(`⚠️  Saved without validation to ${path}\n`));
          }
          ask();
          return;
        }

        if (trimmed.endsWith("\\") && trimmed.length > 1) {
          multiline = [trimmed.slice(0, -1).trimEnd()];
          console.log(chalk.dim("  Continue typing; finish with an empty line.\n"));
          ask();
          return;
        }

        await sendMessage(message);
        ask();
    };

    ask();
  });

// ── Entry ──

program.parse();
