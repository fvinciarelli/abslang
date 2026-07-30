import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

// ── Activation ──

export function activate(context: vscode.ExtensionContext) {
  console.log("ABS extension activated");

  // Register commands
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

  // Auto-open editor when an .abs.yaml file is opened
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isAbsFile(editor.document)) {
        AbsEditorPanel.createOrShow(context.extensionUri);
      }
    })
  );

  // Expose URI for webview resource loading
  context.subscriptions.push(
    vscode.commands.registerCommand("abs.getWebviewUri", (relativePath: string) => {
      const uri = vscode.Uri.joinPath(context.extensionUri, relativePath);
      return uri.toString();
    })
  );
}

export function deactivate() {}

// ── Helpers ──

function isAbsFile(document: vscode.TextDocument): boolean {
  return (
    document.languageId === "yaml" &&
    (document.fileName.endsWith(".abs.yaml") ||
      document.getText().includes("session:") &&
      document.getText().includes("behaviors:"))
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
            vscode.Uri.joinPath(extensionUri, "node_modules"),
          ],
        }
      );

      AbsEditorPanel.currentPanel = new AbsEditorPanel(panel, extensionUri);
    }

    // Send current document content to webview
    AbsEditorPanel.currentPanel.syncDocument();
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from webview
    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "save":
            this.saveDocument(message.yaml);
            break;
          case "run":
            vscode.commands.executeCommand("abs.run");
            break;
          case "sync":
            this.syncDocument();
            break;
          case "updateConfig":
            this.updateConfig(message.key, message.value);
            break;
        }
      },
      null,
      this._disposables
    );

    // Listen for document changes
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

  private updateConfig(key: string, value: string) {
    const config = vscode.workspace.getConfiguration("abs");
    config.update(key, value, vscode.ConfigurationTarget.Global);
  }

  public dispose() {
    AbsEditorPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      this._disposables.pop()!.dispose();
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "editor.js")
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ABS Editor</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, -apple-system, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .toolbar {
      display: flex;
      gap: 6px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-titleBar-activeBackground);
      align-items: center;
    }
    .toolbar button {
      padding: 4px 10px;
      border: 1px solid var(--vscode-button-border);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .toolbar button:hover { background: var(--vscode-button-hoverBackground); }
    .toolbar button.run { background: var(--vscode-terminal-ansiGreen, #4caf50); border-color: transparent; }
    .toolbar button.run:hover { opacity: 0.9; }
    .toolbar .file-name { flex: 1; font-size: 12px; color: var(--vscode-descriptionForeground); }
    .main { display: flex; flex: 1; overflow: hidden; }
    .behavior-list {
      width: 280px;
      border-right: 1px solid var(--vscode-panel-border);
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .behavior-card {
      padding: 8px 10px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      cursor: pointer;
      background: var(--vscode-editor-background);
      transition: border-color 0.15s;
    }
    .behavior-card:hover { border-color: var(--vscode-focusBorder); }
    .behavior-card.selected { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .behavior-card .actor-action {
      font-weight: 600;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .behavior-card .content-preview {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 240px;
    }
    .behavior-card.selected .content-preview { color: inherit; opacity: 0.8; }
    .actor-dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    }
    .actor-dot.user { background: #3b82f6; }
    .actor-dot.assistant { background: #8b5cf6; }
    .actor-dot.tool { background: #f59e0b; }
    .actor-dot.system { background: #6b7280; }
    .actor-dot.human { background: #10b981; }
    .property-sheet {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }
    .property-sheet h3 {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      color: var(--vscode-foreground);
    }
    .field {
      margin-bottom: 12px;
    }
    .field label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .field input, .field textarea, .field select {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 3px;
      font-family: inherit;
      font-size: 13px;
    }
    .field textarea { resize: vertical; min-height: 60px; }
    .field select { cursor: pointer; }
    .empty-state {
      padding: 32px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }
    .empty-state p { margin-top: 8px; font-size: 12px; }
    .add-btn {
      width: 100%;
      padding: 6px;
      border: 1px dashed var(--vscode-panel-border);
      background: transparent;
      color: var(--vscode-descriptionForeground);
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      margin-top: 4px;
    }
    .add-btn:hover { border-color: var(--vscode-focusBorder); color: var(--vscode-foreground); }
    .palette {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 12px;
    }
    .palette button {
      padding: 3px 8px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
    }
    .palette button:hover { background: var(--vscode-list-hoverBackground); }
    .results-panel {
      border-top: 1px solid var(--vscode-panel-border);
      max-height: 200px;
      overflow-y: auto;
      padding: 8px 12px;
      font-size: 12px;
      background: var(--vscode-terminal-background, #1e1e1e);
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .results-panel .pass { color: #4caf50; }
    .results-panel .fail { color: #f44336; }
    .results-panel .step { padding: 2px 0; }
    .results-panel .eval { padding-left: 16px; font-size: 11px; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="btn-run" class="run" title="Run session against agent">▶ Run</button>
    <button id="btn-save" title="Save to YAML">💾 Save</button>
    <span class="file-name" id="file-name"></span>
  </div>
  <div class="main">
    <div class="behavior-list" id="behavior-list">
      <div class="empty-state">
        <p>Open a .abs.yaml file to edit</p>
      </div>
    </div>
    <div class="property-sheet" id="property-sheet">
      <div class="empty-state">
        <p>Select a behavior to edit its properties</p>
      </div>
    </div>
  </div>
  <div class="results-panel" id="results-panel" style="display:none"></div>

  <script>
    const vscode = acquireVsCodeApi();
    let behaviors = [];
    let selectedIndex = -1;
    let sessionName = '';
    let sessionDescription = '';
    let chainEvaluations = [];
    let fileName = '';

    // ── Palette items ──
    const paletteItems = [
      { actor: 'user', action: 'says', label: 'User message' },
      { actor: 'assistant', action: 'says', label: 'Assistant says' },
      { actor: 'assistant', action: 'asks', label: 'Assistant asks' },
      { actor: 'assistant', action: 'informs', label: 'Assistant informs' },
      { actor: 'assistant', action: 'calls', label: 'Tool call' },
      { actor: 'tool', action: 'responds', label: 'Tool response' },
      { actor: 'assistant', action: 'hands_off', label: 'Hand-off' },
      { actor: 'user', action: 'selects', label: 'User selects' },
    ];

    const actorOptions = ['user', 'assistant', 'tool', 'system', 'human'];
    const actionOptions = {
      Communication: ['says', 'asks', 'responds', 'informs', 'greets', 'clarifies', 'confirms', 'rejects', 'suggests', 'shows'],
      Execution: ['calls', 'submits', 'retrieves', 'stores', 'updates'],
      Interaction: ['selects', 'uploads', 'approves'],
      Delegation: ['hands_off'],
    };

    // ── Render ──
    function render() {
      const list = document.getElementById('behavior-list');
      list.innerHTML = '';

      // Session header
      const header = document.createElement('div');
      header.style.cssText = 'margin-bottom:8px;padding:4px 0';
      header.innerHTML = '<span style="font-size:12px;font-weight:600;color:var(--vscode-descriptionForeground)">' + escapeHtml(sessionName || 'Untitled') + '</span>';
      list.appendChild(header);

      // Palette
      const palette = document.createElement('div');
      palette.className = 'palette';
      paletteItems.forEach(item => {
        const btn = document.createElement('button');
        btn.textContent = '+' + item.label;
        btn.onclick = () => addBehavior(item.actor, item.action);
        palette.appendChild(btn);
      });
      list.appendChild(palette);

      // Behaviors
      behaviors.forEach((b, i) => {
        const card = document.createElement('div');
        card.className = 'behavior-card' + (i === selectedIndex ? ' selected' : '');
        card.onclick = () => selectBehavior(i);
        card.innerHTML =
          '<div class="actor-action">' +
          '<span class="actor-dot ' + b.actor + '"></span>' +
          escapeHtml(b.actor) + ' · ' + escapeHtml(b.action) +
          (b.target ? ' → ' + escapeHtml(b.target) : '') +
          '</div>' +
          (b.content
            ? '<div class="content-preview">' + escapeHtml(typeof b.content === 'string' ? b.content : JSON.stringify(b.content)) + '</div>'
            : '');
        list.appendChild(card);
      });

      // Add chain eval button
      const addChainBtn = document.createElement('button');
      addChainBtn.className = 'add-btn';
      addChainBtn.textContent = '+ Add chain evaluation';
      addChainBtn.onclick = () => {
        chainEvaluations.push({ type: 'sequence', order: [] });
        render();
        selectChainEval(chainEvaluations.length - 1);
      };
      list.appendChild(addChainBtn);

      renderPropertySheet();
    }

    function renderPropertySheet() {
      const sheet = document.getElementById('property-sheet');
      sheet.innerHTML = '';

      if (selectedIndex === -2) {
        // Session-level editing
        sheet.innerHTML = '<h3>Session</h3>' +
          '<div class="field"><label>Name</label><input id="prop-session" value="' + escapeHtml(sessionName) + '" onchange="sessionName=this.value"></div>' +
          '<div class="field"><label>Description</label><textarea id="prop-desc" onchange="sessionDescription=this.value">' + escapeHtml(sessionDescription) + '</textarea></div>';

        // Chain evaluations
        chainEvaluations.forEach((ev, i) => {
          const div = document.createElement('div');
          div.style.cssText = 'margin-top:12px;padding:8px;border:1px solid var(--vscode-panel-border);border-radius:4px';
          div.innerHTML = '<div style="font-weight:600;font-size:12px;margin-bottom:8px">Chain: ' + escapeHtml(ev.type) +
            ' <button style="float:right;background:none;border:none;color:var(--vscode-errorForeground);cursor:pointer;font-size:11px" onclick="chainEvaluations.splice(' + i + ',1);render();selectBehavior(' + selectedIndex + ')">✕</button></div>' +
            '<div class="field"><label>Type</label><select onchange="chainEvaluations[' + i + '].type=this.value;render();selectChainEval(' + i + ')">' +
            ['sequence','eventually','never','count','within','variable_consistency','all_of','any_of','none_of'].map(t => '<option' + (ev.type === t ? ' selected' : '') + '>' + t + '</option>').join('') +
            '</select></div>';
          sheet.appendChild(div);
        });
        return;
      }

      if (selectedIndex < 0 || selectedIndex >= behaviors.length) {
        sheet.innerHTML = '<div class="empty-state"><p>Select a behavior to edit its properties</p></div>';
        return;
      }

      const b = behaviors[selectedIndex];
      sheet.innerHTML = '<h3>Behavior ' + (selectedIndex + 1) + '</h3>' +
        '<button style="float:right;background:none;border:none;color:var(--vscode-errorForeground);cursor:pointer;font-size:12px;margin-bottom:8px" onclick="behaviors.splice(' + selectedIndex + ',1);selectedIndex=-1;render()">Delete</button>' +

        '<div class="field"><label>Actor</label><select onchange="behaviors[' + selectedIndex + '].actor=this.value;render();selectBehavior(' + selectedIndex + ')">' +
        actorOptions.map(a => '<option' + (b.actor === a ? ' selected' : '') + '>' + a + '</option>').join('') +
        '</select></div>' +

        '<div class="field"><label>Action</label><select onchange="behaviors[' + selectedIndex + '].action=this.value;render();selectBehavior(' + selectedIndex + ')">' +
        Object.entries(actionOptions).map(([cat, actions]) => '<optgroup label="' + cat + '">' + actions.map(a => '<option' + (b.action === a ? ' selected' : '') + '>' + a + '</option>').join('') + '</optgroup>').join('') +
        '</select></div>' +

        '<div class="field"><label>Target</label><input value="' + escapeHtml(b.target || '') + '" onchange="behaviors[' + selectedIndex + '].target=this.value||undefined"></div>' +
        '<div class="field"><label>Content</label><textarea onchange="behaviors[' + selectedIndex + '].content=this.value">' + escapeHtml(typeof b.content === 'string' ? b.content : b.content ? JSON.stringify(b.content) : '') + '</textarea></div>';

      // Evaluations
      if (b.evaluations && b.evaluations.length > 0) {
        sheet.innerHTML += '<div style="margin-top:12px"><label style="font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase">Evaluations</label></div>';
        b.evaluations.forEach((ev, i) => {
          const div = document.createElement('div');
          div.style.cssText = 'margin-top:8px;padding:8px;border:1px solid var(--vscode-panel-border);border-radius:4px';
          div.innerHTML =
            '<div style="font-weight:600;font-size:12px;margin-bottom:6px">' + escapeHtml(ev.type) +
            ' <button style="float:right;background:none;border:none;color:var(--vscode-errorForeground);cursor:pointer;font-size:11px" onclick="behaviors[' + selectedIndex + '].evaluations.splice(' + i + ',1);render();selectBehavior(' + selectedIndex + ')">✕</button></div>' +
            (ev.type === 'contains' || ev.type === 'exact_match'
              ? '<div class="field"><label>Value</label><input value="' + escapeHtml(ev.value || '') + '" onchange="behaviors[' + selectedIndex + '].evaluations[' + i + '].value=this.value"></div>'
              : '') +
            (ev.type === 'llm_judge'
              ? '<div class="field"><label>Criteria</label><textarea onchange="behaviors[' + selectedIndex + '].evaluations[' + i + '].criteria=this.value">' + escapeHtml(ev.criteria || '') + '</textarea></div>'
              : '');
          sheet.appendChild(div);
        });
      }

      // Add evaluation button
      const addEvalBtn = document.createElement('button');
      addEvalBtn.className = 'add-btn';
      addEvalBtn.textContent = '+ Add evaluation';
      addEvalBtn.onclick = () => {
        if (!b.evaluations) b.evaluations = [];
        b.evaluations.push({ type: 'contains', value: '' });
        render();
        selectBehavior(selectedIndex);
      };
      sheet.appendChild(addEvalBtn);
    }

    function addBehavior(actor, action) {
      const b = { actor, action };
      if (action === 'calls') b.target = '';
      behaviors.push(b);
      selectBehavior(behaviors.length - 1);
      render();
    }

    function selectBehavior(i) {
      selectedIndex = i;
      render();
    }

    function selectChainEval(i) {
      selectedIndex = -2;
      render();
    }

    function escapeHtml(s) {
      if (!s) return '';
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── YAML serialization (minimal) ──
    function toYaml() {
      let y = 'session: ' + (sessionName || 'Untitled') + '\\n';
      if (sessionDescription) y += 'description: ' + JSON.stringify(sessionDescription) + '\\n';
      y += 'behaviors:\\n';
      behaviors.forEach(b => {
        y += '  - actor: ' + b.actor + '\\n';
        y += '    action: ' + b.action + '\\n';
        if (b.target) y += '    target: ' + b.target + '\\n';
        if (b.content) {
          const c = typeof b.content === 'string' ? JSON.stringify(b.content) : b.content;
          y += '    content: ' + c + '\\n';
        }
        if (b.evaluations && b.evaluations.length > 0) {
          y += '    evaluations:\\n';
          b.evaluations.forEach(ev => {
            y += '      - type: ' + ev.type + '\\n';
            if (ev.value) y += '        value: ' + JSON.stringify(ev.value) + '\\n';
            if (ev.criteria) {
              y += '        criteria: |\\n';
              ev.criteria.split('\\n').forEach(line => {
                y += '          ' + line + '\\n';
              });
            }
          });
        }
      });
      if (chainEvaluations.length > 0) {
        y += 'evaluations:\\n';
        chainEvaluations.forEach(ev => {
          y += '  - type: ' + ev.type + '\\n';
        });
      }
      return y;
    }

    // ── YAML parsing (minimal, from simple YAML) ──
    function parseSimpleYaml(raw) {
      // This is a simplified parser for the webview.
      // For production, we'd use the abs parser via the extension host.
      const lines = raw.split('\\n');
      behaviors = [];
      chainEvaluations = [];
      sessionName = '';
      sessionDescription = '';
      let currentBehavior = null;
      let inBehaviors = false;
      let inEvals = false;
      let inChainEvals = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith('session:')) {
          sessionName = trimmed.replace('session:', '').trim();
          continue;
        }
        if (trimmed.startsWith('description:')) {
          sessionDescription = trimmed.replace('description:', '').trim().replace(/^"|"$/g, '');
          continue;
        }
        if (trimmed === 'behaviors:') { inBehaviors = true; inChainEvals = false; continue; }
        if (trimmed === 'evaluations:') { inBehaviors = false; inChainEvals = true; continue; }

        if (inBehaviors && trimmed.startsWith('- actor:')) {
          currentBehavior = {
            actor: trimmed.replace('- actor:', '').trim(),
            action: '',
            evaluations: []
          };
          behaviors.push(currentBehavior);
          inEvals = false;
        } else if (currentBehavior && trimmed.startsWith('action:')) {
          currentBehavior.action = trimmed.replace('action:', '').trim();
        } else if (currentBehavior && trimmed.startsWith('target:')) {
          currentBehavior.target = trimmed.replace('target:', '').trim();
        } else if (currentBehavior && trimmed.startsWith('content:')) {
          currentBehavior.content = trimmed.replace('content:', '').trim().replace(/^"|"$/g, '');
        } else if (currentBehavior && trimmed === 'evaluations:') {
          inEvals = true;
        } else if (currentBehavior && inEvals && trimmed.startsWith('- type:')) {
          currentBehavior.evaluations.push({ type: trimmed.replace('- type:', '').trim() });
        }
      }
    }

    // ── Message handlers ──
    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.command) {
        case 'loadDocument':
          fileName = msg.fileName;
          document.getElementById('file-name').textContent = fileName;
          parseSimpleYaml(msg.yaml);
          render();
          break;
      }
    });

    // ── Button handlers ──
    document.getElementById('btn-save').onclick = () => {
      const yaml = toYaml();
      vscode.postMessage({ command: 'save', yaml });
    };
    document.getElementById('btn-run').onclick = () => {
      // Save first, then run
      const yaml = toYaml();
      vscode.postMessage({ command: 'save', yaml });
      setTimeout(() => vscode.postMessage({ command: 'run' }), 200);
    };

    // ── Init ──
    // Select session header on load
    selectBehavior(-2);
  </script>
</body>
</html>`;
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

  // Build CLI command
  const cliPath = path.join(
    vscode.extensions.getExtension("fvinciarelli.abs-vscode")
      ?.extensionPath || "",
    "..",
    "typescript",
    "dist",
    "cli.js"
  );

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

    // Parse and display results
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
      // Not JSON — show raw output
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

  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
  if (!fs.existsSync(datasetsDir)) fs.mkdirSync(datasetsDir, { recursive: true });

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
    { orderId: "12345", expectedResponse: "Your order is on the way", expectedKeyword: "on the way" },
    { orderId: "67890", expectedResponse: "Your order is being prepared", expectedKeyword: "prepared" },
    { orderId: "99999", expectedResponse: "Your order has been delivered", expectedKeyword: "delivered" },
  ];

  fs.writeFileSync(
    path.join(datasetsDir, "order-status.jsonl"),
    sampleDataset.map((r) => JSON.stringify(r)).join("\n") + "\n"
  );

  vscode.window.showInformationMessage(
    "✅ ABS project initialized: sessions/ and datasets/ created."
  );
}
