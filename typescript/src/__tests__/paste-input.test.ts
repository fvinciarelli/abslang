/**
 * PasteAwareInput must mirror python/tests/test_paste_input.py.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { PasteAwareInput, PASTE_START, PASTE_END } from "../paste-input";

function feedLines(lines: string[]): Array<string | null> {
  const collector = new PasteAwareInput();
  return lines.map((line) => collector.feed(line));
}

describe("PasteAwareInput", () => {
  it("passes typed lines through", () => {
    const collector = new PasteAwareInput();
    assert.equal(collector.feed("hola"), "hola");
    assert.equal(collector.feed(""), "");
    assert.equal(collector.feed("otra línea"), "otra línea");
  });

  it("merges a single-line paste", () => {
    assert.deepEqual(feedLines([`${PASTE_START}hola${PASTE_END}`]), ["hola"]);
  });

  it("merges a multi-line paste without a trailing newline", () => {
    assert.deepEqual(feedLines([`${PASTE_START}a`, "b", `c${PASTE_END}`]), [null, null, "a\nb\nc"]);
  });

  it("waits for Enter when the paste ends with a trailing newline", () => {
    assert.deepEqual(feedLines([`${PASTE_START}a`, "b", PASTE_END, ""]), [null, null, null, "a\nb"]);
  });

  it("keeps text typed around the paste", () => {
    assert.deepEqual(feedLines([`pre${PASTE_START}a${PASTE_END}`]), ["prea"]);
    assert.deepEqual(feedLines([`${PASTE_START}a${PASTE_END}post`]), ["apost"]);
    assert.deepEqual(feedLines([`pre${PASTE_START}a`, `b${PASTE_END}post`]), [null, "prea\nbpost"]);
  });

  it("appends text typed after a trailing-newline paste on the Enter", () => {
    assert.deepEqual(feedLines([`${PASTE_START}a`, `${PASTE_END}x`]), [null, "a\nx"]);
  });

  it("handles an empty paste", () => {
    assert.deepEqual(feedLines([`${PASTE_START}${PASTE_END}`]), [null]);
    // the Enter that follows submits an empty message (ignored by the loop)
    assert.deepEqual(feedLines([`${PASTE_START}${PASTE_END}`, ""]), [null, ""]);
  });

  it("handles two pastes before one Enter", () => {
    assert.deepEqual(feedLines([`${PASTE_START}a${PASTE_END} ${PASTE_START}b${PASTE_END}`]), ["a b"]);
  });

  it("handles a paste followed by another paste before the Enter", () => {
    assert.deepEqual(feedLines([`${PASTE_START}a`, `${PASTE_END}${PASTE_START}b${PASTE_END}`]), [null, "a\nb"]);
  });

  it("normalizes CRLF line endings inside a paste", () => {
    assert.deepEqual(feedLines([`${PASTE_START}a\r`, `b${PASTE_END}\r`]), [null, "a\nb"]);
  });

  it("resets after a submitted message", () => {
    const collector = new PasteAwareInput();
    assert.equal(collector.feed(`${PASTE_START}hola${PASTE_END}`), "hola");
    assert.equal(collector.feed("segunda línea"), "segunda línea");
  });
});
