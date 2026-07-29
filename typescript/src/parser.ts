import * as yaml from "js-yaml";
import { readFileSync, existsSync } from "fs";
import { validateDocument } from "./schema";

// ── Types ──

export interface Behavior {
  actor: string;
  action: string;
  target?: string;
  content?: any;
  capture?: Record<string, any>;
  with?: Record<string, any>;
  with_only?: Record<string, any>;
  evaluations?: Evaluation[];
}

export interface Evaluation {
  type: string;
  [key: string]: any;
}

export interface Selector {
  actor?: string;
  action?: string;
  target?: string;
}

export interface ABSDocument {
  session: string;
  description?: string;
  abs_version?: string;
  behaviors: (Behavior | { include: string })[];
  fragments?: Record<string, Behavior[]>;
  evaluations?: Evaluation[];
}

export interface NormalizedSession {
  session: string;
  description?: string;
  abs_version?: string;
  behaviors: Behavior[];
  evaluations?: Evaluation[];
}

// ── YAML parsing ──

export function parseYamlFile(path: string): ABSDocument[] {
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }
  const raw = readFileSync(path, "utf-8");
  return parseYaml(raw);
}

export function parseYaml(raw: string): ABSDocument[] {
  // Support multiple documents separated by ---
  const docs = raw
    .split(/^---$/m)
    .map((d) => d.trim())
    .filter(Boolean);

  return docs.map((doc) => {
    const parsed = yaml.load(doc) as any;
    return parsed;
  });
}

// ── Fragment expansion ──

export function expandFragments(doc: ABSDocument): NormalizedSession {
  const fragments = doc.fragments ?? {};

  function expand(behaviors: (Behavior | { include: string })[]): Behavior[] {
    const result: Behavior[] = [];
    for (const entry of behaviors) {
      if ("include" in entry) {
        const fragName = (entry as { include: string }).include;
        const fragment = fragments[fragName];
        if (!fragment) {
          throw new Error(
            `Fragment "${fragName}" not found. Available: ${Object.keys(fragments).join(", ")}`
          );
        }
        result.push(...fragment);
      } else {
        result.push(entry as Behavior);
      }
    }
    return result;
  }

  return {
    session: doc.session,
    description: doc.description,
    abs_version: doc.abs_version,
    behaviors: expand(doc.behaviors),
    evaluations: doc.evaluations,
  };
}

// ── Variable resolution ──

export function resolveVariables(
  behaviors: Behavior[],
  runtimeBindings: Record<string, any> = {}
): Behavior[] {
  const variables: Record<string, any> = { ...runtimeBindings };

  return behaviors.map((b) => {
    // Resolve {{var}} references in content
    const resolved = { ...b };

    if (typeof b.content === "string") {
      resolved.content = resolveString(b.content, variables);
    } else if (typeof b.content === "object" && b.content !== null) {
      resolved.content = resolveObject(b.content, variables);
    }

    if (b.with) {
      resolved.with = resolveObject(b.with, variables) as Record<string, any>;
    }

    if (b.with_only) {
      resolved.with_only = resolveObject(
        b.with_only,
        variables
      ) as Record<string, any>;
    }

    // Apply captures after resolution
    if (b.capture) {
      for (const [key, value] of Object.entries(b.capture)) {
        variables[key] = typeof value === "string" ? resolveString(value, variables) : value;
      }
    }

    return resolved;
  });
}

function resolveString(
  value: string,
  vars: Record<string, any>
): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (name in vars) {
      return String(vars[name]);
    }
    throw new Error(
      `Variable "{{${name}}}" has no binding. Ensure it is captured earlier in the session or provided at runtime (--var, --dataset, env).`
    );
  });
}

function resolveObject(
  obj: any,
  vars: Record<string, any>
): any {
  if (typeof obj === "string") return resolveString(obj, vars);
  if (Array.isArray(obj)) return obj.map((v) => resolveObject(v, vars));
  if (typeof obj === "object" && obj !== null) {
    const resolved: any = {};
    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = resolveObject(value, vars);
    }
    return resolved;
  }
  return obj;
}

// ── Full parse pipeline ──

export function parse(
  pathOrRaw: string,
  runtimeBindings: Record<string, any> = {}
): NormalizedSession {
  const isYaml =
    pathOrRaw.includes("---") ||
    pathOrRaw.includes("session:") ||
    pathOrRaw.includes("behaviors:");

  const docs = isYaml
    ? parseYaml(pathOrRaw)
    : parseYamlFile(pathOrRaw);

  if (docs.length > 1) {
    throw new Error(
      "Multiple sessions detected (--- separator). Use parseMulti() to get all sessions."
    );
  }

  const doc = docs[0];
  const { valid, errors } = validateDocument(doc);
  if (!valid) {
    throw new Error(`Invalid ABS document:\n${errors.join("\n")}`);
  }

  const expanded = expandFragments(doc);
  expanded.behaviors = resolveVariables(expanded.behaviors, runtimeBindings);
  return expanded;
}

export function parseMulti(
  pathOrRaw: string,
  runtimeBindings: Record<string, any> = {}
): NormalizedSession[] {
  const isYaml =
    pathOrRaw.includes("---") ||
    pathOrRaw.includes("session:") ||
    pathOrRaw.includes("behaviors:");

  const docs = isYaml
    ? parseYaml(pathOrRaw)
    : parseYamlFile(pathOrRaw);

  return docs.map((doc) => {
    const { valid, errors } = validateDocument(doc);
    if (!valid) {
      throw new Error(`Invalid ABS document:\n${errors.join("\n")}`);
    }
    const expanded = expandFragments(doc);
    expanded.behaviors = resolveVariables(expanded.behaviors, runtimeBindings);
    return expanded;
  });
}

// ── Dataset loading ──

export function loadDataset(path: string): Record<string, any>[] {
  if (!existsSync(path)) {
    throw new Error(`Dataset not found: ${path}`);
  }
  const raw = readFileSync(path, "utf-8");

  if (path.endsWith(".jsonl")) {
    return raw
      .trim()
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  }

  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : [data];
}
