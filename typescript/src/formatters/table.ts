import { RunResult } from "../runner";
import chalk from "chalk";

export function formatTable(
  result: RunResult,
  rowsTotal?: number,
  rowsPassed?: number,
  rowVars?: Record<string, any>
): string {
  const lines: string[] = [];

  lines.push("┌──────────────────────────────────────────────────────────────┐");
  lines.push("│  ABS — Results                                               │");
  lines.push("├──────────────────────────────────────────────────────────────┤");
  lines.push(`│  Session:  ${result.session.padEnd(52)}│`);
  lines.push(`│  Agent:    ${result.agent.padEnd(52)}│`);

  if (rowsTotal !== undefined) {
    lines.push(
      `│  Dataset:  ${String(rowsTotal).padEnd(52)} rows│`
    );
  }

  const status = result.passed ? chalk.green("✅ PASSED") : chalk.red("❌ FAILED");
  lines.push(`│  Result:   ${status.padEnd(62)}│`);

  if (rowsTotal !== undefined && rowsPassed !== undefined) {
    lines.push(
      `│  Rows:     ${String(rowsPassed)}/${String(rowsTotal)} passed · ${String(rowsTotal - rowsPassed)} failed`.padEnd(64) + "│"
    );
  }

  lines.push(
    `│  Steps:    ${result.stepsMatched}/${result.stepsTotal} matched · ${result.evaluationsPassed}/${result.evaluationsTotal} evaluations passed`.padEnd(64) + "│"
  );

  lines.push("├────┬────────────────────────────────────┬──────────┬─────────┤");
  lines.push("│  # │ Step                               │ Result   │         │");
  lines.push("├────┼────────────────────────────────────┼──────────┼─────────┤");

  for (const step of result.steps) {
    const num = String(step.step).padStart(2);
    const desc = stepDescription(step).substring(0, 34).padEnd(34);

    if (step.sent) {
      lines.push(`│ ${num} │ ${desc} │    →     │   sent  │`);
    } else if (step.matched) {
      lines.push(`│ ${num} │ ${desc} │    ✅    │  match  │`);
    } else {
      lines.push(`│ ${num} │ ${desc} │    ❌    │  no match│`);
    }

    for (const ev of step.evaluations) {
      const evDesc = ev.type.substring(0, 28).padEnd(28);
      const evStatus = ev.inconclusive
        ? "   ⚠️    │  incon  │"
        : ev.passed ? "   ✅    │   pass  │" : "   ❌    │  FAIL  │";
      lines.push(`│    │   └─ ${evDesc} │ ${evStatus}`);
    }
  }

  // Chain evaluations
  for (const ev of result.chainEvaluations) {
    const desc = `chain: ${ev.type}`.substring(0, 34).padEnd(34);
    const status = ev.inconclusive
      ? "   ⚠️    │  incon  │"
      : ev.passed ? "   ✅    │   pass  │" : "   ❌    │  FAIL  │";
    lines.push(`│  C │ ${desc} │ ${status}`);
  }

  lines.push("└────┴────────────────────────────────────┴──────────┴─────────┘");

  if (!result.passed) {
    lines.push("");
    lines.push(chalk.red("❌ Some evaluations failed:"));
    for (const step of result.steps) {
      for (const ev of step.evaluations) {
        if (!ev.passed && !ev.inconclusive) {
          lines.push(chalk.red(`  Step ${step.step} — ${ev.type}: ${ev.reason}`));
        }
      }
    }
    for (const ev of result.chainEvaluations) {
      if (!ev.passed && !ev.inconclusive) {
        lines.push(chalk.red(`  Chain — ${ev.type}: ${ev.reason}`));
      }
    }
  }

  const inconclusive = [
    ...result.steps.flatMap((s) => s.evaluations),
    ...result.chainEvaluations,
  ].filter((e) => e.inconclusive).length;
  if (inconclusive > 0) {
    lines.push("");
    lines.push(chalk.yellow(`⚠️  ${inconclusive} evaluation(s) marked inconclusive (downstream of a blocking failure).`));
  }

  return lines.join("\n");
}

function stepDescription(step: any): string {
  const b = step.behavior;
  const content =
    typeof b.content === "string"
      ? b.content
      : b.content
        ? JSON.stringify(b.content)
        : "";
  return `${b.actor} ${b.action}${b.target ? " " + b.target : ""} "${content.substring(0, 20)}"`;
}

export function formatJson(result: RunResult): string {
  return JSON.stringify(
    {
      session: result.session,
      agent: result.agent,
      passed: result.passed,
      steps_total: result.stepsTotal,
      steps_matched: result.stepsMatched,
      evaluations_total: result.evaluationsTotal,
      evaluations_passed: result.evaluationsPassed,
      trace: result.steps.map((s) => ({
        step: s.step,
        behavior: {
          actor: s.behavior.actor,
          action: s.behavior.action,
          target: s.behavior.target,
          content: s.behavior.content,
        },
        matched: s.matched,
        sent: s.sent,
        observed: s.observed,
        evaluations: s.evaluations,
      })),
      chain_evaluations: result.chainEvaluations,
    },
    null,
    2
  );
}

export function formatJunit(result: RunResult): string {
  const allEvals = [
    ...result.steps.flatMap((s) =>
      s.evaluations.map((e) => ({ ...e, step: s.step, isChain: false }))
    ),
    ...result.chainEvaluations.map((e) => ({ ...e, isChain: true })),
  ];

  const failures = allEvals.filter((e) => !e.passed).length;
  const total = allEvals.length;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<testsuite name="ABS: ${escapeXml(result.session)}" tests="${total}" failures="${failures}" errors="0">\n`;

  let caseNum = 0;
  for (const step of result.steps) {
    for (const ev of step.evaluations) {
      caseNum++;
      xml += `  <testcase classname="ABS" name="Step ${step.step}: ${escapeXml(ev.type)}" time="0">\n`;
      if (ev.inconclusive) {
        xml += `    <skipped message="${escapeXml(ev.reason)}" />\n`;
      } else if (!ev.passed) {
        xml += `    <failure message="${escapeXml(ev.reason)}">\n`;
        xml += `      Type: ${escapeXml(ev.type)}\n`;
        xml += `      Reason: ${escapeXml(ev.reason)}\n`;
        xml += `    </failure>\n`;
      }
      xml += `  </testcase>\n`;
    }
  }

  for (const ev of result.chainEvaluations) {
    caseNum++;
    xml += `  <testcase classname="ABS" name="Chain: ${escapeXml(ev.type)}" time="0">\n`;
    if (ev.inconclusive) {
      xml += `    <skipped message="${escapeXml(ev.reason)}" />\n`;
    } else if (!ev.passed) {
      xml += `    <failure message="${escapeXml(ev.reason)}">\n`;
      xml += `      Type: ${escapeXml(ev.type)}\n`;
      xml += `      Reason: ${escapeXml(ev.reason)}\n`;
      xml += `    </failure>\n`;
    }
    xml += `  </testcase>\n`;
  }

  xml += `</testsuite>\n`;
  return xml;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
