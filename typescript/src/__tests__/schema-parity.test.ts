/// <reference types="node" />

/**
 * The npm package embeds the normative JSON schema in src/schema.ts so it is
 * self-contained. This test fails if the embedded copy drifts from
 * schema/abs.schema.json — update both together when the schema changes.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SCHEMA_V01 } from "../schema";

describe("embedded JSON schema parity", () => {
  it("src/schema.ts matches schema/abs.schema.json", () => {
    const onDisk = JSON.parse(
      readFileSync(resolve(__dirname, "../../../schema/abs.schema.json"), "utf-8")
    );
    assert.deepEqual(SCHEMA_V01, onDisk);
  });
});
