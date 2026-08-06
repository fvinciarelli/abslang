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
import { formatTable, formatJson, formatJunit } from "./formatters/table";
import { mergeConfig } from "./config";

const program = new Command();

program
  .name("abs")
  .description("ABS — Agent Behavior Specification CLI")
  .version("0.1.2");

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
  format: openai
  auth: none

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
  .option("--agent-format <format>", "openai, claude, or gemini", "openai")
  .option("--agent-auth <auth>", "none, api_key, bearer, or oauth2", "none")
  .option("--agent-token <token>", "Token or API key")
  .option("--agent-refresh-url <url>", "OAuth2 token refresh URL")
  .option("--agent-refresh-token <token>", "OAuth2 refresh token")
  .option("--agent-client-id <id>", "OAuth2 client ID")
  .option("--adapter <binding>", "Evaluator adapter binding", collectAdapter, {} as Record<string, string>)
  .option("--format <format>", "table, json, or junit", "table")
  .option("--ci", "CI mode (no colors, no prompts)", false)
  .option("--timeout <n>", "Timeout per session run in seconds", "300")
  .option("--output <path>", "Write report to file")
  .option("--parallel <n>", "Run N dataset rows in parallel", "1")
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
      dataset: options.dataset,
      adapters: options.adapter,
    });

    if (!cfg.agent_url) {
      console.error(chalk.red("❌ Provide --agent or set ABS_AGENT_URL."));
      process.exit(2);
    }

    // Configure AI Evaluator
    const adapters = cfg.adapters || {};
    for (const [type, provider] of Object.entries(adapters)) {
      if (provider === "aievaluator") {
        const { configureAIEvaluator } = require("./evaluators/adapters/aievaluator");
        configureAIEvaluator({
          apiKey: process.env.AIEVALUATOR_API_KEY,
          engineUrl: process.env.AIEVALUATOR_ENGINE_URL,
        });
      }
    }

    const agentConfig: AgentConfig = {
      url: cfg.agent_url,
      format: cfg.agent_format,
      auth: cfg.agent_auth,
      token: cfg.agent_token,
      refreshUrl: options.agentRefreshUrl,
      refreshToken: options.agentRefreshToken,
      clientId: options.agentClientId,
      timeout: parseInt(options.timeout) || 300,
    };

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

    const runOne = async (session: NormalizedSession, vars: Record<string, any>, rowVars?: Record<string, any>) => {
      const resolved = {
        ...session,
        behaviors: resolveVariables(
          JSON.parse(JSON.stringify(session.behaviors)),
          vars
        ),
      };
      const result = await run(resolved, agentConfig);
      (result as any).rowVars = rowVars || vars;
      return result;
    };

    if (dataset) {
      const semaphore = new Array(parallel).fill(null).map(() => Promise.resolve());
      let semIdx = 0;
      const tasks = dataset.map(async (row) => {
        const idx = semIdx++ % parallel;
        await semaphore[idx];
        // Prefix columns with dataset id if declared in-file
        const prefixedRow: Record<string, any> = datasetId
          ? Object.fromEntries(Object.entries(row).map(([k, v]) => [`${datasetId}.${k}`, v]))
          : row;
        const vars = { ...runtimeVars, ...prefixedRow };
        const results = await Promise.all(sessions.map(s => runOne(s, vars, row)));
        results.forEach(r => allResults.push(r));
      });
      await Promise.all(tasks);
    } else if (Object.keys(runtimeVars).length > 0) {
      // Single run with var bindings
      for (const session of sessions) {
        const resolved = {
          ...session,
          behaviors: resolveVariables(
            JSON.parse(JSON.stringify(session.behaviors)),
            runtimeVars
          ),
        };
        const result = await run(resolved, agentConfig);
        allResults.push(result);
      }
    } else {
      // Single run, no dataset
      for (const session of sessions) {
        const result = await run(session, agentConfig);
        allResults.push(result);
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
          passed: overallPassed,
          rows_total: rowsTotal,
          rows_passed: rowsPassed,
          results: allResults.map((r) => ({
            session: r.session,
            row_vars: r.rowVars,
            passed: r.passed,
            steps_total: r.stepsTotal,
            steps_matched: r.stepsMatched,
            evaluations_total: r.evaluationsTotal,
            evaluations_passed: r.evaluationsPassed,
            trace: r.steps.map((s) => ({
              step: s.step,
              behavior: {
                actor: s.behavior.actor,
                action: s.behavior.action,
                target: s.behavior.target,
              },
              matched: s.matched,
              sent: s.sent,
              observed: s.observed,
              evaluations: s.evaluations,
            })),
            chain_evaluations: r.chainEvaluations,
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
          const steps = `${r.stepsMatched}/${r.stepsTotal} ${r.stepsMatched === r.stepsTotal ? "✅" : "❌"}`.padEnd(8);
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

    if (options.output) {
      writeFileSync(options.output, output);
      console.log(`Report written to ${options.output}`);
    } else {
      console.log(output);
    }

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
          const steps = `${r.steps_matched ?? 0}/${r.steps_total ?? 0} ${(r.steps_matched ?? 0) === (r.steps_total ?? 0) ? "✅" : "❌"}`.padEnd(8);
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

// ── chat provider helpers ──

function detectProvider(): string {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  return "openai";
}

function getProviderKey(provider: string): string | undefined {
  switch (provider) {
    case "openai": return process.env.OPENAI_API_KEY;
    case "anthropic": return process.env.ANTHROPIC_API_KEY;
    case "deepseek": return process.env.DEEPSEEK_API_KEY;
    default: return undefined;
  }
}

function getProviderKeyEnv(provider: string): string {
  switch (provider) {
    case "openai": return "OPENAI_API_KEY";
    case "anthropic": return "ANTHROPIC_API_KEY";
    case "deepseek": return "DEEPSEEK_API_KEY";
    default: return "<PROVIDER>_API_KEY";
  }
}

function getProviderConfig(provider: string): { model: string; baseUrl: string } {
  switch (provider) {
    case "openai":
      return { model: process.env.ABS_CHAT_MODEL || "gpt-4o", baseUrl: process.env.ABS_CHAT_BASE_URL || "https://api.openai.com/v1" };
    case "anthropic":
      return { model: process.env.ABS_CHAT_MODEL || "claude-sonnet-4-20250514", baseUrl: process.env.ABS_CHAT_BASE_URL || "https://api.anthropic.com/v1" };
    case "deepseek":
      return { model: process.env.ABS_CHAT_MODEL || "deepseek-chat", baseUrl: process.env.ABS_CHAT_BASE_URL || "https://api.deepseek.com/v1" };
    default:
      throw new Error(`Unknown provider: ${provider}. Use openai, anthropic, or deepseek.`);
  }
}

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
  const [k, v] = value.split("=");
  previous[k] = v;
  return previous;
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
  image: python:3.12
  before_script:
    - pip install abs
  script:
    - |
      abs run ${options.session} \\
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

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install ABS
        run: pip install abs

      - name: Run ABS evaluations
        env:
          ABS_AGENT_URL: \${{ vars.STAGING_AGENT_URL }}
        run: |
          abs run ${options.session} \\
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

// ── chat ──

program
  .command("chat")
  .description("Start an ABS assistant chat session")
  .option("--provider <provider>", "openai, anthropic, or deepseek (auto-detects from env if not set)")
  .option("--api-key <key>", "API key (or set OPENAI_API_KEY / ANTHROPIC_API_KEY / DEEPSEEK_API_KEY)")
  .action(async (options) => {
    const provider = options.provider || detectProvider();
    const apiKey = options.apiKey || getProviderKey(provider);
    if (!apiKey) {
      console.error(chalk.red(`❌ No API key found for ${provider}.`));
      console.error(`   Set ${getProviderKeyEnv(provider)} or pass --api-key.`);
      process.exit(2);
    }

    const { model, baseUrl } = getProviderConfig(provider);

    const { chat, newConversation, extractYaml } = await import("./assistant");
    const messages = newConversation();
    const readline = await import("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(chalk.bold("\n🤖 ABS Assistant — describe the agent behavior you want to test\n"));
    console.log(chalk.dim("  I'll ask you guided questions to understand your flow and build the best possible test."));
    console.log(chalk.dim("  Some questions may feel extra — they're there to make sure we don't miss edge cases.\n"));
    console.log(chalk.dim("  Type /save <path> to save the generated YAML, /quit to exit.\n"));

    let lastYaml: string | null = null;

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

    const ask = () => {
      rl.question(chalk.green("You: "), async (input: string) => {
        const trimmed = input.trim();

        if (trimmed === "/quit" || trimmed === "/q") {
          console.log(chalk.dim("\nBye!\n"));
          rl.close();
          return;
        }

        if (trimmed.startsWith("/save")) {
          const path = trimmed.split(/\s+/)[1];
          if (!lastYaml) {
            console.log(chalk.yellow("No YAML generated yet. Chat a bit first.\n"));
          } else if (!path) {
            console.log(chalk.yellow("Usage: /save <path>\n"));
          } else {
            // Validate YAML before saving
            try {
              const { parseYaml, expandFragments } = await import("./parser");
              const docs = parseYaml(lastYaml);
              expandFragments(docs[0]);
              const { writeFileSync } = await import("fs");
              writeFileSync(path, lastYaml);
              console.log(chalk.green(`✅ Valid YAML — saved to ${path}\n`));
            } catch (err: any) {
              console.log(chalk.red(`❌ Invalid YAML: ${err.message}`));
              console.log(chalk.yellow("  The generated YAML has errors. Keep chatting to refine it, or /save anyway with /force.\n"));
            }
          }
          ask();
          return;
        }

        if (trimmed.startsWith("/force")) {
          const path = trimmed.split(/\s+/)[1];
          if (!lastYaml) {
            console.log(chalk.yellow("No YAML generated yet.\n"));
          } else if (path) {
            const { writeFileSync } = await import("fs");
            writeFileSync(path, lastYaml);
            console.log(chalk.yellow(`⚠️  Saved without validation to ${path}\n`));
          }
          ask();
          return;
        }

        messages.push({ role: "user", content: trimmed });

        try {
          const stop = spinner(true);
          const response = await chat(messages, { apiKey, model, baseUrl });
          stop?.();
          console.log(chalk.blue("Assistant: "));
          console.log(response);
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
              console.log(chalk.dim("  ✅ Valid YAML extracted. Use /save <path> to write it.\n"));
            } catch (err: any) {
              lastYaml = yaml; // still save it so user can /force
              console.log(chalk.yellow(`  ⚠️  YAML extracted but has issues: ${err.message}`));
              console.log(chalk.dim("  Use /save <path> to try anyway, or keep chatting to fix.\n"));
            }
          }
        } catch (err: any) {
          console.error(chalk.red(`\nError: ${err.message}\n`));
        }

        ask();
      });
    };

    ask();
  });

// ── Entry ──

program.parse();
