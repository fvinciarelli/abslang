"""Small threaded HTTP server helpers shared by adapter tests."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def do_POST(self):  # noqa: N802 (http.server API)
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        record = {
            "headers": {k.lower(): v for k, v in self.headers.items()},
            "body": json.loads(raw) if raw else {},
            "path": self.path,
        }
        self.server.requests.append(record)  # type: ignore[attr-defined]
        self.server.responder(record, self, len(self.server.requests) - 1)  # type: ignore[attr-defined]

    def log_message(self, *args):  # silence test server
        pass


def send_sse(handler: BaseHTTPRequestHandler, events: list[dict]) -> None:
    body = "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events)
    body += "data: [DONE]\n\n"
    payload = body.encode()
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def send_json(handler: BaseHTTPRequestHandler, data: dict) -> None:
    payload = json.dumps(data).encode()
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def start_server(responder):
    """Start a threaded HTTP server; returns ``(httpd, base_url)``."""
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    httpd.requests = []  # type: ignore[attr-defined]
    httpd.responder = responder  # type: ignore[attr-defined]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"
