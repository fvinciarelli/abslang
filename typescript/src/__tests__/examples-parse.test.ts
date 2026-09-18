/// <reference types="node" />

/**
 * Every session under examples/ must parse and validate in the TypeScript
 * implementation. Mirrors python/tests/test_examples_parse.py.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { parseMulti } from "../parser";

const EXAMPLES = resolve(__dirname, "../../../examples");

describe("examples/ parse in TypeScript", () => {
  const files = readdirSync(EXAMPLES).filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"));

  it("finds example sessions", () => {
    assert.ok(files.length > 0, `no example files found in ${EXAMPLES}`);
  });

  for (const file of files) {
    it(file, () => {
      const sessions = parseMulti(readFileSync(resolve(EXAMPLES, file), "utf-8"));
      assert.ok(sessions.length > 0, `${file} produced no sessions`);
      for (const session of sessions) {
        assert.ok(session.session);
        assert.ok(session.behaviors.length > 0);
      }
    });
  }
});
