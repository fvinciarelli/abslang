/**
 * Shared test HTTP server helpers for adapter tests.
 */
import * as http from "node:http";
import { AddressInfo } from "node:net";

export interface CapturedRequest {
  headers: http.IncomingHttpHeaders;
  body: any;
  url: string;
}

export interface TestServer {
  url: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

export function startServer(
  responder: (req: CapturedRequest, res: http.ServerResponse, index: number) => void,
  path = "/"
): Promise<TestServer> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const captured: CapturedRequest = {
        headers: req.headers,
        body: raw ? JSON.parse(raw) : undefined,
        url: req.url ?? "",
      };
      requests.push(captured);
      responder(captured, res, requests.length - 1);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}${path}`,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

export function sendSse(res: http.ServerResponse, events: any[]): void {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const ev of events) {
    res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

export function sendJson(res: http.ServerResponse, data: any, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
