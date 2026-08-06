import Ajv, { ValidateFunction } from "ajv";

// Normative JSON Schema for v0.1 — embedded so the npm package is self-contained.
// When updating the schema, update this constant from schema/abs.schema.json.
const SCHEMA_V01 = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://github.com/fvinciarelli/abslang/blob/main/schema/abs.schema.json",
  "title": "ABS Document v0.1",
  "description": "Normative JSON Schema for Agent Behavior Specification v0.1 documents.",
  "type": "object",
  "required": ["session", "behaviors"],
  "properties": {
    "session": { "type": "string" },
    "description": { "type": "string" },
    "abs_version": { "type": "string", "pattern": "^0\\.1$" },
    "dataset": {
      "type": "object",
      "required": ["id", "path"],
      "properties": {
        "id": { "type": "string" },
        "path": { "type": "string" }
      },
      "additionalProperties": false
    },
    "behaviors": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/definitions/behaviorOrInclude" }
    },
    "fragments": {
      "type": "object",
      "additionalProperties": { "$ref": "#/definitions/behaviorList" }
    },
    "evaluations": {
      "type": "array",
      "items": { "$ref": "#/definitions/evaluation" }
    }
  },
  "additionalProperties": false,
  "definitions": {
    "behaviorList": {
      "type": "array",
      "items": { "$ref": "#/definitions/behavior" },
      "minItems": 1
    },
    "behaviorOrInclude": {
      "oneOf": [
        { "$ref": "#/definitions/behavior" },
        { "$ref": "#/definitions/include" }
      ]
    },
    "include": {
      "type": "object",
      "required": ["include"],
      "properties": { "include": { "type": "string" } },
      "additionalProperties": false
    },
    "behavior": {
      "type": "object",
      "required": ["actor", "action"],
      "properties": {
        "id": { "type": "string" },
        "actor": { "type": "string" },
        "action": { "type": "string" },
        "target": { "type": "string" },
        "content": {},
        "capture": { "type": "object", "minProperties": 1 },
        "with": { "type": "object", "minProperties": 1 },
        "with_only": { "type": "object", "minProperties": 1 },
        "evaluations": {
          "type": "array",
          "items": { "$ref": "#/definitions/evaluation" }
        }
      },
      "additionalProperties": false,
      "allOf": [{ "not": { "required": ["with", "with_only"] } }]
    },
    "evaluation": {
      "type": "object",
      "required": ["type"],
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "exact_match", "contains", "regex", "schema", "tool_call",
            "llm_judge", "custom",
            "Groundedness", "Relevance", "Coherence", "Fluency",
            "sequence", "eventually", "never", "count", "within", "variable_consistency",
            "all_of", "any_of", "none_of"
          ]
        },
        "blocking": { "type": "boolean" },
        "threshold": { "type": "number", "minimum": 0, "maximum": 1 },
        "adapter": { "type": "string" },
        "dataset": {},
        "prompt": { "type": "string" },
        "query": { "type": "string" },
        "context": { "type": "string" },
        "response": { "type": "string" },
        "criteria": { "type": "string" },
        "value": {},
        "pattern": { "type": "string" },
        "schema": { "type": "object" },
        "target": { "type": "string" },
        "with": { "type": "object" },
        "ordered": { "type": "boolean" },
        "id": { "type": "string" },
        "match": { "$ref": "#/definitions/selector" },
        "order": { "type": "array", "items": { "$ref": "#/definitions/selector" } },
        "variable": { "type": "string" },
        "min": { "type": "integer" },
        "max": { "type": "integer" },
        "after": { "$ref": "#/definitions/selector" },
        "max_steps": { "type": "integer" },
        "evaluations": { "type": "array", "items": { "$ref": "#/definitions/evaluation" } }
      },
      "additionalProperties": true
    },
    "selector": {
      "type": "object",
      "properties": {
        "actor": { "type": "string" },
        "action": { "type": "string" },
        "target": { "type": "string" }
      },
      "minProperties": 1,
      "additionalProperties": false
    }
  }
};

let _validate: ValidateFunction | null = null;

export function getValidator(): ValidateFunction {
  if (_validate) return _validate;
  const ajv = new Ajv({ allErrors: true, strict: false });
  _validate = ajv.compile(SCHEMA_V01);
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
