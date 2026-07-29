import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import * as yaml from "js-yaml";

export interface ABSConfig {
  agent?: {
    url?: string;
    format?: string;
    auth?: string;
    token?: string;
  };
  adapters?: Record<string, string>;
  defaults?: {
    dataset?: string;
    timeout?: number;
  };
}

export function findConfig(): ABSConfig | null {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const configPath = join(dir, "abs.config.yaml");
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8");
      return (yaml.load(raw) as ABSConfig) ?? {};
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function mergeConfig(cliOptions: Record<string, any>): Record<string, any> {
  const config = findConfig() ?? {};
  const agentCfg = config.agent ?? {};
  const defaultsCfg = config.defaults ?? {};

  return {
    agent_url:
      cliOptions.agent_url ||
      process.env.ABS_AGENT_URL ||
      agentCfg.url,
    agent_format: cliOptions.agent_format || agentCfg.format || "openai",
    agent_auth: cliOptions.agent_auth || agentCfg.auth || "none",
    agent_token:
      cliOptions.agent_token ||
      process.env.ABS_AGENT_TOKEN ||
      agentCfg.token,
    adapters: cliOptions.adapters || config.adapters || {},
    timeout: cliOptions.timeout || defaultsCfg.timeout || 300,
    dataset: cliOptions.dataset || defaultsCfg.dataset,
  };
}
