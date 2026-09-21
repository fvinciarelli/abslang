import Ajv, { ValidateFunction } from "ajv";

// Normative JSON Schema for v0.2 — embedded so the npm package is self-contained.
// When updating the schema, update this constant from schema/abs.schema.json.
export const SCHEMA_V01 = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://github.com/fvinciarelli/abs/blob/main/schema/abs.schema.json",
  "title": "ABS Document v0.2",
  "description": "Normative JSON Schema for Agent Behavior Specification v0.2 documents. A document that passes this schema is syntactically valid ABS v0.2. Semantic rules (variable resolution, ordering, target interpretation) are defined in SPECIFICATION.md and are not enforced by this schema.",
  "type": "object",
  "required": [
    "session",
    "behaviors"
  ],
  "properties": {
    "session": {
      "type": "string",
      "description": "Human-readable session name. REQUIRED."
    },
    "description": {
      "type": "string",
      "description": "Optional description of what this session covers."
    },
    "abs_version": {
      "type": "string",
      "description": "Version of the ABS spec this document targets. Optional in v0.1, REQUIRED in v0.2.",
      "pattern": "^0\\.(1|2)$"
    },
    "dataset": {
      "type": "object",
      "description": "Dataset that feeds this session. Each row triggers one execution. Columns are referenced as {{id.column}}.",
      "required": [
        "id",
        "path"
      ],
      "properties": {
        "id": {
          "type": "string",
          "description": "Short name used to reference columns (e.g. {{cases.userQuery}})."
        },
        "path": {
          "type": "string",
          "description": "Path to a .json or .jsonl file relative to the session file."
        }
      },
      "additionalProperties": false
    },
    "behaviors": {
      "type": "array",
      "description": "Ordered list of Behaviors and/or fragment includes. REQUIRED.",
      "minItems": 1,
      "items": {
        "$ref": "#/definitions/behaviorOrInclude"
      }
    },
    "fragments": {
      "type": "object",
      "description": "Named reusable lists of Behaviors. Referenced by include: entries in behaviors.",
      "additionalProperties": {
        "$ref": "#/definitions/behaviorList"
      }
    },
    "evaluations": {
      "type": "array",
      "description": "Session-level (chain) evaluations operating over the whole trace.",
      "items": {
        "$ref": "#/definitions/evaluation"
      }
    }
  },
  "additionalProperties": false,
  "definitions": {
    "behaviorList": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/behavior"
      },
      "minItems": 1
    },
    "behaviorOrInclude": {
      "oneOf": [
        {
          "$ref": "#/definitions/behavior"
        },
        {
          "$ref": "#/definitions/include"
        }
      ]
    },
    "include": {
      "type": "object",
      "required": [
        "include"
      ],
      "properties": {
        "include": {
          "type": "string",
          "description": "Name of a fragment declared in the top-level fragments: map."
        }
      },
      "additionalProperties": false
    },
    "behavior": {
      "type": "object",
      "required": [
        "actor",
        "action"
      ],
      "properties": {
        "id": {
          "type": "string",
          "description": "Unique identifier for this Behavior. Used by evaluations to reference steps via id.action."
        },
        "actor": {
          "type": "string",
          "description": "Who performs this Behavior: user, assistant, tool, system, human, external."
        },
        "action": {
          "type": "string",
          "description": "What is performed. See VOCABULARY.md."
        },
        "target": {
          "type": "string",
          "description": "Object or destination of the action. Meaning depends on the action category — see SPECIFICATION.md §4."
        },
        "content": {
          "description": "Payload of the Behavior: free text, structured data, or displayed information."
        },
        "capture": {
          "type": "object",
          "description": "Names runtime values for later reuse via {{variable}} syntax.",
          "minProperties": 1
        },
        "with": {
          "type": "object",
          "description": "Parameters passed on an outbound Action (typically calls). Partial match by default.",
          "minProperties": 1
        },
        "with_only": {
          "type": "object",
          "description": "Parameters passed on an outbound Action. Strict match — exact keys only.",
          "minProperties": 1
        },
        "evaluations": {
          "type": "array",
          "description": "Step-level evaluations for this Behavior only.",
          "items": {
            "$ref": "#/definitions/evaluation"
          }
        },
        "optional": {
          "type": "boolean",
          "description": "If true, the runner attempts to match this behavior but skips it silently if the agent does not emit it. v0.2+."
        },
        "requires": {
          "type": "string",
          "description": "ID of a behavior that must have matched for this behavior to activate. Typically used with optional behaviors. v0.2+."
        },
        "matches_when": {
          "type": "object",
          "description": "Semantic criterion to decide if this behavior matched the agent's response. Uses llm_judge, contains, or regex instead of relying solely on action. v0.2+.",
          "required": [
            "type"
          ],
          "properties": {
            "type": {
              "type": "string",
              "enum": [
                "llm_judge",
                "contains",
                "regex"
              ]
            },
            "criteria": {
              "type": "string",
              "description": "For llm_judge: natural language description of what to look for."
            },
            "value": {
              "type": "string",
              "description": "For contains: substring to find in the agent's response."
            },
            "pattern": {
              "type": "string",
              "description": "For regex: pattern to match against the agent's response."
            }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false,
      "allOf": [
        {
          "not": {
            "required": [
              "with",
              "with_only"
            ]
          }
        }
      ]
    },
    "evaluation": {
      "type": "object",
      "required": [
        "type"
      ],
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "exact_match",
            "contains",
            "regex",
            "schema",
            "tool_call",
            "llm_judge",
            "custom",
            "f1",
            "bleu",
            "rouge",
            "Groundedness",
            "Relevance",
            "Coherence",
            "Fluency",
            "HateUnfairness",
            "Violence",
            "Sexual",
            "SelfHarm",
            "sequence",
            "eventually",
            "never",
            "count",
            "within",
            "variable_consistency",
            "all_of",
            "any_of",
            "none_of",
            "expected"
          ]
        },
        "blocking": {
          "type": "boolean"
        },
        "threshold": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "adapter": {
          "type": "string"
        },
        "ground_truth": {
          "type": "string",
          "description": "Reference text or trace reference for the reference-based evaluators (f1, bleu, rouge). Resolves like query/context/response; `self` means the declared content of the behavior carrying the evaluation. v0.3+"
        },
        "variant": {
          "type": "string",
          "enum": [
            "rouge1",
            "rouge2",
            "rougeL"
          ],
          "description": "For rouge: n-gram variant. Default: rougeL. v0.3+"
        },
        "metric": {
          "type": "string",
          "enum": [
            "precision",
            "recall",
            "f1"
          ],
          "description": "For rouge: which score to use. Default: f1. v0.3+"
        },
        "behavior": {
          "type": "string",
          "description": "For expected: ID of the optional behavior to check. v0.2+."
        },
        "reason": {
          "type": "string",
          "description": "For expected: human-readable failure message. v0.2+."
        },
        "when": {
          "type": "string",
          "description": "Dataset expression. The evaluation only runs when this evaluates to true. Operators: && || ! (canonical; the word synonyms and/or/not in any case are also accepted), comparisons == != < > <= >= (=== and !== also accepted), booleans true/false in any case, and {{column}} references. Unary negation binds to the immediately following value (use parentheses to negate a comparison). If the expression cannot be evaluated, the evaluation does not run. v0.2+."
        },
        "dataset": {},
        "prompt": {
          "type": "string"
        },
        "query": {
          "type": "string"
        },
        "context": {
          "type": "string"
        },
        "response": {
          "type": "string"
        },
        "criteria": {
          "type": "string"
        },
        "value": {},
        "pattern": {
          "type": "string"
        },
        "schema": {
          "type": "object"
        },
        "target": {
          "type": "string"
        },
        "with": {
          "type": "object"
        },
        "ordered": {
          "type": "boolean"
        },
        "id": {
          "type": "string"
        },
        "match": {
          "$ref": "#/definitions/selector"
        },
        "order": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/selector"
          }
        },
        "variable": {
          "type": "string"
        },
        "min": {
          "type": "integer"
        },
        "max": {
          "type": "integer"
        },
        "after": {
          "$ref": "#/definitions/selector",
          "description": "For expected: the optional behavior must match after this selector. v0.2+."
        },
        "max_steps": {
          "type": "integer"
        },
        "evaluations": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/evaluation"
          }
        }
      },
      "additionalProperties": true
    },
    "selector": {
      "type": "object",
      "description": "Identifies Behaviors in the trace. A field that's present must match exactly; omitted is wildcard.",
      "properties": {
        "actor": {
          "type": "string"
        },
        "action": {
          "type": "string"
        },
        "target": {
          "type": "string"
        }
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
