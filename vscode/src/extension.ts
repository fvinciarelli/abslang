import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

export function activate(context: vscode.ExtensionContext) {
  console.log("ABS extension activated");

  context.subscriptions.push(
    vscode.commands.registerCommand("abs.showEditor", () => {
      AbsEditorPanel.createOrShow(context.extensionUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("abs.run", async () => {
      await runSession();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("abs.init", async () => {
      await initProject();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isAbsFile(editor.document)) {
        AbsEditorPanel.createOrShow(context.extensionUri);
      }
    })
  );
}

export function deactivate() {}

function isAbsFile(document: vscode.TextDocument): boolean {
  return (
    document.languageId === "yaml" &&
    (document.fileName.endsWith(".abs.yaml") ||
      (document.getText().includes("session:") &&
        document.getText().includes("behaviors:")))
  );
}

// ── Webview Panel ──

class AbsEditorPanel {
  public static currentPanel: AbsEditorPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (AbsEditorPanel.currentPanel) {
      AbsEditorPanel.currentPanel._panel.reveal(column);
      AbsEditorPanel.currentPanel.syncDocument();
    } else {
      const panel = vscode.window.createWebviewPanel(
        "absEditor",
        "ABS Editor",
        column,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(extensionUri, "media"),
          ],
        }
      );

      AbsEditorPanel.currentPanel = new AbsEditorPanel(panel, extensionUri);
      AbsEditorPanel.currentPanel.syncDocument();
    }
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "save":
            this.saveDocument(message.yaml);
            break;
          case "run":
            vscode.commands.executeCommand("abs.run");
            break;
        }
      },
      null,
      this._disposables
    );

    vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        if (editor && isAbsFile(editor.document)) {
          this.syncDocument();
        }
      },
      null,
      this._disposables
    );
  }

  public syncDocument() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isAbsFile(editor.document)) return;

    const yaml = editor.document.getText();
    this._panel.webview.postMessage({
      command: "loadDocument",
      yaml,
      fileName: path.basename(editor.document.fileName),
    });
  }

  private saveDocument(yaml: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length)
    );

    editor.edit((editBuilder) => {
      editBuilder.replace(fullRange, yaml);
    });
  }

  public dispose() {
    AbsEditorPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      this._disposables.pop()!.dispose();
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const uiDir = vscode.Uri.joinPath(this._extensionUri, "media", "ui");
    const indexPath = vscode.Uri.joinPath(uiDir, "index.html");

    let html = fs.readFileSync(indexPath.fsPath, "utf-8");

    // Rewrite asset paths (src, href) to use webview URIs
    html = html.replace(
      /(src|href)="([^"]*)"/g,
      (_match: string, attr: string, assetPath: string) => {
        if (
          assetPath.startsWith("http") ||
          assetPath.startsWith("data:") ||
          assetPath.startsWith("#")
        ) {
          return `${attr}="${assetPath}"`;
        }
        const resolved = vscode.Uri.joinPath(uiDir, assetPath);
        const uri = webview.asWebviewUri(resolved);
        return `${attr}="${uri}"`;
      }
    );

    // Inject VSCode bridge before </body>
    const bridge = `
<script>
  const vscode = acquireVsCodeApi();
  window.__ABS_VSCODE__ = true;

  // Messages from extension host → React app
  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.command === 'loadDocument') {
      window.dispatchEvent(new CustomEvent('abs-load-document', {
        detail: { yaml: msg.yaml, fileName: msg.fileName }
      }));
    }
    if (msg.command === 'runResult') {
      window.dispatchEvent(new CustomEvent('abs-run-result', {
        detail: msg.report
      }));
    }
  });

  // Messages from React app → extension host
  window.addEventListener('abs-save', function(e) {
    vscode.postMessage({ command: 'save', yaml: e.detail.yaml });
  });
  window.addEventListener('abs-run', function() {
    vscode.postMessage({ command: 'run' });
  });
</script>
</body>`;

    html = html.replace("</body>", bridge);
    return html;
  }
}

// ── Run session ──

async function runSession() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("No active editor.");
    return;
  }

  const config = vscode.workspace.getConfiguration("abs");
  const agentUrl = config.get<string>("abs.agentUrl", "");
  if (!agentUrl) {
    vscode.window.showErrorMessage(
      "Set abs.agentUrl in settings (or ABS_AGENT_URL env var)."
    );
    return;
  }

  const yaml = editor.document.getText();
  const tmpFile = path.join(
    require("os").tmpdir(),
    `abs-run-${Date.now()}.abs.yaml`
  );
  fs.writeFileSync(tmpFile, yaml);

  // Find the bundled CLI relative to the extension
  const extPath = vscode.extensions.getExtension("fvinciarelli.abs-vscode")?.extensionPath || "";
  const cliPath = path.join(extPath, "dist", "cli.bundle.js");

  try {
    const result = execSync(
      `node ${cliPath} run ${tmpFile} --agent ${agentUrl} --format json --ci 2>&1`,
      {
        timeout: 300000,
        encoding: "utf-8",
        env: {
          ...process.env,
          ABS_AGENT_URL: agentUrl,
          ABS_AGENT_FORMAT: config.get<string>("abs.agentFormat", "openai"),
          ABS_AGENT_AUTH: config.get<string>("abs.agentAuth", "none"),
          ABS_AGENT_TOKEN: config.get<string>("abs.agentToken", ""),
          AIEVALUATOR_API_KEY: config.get<string>("abs.aiEvaluatorApiKey", ""),
        },
      }
    );

    try {
      const report = JSON.parse(result);
      const panel = AbsEditorPanel.currentPanel;
      if (panel) {
        (panel as any)._panel.webview.postMessage({
          command: "runResult",
          report,
        });
      }

      if (report.passed) {
        vscode.window.showInformationMessage(
          `✅ ABS: ${report.rows_passed || "all"}/${report.rows_total || 1} passed`
        );
      } else {
        vscode.window.showWarningMessage(
          `❌ ABS: ${(report.rows_total || 1) - (report.rows_passed || 0)} failed`
        );
      }
    } catch {
      vscode.window.showInformationMessage("ABS run complete. See output.");
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(
      `ABS run failed: ${err.message?.substring(0, 200) || err}`
    );
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ── Init project ──

async function initProject() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage("Open a folder first.");
    return;
  }

  const sessionsDir = path.join(folder.uri.fsPath, "sessions");
  const datasetsDir = path.join(folder.uri.fsPath, "datasets");

  if (!fs.existsSync(sessionsDir))
    fs.mkdirSync(sessionsDir, { recursive: true });
  if (!fs.existsSync(datasetsDir))
    fs.mkdirSync(datasetsDir, { recursive: true });

  const sampleYaml = `session: Order status
description: User asks about an order. Happy path.
behaviors:
  - actor: user
    action: says
    content: "Where is my order {{orderId}}?"
  - actor: assistant
    action: asks
    content: "Please provide your order number"
  - actor: user
    action: says
    content: "{{orderId}}"
    capture:
      orderId: "{{orderId}}"
  - actor: assistant
    action: calls
    target: Order MCP
    with:
      orderId: "{{orderId}}"
  - actor: tool
    action: responds
    target: Order MCP
    content:
      status: "in_transit"
  - actor: assistant
    action: informs
    content: "{{expectedResponse}}"
    evaluations:
      - type: contains
        value: "{{expectedKeyword}}"
`;

  fs.writeFileSync(
    path.join(sessionsDir, "order-status.abs.yaml"),
    sampleYaml
  );

  const sampleDataset = [
    {
      orderId: "12345",
      expectedResponse: "Your order is on the way",
      expectedKeyword: "on the way",
    },
    {
      orderId: "67890",
      expectedResponse: "Your order is being prepared",
      expectedKeyword: "prepared",
    },
    {
      orderId: "99999",
      expectedResponse: "Your order has been delivered",
      expectedKeyword: "delivered",
    },
  ];

  fs.writeFileSync(
    path.join(datasetsDir, "order-status.jsonl"),
    sampleDataset.map((r) => JSON.stringify(r)).join("\n") + "\n"
  );

  vscode.window.showInformationMessage(
    "✅ ABS project initialized: sessions/ and datasets/ created."
  );
}
