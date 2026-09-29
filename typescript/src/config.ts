import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import * as yaml from "js-yaml";

export interface ABSConfig {
  agent?: {
    url?: string;
    format?: string;
    auth?: string;
    token?: string;
    model?: string;
    forward_auth?: boolean;
    authorization?: string;
    refresh_url?: string;
    refresh_token?: string;
    client_id?: string;
  };
  adapters?: Record<string, string>;
  judge?: {
    base_url?: string;
    api_key?: string;
    api_key_header?: string;
    model?: string;
  };
  defaults?: {
    dataset?: string;
    filter?: string;
    timeout?: number;
    parallel?: number;
    output?: string;
    vars?: Record<string, any>;
  };
  run?: {
    format?: string;
    ci?: boolean;
  };
  logging?: {
    format?: string;
    level?: string;
    file?: string;
    no_content?: boolean;
  };
  report?: {
    format?: string;
    failed?: boolean;
    detail?: number;
  };
}

// section -> allowed keys. null = free-form mapping (adapters).
const KNOWN_KEYS: Record<string, string[] | null> = {
  agent: [
    "url", "format", "auth", "token", "model", "forward_auth",
    "authorization", "refresh_url", "refresh_token", "client_id",
  ],
  adapters: null,
  judge: ["base_url", "api_key", "api_key_header", "model"],
  defaults: ["dataset", "filter", "timeout", "parallel", "output", "vars"],
  run: ["format", "ci"],
  logging: ["format", "level", "file", "no_content"],
  report: ["format", "failed", "detail"],
};

export function loadConfig(path: string): ABSConfig {
  if (!existsSync(path)) {
    throw new Error(`config file not found: ${path}`);
  }
  let data: any;
  try {
    data = yaml.load(readFileSync(path, "utf-8")) ?? {};
  } catch (err: any) {
    throw new Error(`invalid config file ${path}: ${err.message}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`config file ${path} must contain a mapping at the top level`);
  }
  return data as ABSConfig;
}

export function findConfig(): ABSConfig | null {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const configPath = join(dir, "abs.config.yaml");
    if (existsSync(configPath)) {
      return loadConfig(configPath);
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Effective config: explicit --config-file or discovered abs.config.yaml. */
export function loadCliConfig(explicitPath?: string): ABSConfig {
  if (explicitPath) return loadConfig(explicitPath);
  return findConfig() ?? {};
}

/** Typo protection: unknown sections/keys are reported (and ignored). */
export function validateConfig(config: ABSConfig): string[] {
  const warnings: string[] = [];
  for (const [section, value] of Object.entries(config)) {
    const known = KNOWN_KEYS[section];
    if (known === undefined) {
      warnings.push(`unknown section '${section}' in config (ignored)`);
      continue;
    }
    if (known === null) continue; // free-form (adapters)
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      warnings.push(`section '${section}' must be a mapping (ignored)`);
      continue;
    }
    for (const key of Object.keys(value as object)) {
      if (!known.includes(key)) {
        warnings.push(`unknown key '${section}.${key}' in config (ignored)`);
      }
    }
  }
  return warnings;
}

export function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/** Precedence for string options: CLI > env var > config file > fallback. */
export function pickValue(
  cli: string | undefined,
  env: string | undefined,
  file: string | undefined,
  fallback: string | undefined
): string | undefined {
  if (cli !== undefined && cli !== "") return cli;
  if (env !== undefined && env !== "") return env;
  return file !== undefined && file !== "" ? file : fallback;
}

/** Precedence for booleans: CLI > env var > config file > fallback. */
export function pickFlag(
  cli: boolean | undefined,
  env: string | undefined,
  file: boolean | undefined,
  fallback: boolean
): boolean {
  if (cli !== undefined) return cli;
  if (env !== undefined && env !== "") return isTruthy(env);
  return file !== undefined ? file : fallback;
}
