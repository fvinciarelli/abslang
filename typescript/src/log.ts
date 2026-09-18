/**
 * Structured event logging for abslang runs.
 *
 * The final report always goes to stdout. Progress and events go to stderr —
 * and optionally to a JSONL file — so pipelines like
 * `abslang run --format json > report.json` stay clean.
 *
 * Event schema (v1):
 *   {"v":1,"ts":"2026-01-01T00:00:00.000Z","level":"info",
 *    "event":"evaluation.result","run_id":"r_ab12cd34ef56", ...}
 *
 * Keep keys snake_case and stable: both implementations (Python and
 * TypeScript) emit the same schema. The catalog is documented in CLI.md.
 */

import { appendFileSync, writeFileSync } from "fs";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<string, number> = { debug: 10, info: 20, warn: 30, warning: 30, error: 40 };
const ICONS: Record<string, string> = { debug: "·", info: "→", warn: "⚠", error: "✖" };
const ENVELOPE_KEYS = new Set(["v", "ts", "level", "event", "run_id"]);

interface LogConfig {
  enabled: boolean;
  level: number;
  format: "pretty" | "jsonl";
  file: string | null;
  includeContent: boolean;
  meta: Record<string, any>;
}

let config: LogConfig = {
  enabled: false,
  level: LEVELS.info,
  format: "pretty",
  file: null,
  includeContent: true,
  meta: {},
};

/** Configure console/file logging. Called once by the CLI. */
export function configureLogging(
  options: {
    level?: string;
    format?: string;
    file?: string;
    includeContent?: boolean;
    enabled?: boolean;
    meta?: Record<string, any>;
  } = {}
): void {
  closeLogging();
  if (options.file) {
    // Truncate up-front so every run starts with a fresh file.
    writeFileSync(options.file, "");
  }
  config = {
    enabled: options.enabled ?? true,
    level: LEVELS[(options.level ?? "info").toLowerCase()] ?? LEVELS.info,
    format: options.format === "jsonl" ? "jsonl" : "pretty",
    file: options.file ?? null,
    includeContent: options.includeContent ?? true,
    meta: { ...(options.meta ?? {}) },
  };
}

/** Flush and close the log file, then reset the configuration. */
export function closeLogging(): void {
  config = {
    enabled: false,
    level: LEVELS.info,
    format: "pretty",
    file: null,
    includeContent: true,
    meta: {},
  };
}

export function loggingEnabled(): boolean {
  return config.enabled;
}

/** Whether trace content and reasons may be written to logs. */
export function contentEnabled(): boolean {
  return config.includeContent;
}

export function newRunId(): string {
  return `r_${Math.random().toString(16).slice(2, 14)}`;
}

/** Logger bound to one run (session + optional dataset row). */
export class RunLogger {
  readonly runId: string;
  private context: Record<string, any>;
  private startedAt: number;

  constructor(options: { runId?: string; [key: string]: any } = {}) {
    const { runId, ...context } = options;
    this.runId = runId ?? newRunId();
    this.context = Object.fromEntries(
      Object.entries(context).filter(([, value]) => value !== undefined && value !== null)
    );
    this.startedAt = Date.now();
  }

  contentEnabled(): boolean {
    return config.includeContent;
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  event(event: string, level: LogLevel = "info", fields: Record<string, any> = {}): void {
    if (!config.enabled) return;
    if ((LEVELS[level] ?? LEVELS.info) < config.level) return;

    const record: Record<string, any> = {
      v: 1,
      ts: new Date().toISOString(),
      level,
      event,
      run_id: this.runId,
      ...config.meta,
      ...this.context,
      ...Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined && value !== null)
      ),
    };

    const line = JSON.stringify(record);
    if (config.file) appendFileSync(config.file, line + "\n");
    if (config.format === "jsonl") process.stderr.write(line + "\n");
    else process.stderr.write(prettyLine(record, new Set(Object.keys(config.meta))) + "\n");
  }
}

function prettyLine(record: Record<string, any>, skip: Set<string>): string {
  const icon = ICONS[record.level] ?? "·";
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(record)) {
    if (ENVELOPE_KEYS.has(key) || skip.has(key)) continue;
    let value = raw;
    if (typeof value === "object") value = JSON.stringify(value);
    let text = String(value);
    if (text.length > 80) text = text.slice(0, 77) + "...";
    parts.push(`${key}=${text}`);
  }
  return `${icon} ${record.event}${parts.length ? " " + parts.join(" ") : ""}`;
}
