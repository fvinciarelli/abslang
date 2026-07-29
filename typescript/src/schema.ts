import { readFileSync } from "fs";
import Ajv, { ValidateFunction } from "ajv";

// Embedded schema for v0.1 — loaded at runtime from the package
let _validate: ValidateFunction | null = null;

export function getValidator(): ValidateFunction {
  if (_validate) return _validate;
  const ajv = new Ajv({ allErrors: true, strict: false });
  const schemaPath = require.resolve("../../schema/abs.schema.json");
  // For CLI usage, load relative to the abs project root
  let schema: any;
  try {
    schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
  } catch {
    // Fallback: try relative to cwd
    schema = JSON.parse(readFileSync("schema/abs.schema.json", "utf-8"));
  }
  _validate = ajv.compile(schema);
  return _validate;
}

export function validateDocument(doc: any): { valid: boolean; errors: string[] } {
  const validate = getValidator();
  const valid = validate(doc) as boolean;
  const errors = valid
    ? []
    : (validate.errors ?? []).map(
        (e) => `${e.instancePath} ${e.message}`
      );
  return { valid, errors };
}
