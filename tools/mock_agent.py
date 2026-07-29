#!/usr/bin/env python3
"""Mock agent that speaks the OpenAI chat protocol — for testing ABS sessions locally.

Usage:
    python mock_agent.py                    # Default port 8080
    python mock_agent.py --port 9090        # Custom port
    python mock_agent.py --scenario happy   # Predefined scenarios (happy, missing_info, tool_error)

Endpoints:
    POST /chat  — OpenAI-compatible chat completions
    GET /health — Health check
"""

import json
import sys
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Any
from dataclasses import dataclass, field


# ── Scenarios ──

@dataclass
class Scenario:
    """A predefined conversation flow for testing."""
    name: str
    responses: list[dict[str, Any]] = field(default_factory=list)


# Happy path: user has order number, assistant resolves in one turn
HAPPY = Scenario(
    name="happy",
    responses=[
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "Order MCP",
                        "arguments": '{"orderId": "12345"}',
                    },
                }
            ],
        },
        {  # After tool result
            "role": "assistant",
            "content": "Your order is on the way! The package left our warehouse this morning.",
        },
    ],
)

# Missing info: assistant asks for order number first
MISSING_INFO = Scenario(
    name="missing_info",
    responses=[
        {
            "role": "assistant",
            "content": "Please provide your order number so I can look that up for you.",
        },
        {  # After user gives order number
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "Order MCP",
                        "arguments": '{"orderId": "12345"}',
                    },
                }
            ],
        },
        {  # After tool result
            "role": "assistant",
            "content": "Your order #12345 is on the way! It should arrive by Friday.",
        },
    ],
)

# Chatbot: simple greeting
CHATBOT = Scenario(
    name="chatbot",
    responses=[
        {
            "role": "assistant",
            "content": "Hello! How can I help you today? Feel free to ask me anything.",
        },
    ],
)

# Appointment: multi-step with tools
APPOINTMENT = Scenario(
    name="appointment",
    responses=[
        {  # Call Calendar API for dentist
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "Calendar API",
                        "arguments": '{"service": "dentist"}',
                    },
                }
            ],
        },
        {  # After tool result: show slots
            "role": "assistant",
            "content": "Here are the available dentist appointments:\n\n🦷 Mon 9:00 AM\n🦷 Mon 2:00 PM\n\nWhich would you prefer?",
        },
        {  # After user selects: confirm
            "role": "assistant",
            "content": "You're booked for Monday August 3rd at 9:00 AM. See you then!",
        },
    ],
)


SCENARIOS: dict[str, Scenario] = {
    "happy": HAPPY,
    "order": HAPPY,
    "missing_info": MISSING_INFO,
    "order_missing": MISSING_INFO,
    "chatbot": CHATBOT,
    "greeting": CHATBOT,
    "appointment": APPOINTMENT,
    "booking": APPOINTMENT,
}


class MockAgentHandler(BaseHTTPRequestHandler):
    """HTTP handler that simulates an OpenAI-compatible agent."""

    scenario: Scenario = HAPPY
    conversation_states: dict[str, int] = {}  # client_ip -> step index

    def log_message(self, format, *args):
        """Quiet logging."""
        if self.server.verbose:
            super().log_message(format, *args)

    def do_GET(self):
        if self.path == "/health":
            self._json_response(200, {"status": "ok", "scenario": self.scenario.name})
        else:
            self._json_response(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/chat" and not self.path.endswith("/chat"):
            self._json_response(404, {"error": "not found — use POST /chat"})
            return

        # Read body
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._json_response(400, {"error": "invalid JSON"})
            return

        messages = data.get("messages", [])
        if not messages:
            self._json_response(400, {"error": "no messages"})
            return

        # Track conversation state per client
        client = self.client_address[0]
        step = self.conversation_states.get(client, 0)

        # Determine if this is a tool result being sent back
        last_msg = messages[-1] if messages else {}
        is_tool_result = last_msg.get("role") == "tool"

        # Get response
        responses = self.scenario.responses

        if step >= len(responses):
            # No more predefined responses — default
            response_msg = {
                "role": "assistant",
                "content": "I understand. Is there anything else I can help with?",
            }
        else:
            response_msg = responses[step]
            step += 1

        self.conversation_states[client] = step

        # Build OpenAI-compatible response
        response = {
            "id": f"chatcmpl-{int(time.time())}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": "mock-agent-v1",
            "choices": [
                {
                    "index": 0,
                    "message": response_msg,
                    "finish_reason": "tool_calls" if response_msg.get("tool_calls") else "stop",
                }
            ],
            "usage": {
                "prompt_tokens": sum(len(m.get("content", "") or "") for m in messages) // 4,
                "completion_tokens": len(response_msg.get("content", "") or "") // 4,
                "total_tokens": 100,
            },
        }

        if self.server.verbose:
            msg_preview = response_msg.get("content") or f"[tool_call: {response_msg.get('tool_calls', [{}])[0].get('function', {}).get('name', '?')}]"
            print(f"  → {msg_preview[:80]}")

        self._json_response(200, response)

    def _json_response(self, status: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Mock ABS Agent")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on (default: 8080)")
    parser.add_argument("--scenario", type=str, default="happy",
                        help=f"Scenario: {', '.join(SCENARIOS.keys())} (default: happy)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose logging")
    args = parser.parse_args()

    scenario = SCENARIOS.get(args.scenario)
    if not scenario:
        print(f"Unknown scenario: {args.scenario}")
        print(f"Available: {', '.join(SCENARIOS.keys())}")
        sys.exit(1)

    # Create handler class with bound scenario
    handler = type("Handler", (MockAgentHandler,), {"scenario": scenario})

    server = HTTPServer(("0.0.0.0", args.port), handler)
    server.verbose = args.verbose
    server.scenario = scenario

    print(f"🤖 Mock ABS Agent running on http://localhost:{args.port}")
    print(f"   Scenario: {scenario.name}")
    print(f"   Endpoints: POST /chat  GET /health")
    print(f"   Press Ctrl+C to stop")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 Shutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
