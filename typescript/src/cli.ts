#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import chalk from "chalk";
import {
  parse,
  parseMulti,
  loadDataset,
  NormalizedSession,
  resolveVariables,
} from "./parser";
import { run, AgentConfig, RunResult } from "./runner";
import {
  configureAIEvaluator,
  getAIEvaluatorConfig,
} from "./evaluators/adapters/aievaluator";
import { formatTable, formatJson, formatJunit } from "./formatters/table";

const program = new Command();

program
  .name("abs")
  .description("ABS — Agent Behavior Specification CLI")
  .version("0.1.0");

// ── init ──

const SMOKE_SESSION = `session: Order status
description: User asks about an order. Happy path.
behaviors:
  - actor: user
    action: says
    content: "Where is my order {{orderId}}?"

  - actor: assistant
    action: asks
    content: "Please provide your order number"

  - actor: user
    action: says
    content: "{{orderId}}"
    capture:
      orderId: "{{orderId}}"

  - actor: assistant
    action: calls
    target: Order MCP
    with:
      orderId: "{{orderId}}"

  - actor: assistant
    action: informs
    content: "{{expectedResponse}}"
    evaluations:
      - type: contains
        value: "{{expectedKeyword}}"
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

    // 3. datasets/
    const datasetsDir = join(cwd, "datasets");
    if (!existsSync(datasetsDir)) {
      mkdirSync(datasetsDir);
    }
    const datasetPath = join(datasetsDir, "order-status.jsonl");
    if (!existsSync(datasetPath)) {
      writeFileSync(
        datasetPath,
        SMOKE_DATASET.map((r) => JSON.stringify(r)).join("\n") + "\n"
      );
      console.log(chalk.green("✅ Created datasets/order-status.jsonl (3 rows)"));
    } else {
      console.log("⏭️  datasets/order-status.jsonl already exists, skipping");
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
  .option("--adapter <binding>", "Evaluator adapter binding", collectAdapter, {} as Record<string, string>)
  .option("--format <format>", "table, json, or junit", "table")
  .option("--ci", "CI mode (no colors, no prompts)", false)
  .option("--output <path>", "Write report to file")
  .option("--parallel <n>", "Run N dataset rows in parallel", "1")
  .action(async (session, options) => {
    const sessionPath = session || options.session;
    if (!sessionPath) {
      console.error(chalk.red("❌ Provide a session path."));
      process.exit(2);
    }

    const agentUrl = options.agent || process.env.ABS_AGENT_URL;
    if (!agentUrl) {
      console.error(chalk.red("❌ Provide --agent or set ABS_AGENT_URL."));
      process.exit(2);
    }

    // Configure AI Evaluator
    if (options.adapter) {
      for (const [type, provider] of Object.entries(options.adapter)) {
        if (provider === "aievaluator") {
          configureAIEvaluator({
            apiKey: process.env.AIEVALUATOR_API_KEY,
            engineUrl: process.env.AIEVALUATOR_ENGINE_URL,
          });
        }
      }
    }

    const agentConfig: AgentConfig = {
      url: agentUrl,
      format: options.agentFormat,
      auth: options.agentAuth,
      token: options.agentToken || process.env.ABS_AGENT_TOKEN,
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

    // Load dataset if provided
    let dataset: Record<string, any>[] | null = null;
    if (options.dataset) {
      try {
        dataset = loadDataset(options.dataset);
      } catch (err: any) {
        console.error(chalk.red(`❌ Cannot load dataset: ${err.message}`));
        process.exit(2);
      }

      // Apply filter
      if (options.filter) {
        const [fk, fv] = options.filter.split(":");
        dataset = dataset.filter((row) => String(row[fk]) === fv);
      }
    }

    // Run
    const allResults: (RunResult & { rowVars?: Record<string, any> })[] = [];

    if (dataset) {
      // Run once per dataset row
      for (const row of dataset) {
        const vars = { ...runtimeVars, ...row };
        for (const session of sessions) {
          const resolved = {
            ...session,
            behaviors: resolveVariables(
              JSON.parse(JSON.stringify(session.behaviors)),
              vars
            ),
          };
          const result = await run(resolved, agentConfig);
          (result as any).rowVars = row;
          allResults.push(result);
        }
      }
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
        lines.push(`│  Agent:    ${agentUrl.padEnd(52)}│`);
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

    if (options.format === "json") {
      console.log(JSON.stringify(data, null, 2));
    } else if (options.format === "junit") {
      console.log(formatJunit(data));
    } else {
      // Table format — reconstruct RunResult
      const result: RunResult = {
        session: data.session ?? data.results?.[0]?.session ?? "",
        agent: data.agent ?? "",
        passed: data.passed,
        steps: data.trace ?? [],
        chainEvaluations: data.chain_evaluations ?? [],
        stepsTotal: data.steps_total ?? 0,
        stepsMatched: data.steps_matched ?? 0,
        evaluationsTotal: data.evaluations_total ?? 0,
        evaluationsPassed: data.evaluations_passed ?? 0,
      };
      console.log(formatTable(result));
    }
  });

// ── login ──

program
  .command("login")
  .description("Log in to AI Evaluator for LLM-as-judge")
  .option("--api-key <key>", "AI Evaluator API key")
  .action(async (options) => {
    let apiKey = options.apiKey || process.env.AIEVALUATOR_API_KEY;
    if (!apiKey) {
      console.log("Enter your AI Evaluator API key:");
      console.log("(Get one at https://aievaluator.dev/settings)");
      // Simple prompt (no readline needed for MVP)
      process.stdout.write("API key: ");
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
        break;
      }
      apiKey = Buffer.concat(chunks).toString().trim();
    }

    if (!apiKey) {
      console.error(chalk.red("❌ API key cannot be empty."));
      process.exit(2);
    }

    configureAIEvaluator({ apiKey });
    console.log(chalk.green("✅ Logged in to AI Evaluator"));
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

// ── Entry ──

program.parse();
