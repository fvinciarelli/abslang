"""Unit tests for ABS parser and evaluators."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from abslang.parser import parse_yaml, expand_fragments, resolve_variables, load_dataset, Behavior
from abslang.evaluators import (
    ObservedStep,
    exact_match, contains, regex_match, schema_eval,
    sequence, eventually, never_eval, count_eval, within,
    matches_selector,
)


passed = 0
failed = 0


def test(name, fn):
    global passed, failed
    try:
        fn()
        passed += 1
        print(f"  ✅ {name}")
    except Exception as e:
        failed += 1
        print(f"  ❌ {name}: {e}")


def assert_true(condition, msg="assertion failed"):
    if not condition:
        raise AssertionError(msg)


def assert_equals(a, b, msg=None):
    if a != b:
        raise AssertionError(msg or f"expected {b!r}, got {a!r}")


# ── Parser tests ──

print("\n📦 Parser")

def test_parse_single():
    yaml = """
session: Test
behaviors:
  - actor: user
    action: says
    content: "Hi"
  - actor: assistant
    action: greets
    content: "Hello"
"""
    docs = parse_yaml(yaml)
    assert_true(len(docs) == 1)
    assert_true(docs[0].session == "Test")
    assert_true(len(docs[0].behaviors) == 2)

test("parse single session", test_parse_single)


def test_parse_multi():
    yaml = """
session: First
behaviors:
  - actor: user
    action: says
    content: "A"
---
session: Second
behaviors:
  - actor: user
    action: says
    content: "B"
"""
    docs = parse_yaml(yaml)
    assert_true(len(docs) == 2)
    assert_true(docs[0].session == "First")
    assert_true(docs[1].session == "Second")

test("parse multi-document (---)", test_parse_multi)


def test_fragment_expansion():
    yaml = """
session: Test
fragments:
  greeting:
    - actor: user
      action: says
      content: "Hi"
behaviors:
  - include: greeting
  - actor: assistant
    action: greets
    content: "Hello"
"""
    docs = parse_yaml(yaml)
    expanded = expand_fragments(docs[0])
    assert_true(len(expanded.behaviors) == 2)
    assert_true(expanded.behaviors[0].actor == "user")
    assert_true(expanded.behaviors[1].actor == "assistant")

test("fragment expansion", test_fragment_expansion)


def test_variable_resolution():
    behaviors = [
        Behavior(actor="user", action="says", content="12345", capture={"orderId": "12345"}),
        Behavior(actor="assistant", action="calls", target="MCP", with_={"orderId": "{{orderId}}"}),
    ]
    resolved = resolve_variables(behaviors)
    assert_equals(resolved[0].content, "12345")
    assert_equals(resolved[1].with_, {"orderId": "12345"})

test("variable resolution", test_variable_resolution)


def test_variable_runtime_binding():
    behaviors = [
        Behavior(actor="user", action="says", content="Order {{orderId}}"),
    ]
    resolved = resolve_variables(behaviors, {"orderId": "99999"})
    assert_equals(resolved[0].content, "Order 99999")

test("variable from runtime binding", test_variable_runtime_binding)


def test_variable_not_found():
    behaviors = [
        Behavior(actor="user", action="says", content="Order {{missing}}"),
    ]
    threw = False
    try:
        resolve_variables(behaviors)
    except ValueError:
        threw = True
    assert_true(threw)

test("variable not found throws", test_variable_not_found)


# ── Evaluator tests ──

print("\n📦 Evaluators")

test("exact_match — pass", lambda: assert_true(exact_match("hello", {"value": "hello"}).passed))
test("exact_match — fail", lambda: assert_true(not exact_match("hello", {"value": "world"}).passed))
test("contains — pass", lambda: assert_true(contains("Your order is on the way", {"value": "on the way"}).passed))
test("contains — fail", lambda: assert_true(not contains("Your order is delayed", {"value": "on the way"}).passed))
test("contains — case insensitive", lambda: assert_true(contains("ON THE WAY", {"value": "on the way"}).passed))
test("regex — pass", lambda: assert_true(regex_match("Order #12345 is shipped", {"pattern": r"^Order #\d+"}).passed))
test("regex — fail", lambda: assert_true(not regex_match("Your order", {"pattern": r"^Order #\d+"}).passed))

test("schema — pass", lambda: assert_true(schema_eval(
    {"status": "shipped"}, {"schema": {"type": "object", "required": ["status"], "properties": {"status": {"type": "string"}}}}
).passed))

test("schema — missing required", lambda: assert_true(not schema_eval(
    {}, {"schema": {"type": "object", "required": ["status"]}}
).passed))

test("schema — additionalProperties false", lambda: assert_true(not schema_eval(
    {"status": "ok", "extra": "nope"},
    {"schema": {"type": "object", "required": ["status"], "properties": {"status": {"type": "string"}}, "additionalProperties": False}}
).passed))

test("schema — enum", lambda: assert_true(not schema_eval(
    {"status": "unknown"},
    {"schema": {"type": "object", "properties": {"status": {"type": "string", "enum": ["shipped", "pending"]}}}}
).passed))

# ── Chain evaluators ──

print("\n📦 Chain evaluators")

trace = [
    ObservedStep(actor="assistant", action="asks", content="Order number?"),
    ObservedStep(actor="user", action="says", content="12345"),
    ObservedStep(actor="assistant", action="calls", target="Order MCP"),
    ObservedStep(actor="assistant", action="informs", content="On the way"),
]

test("sequence — pass", lambda: assert_true(sequence(trace, {
    "order": [
        {"actor": "assistant", "action": "asks"},
        {"actor": "assistant", "action": "calls"},
        {"actor": "assistant", "action": "informs"},
    ]
}).passed))

test("sequence — fail", lambda: assert_true(not sequence(trace, {
    "order": [{"actor": "assistant", "action": "calls"}, {"actor": "assistant", "action": "asks"}]
}).passed))

test("eventually — pass", lambda: assert_true(eventually(trace, {"match": {"action": "calls"}}).passed))
test("eventually — fail", lambda: assert_true(not eventually(trace, {"match": {"action": "hands_off"}}).passed))
test("never — pass", lambda: assert_true(never_eval(trace, {"match": {"action": "hands_off"}}).passed))
test("never — fail", lambda: assert_true(not never_eval(trace, {"match": {"action": "calls"}}).passed))
test("count — pass", lambda: assert_true(count_eval(trace, {"match": {"actor": "assistant"}, "min": 2, "max": 5}).passed))
test("count — fail", lambda: assert_true(not count_eval(trace, {"match": {"action": "hands_off"}, "min": 1}).passed))
test("within — pass", lambda: assert_true(within(trace, {"after": {"action": "asks"}, "match": {"action": "calls"}, "max_steps": 2}).passed))
test("within — fail", lambda: assert_true(not within(trace, {"after": {"action": "asks"}, "match": {"action": "informs"}, "max_steps": 1}).passed))

test("selector with target",
     lambda: (
         assert_true(matches_selector(trace[2], {"actor": "assistant", "action": "calls", "target": "Order MCP"})),
         assert_true(not matches_selector(trace[2], {"actor": "assistant", "action": "calls", "target": "Other"})),
     ))

print(f"\n{passed} passed, {failed} failed")
if failed > 0:
    sys.exit(1)
