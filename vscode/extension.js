// Factorio blueprint viewer for VS Code.
//
// Decoding happens here in the extension host with Node's zlib, so the webview
// only ever receives JSON. Footprints come from ../data/gamedata.json (built by
// `fbp gamedata`) so the map agrees with the command line tool.
const vscode = require("vscode");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

let panel = null;
let output = null;

function toolsPath() {
  const cfg = vscode.workspace.getConfiguration("fbp").get("toolsPath");
  return cfg && cfg.length ? cfg : path.resolve(__dirname, "..");
}

function decodeText(text) {
  const t = text.trim();
  if (t.startsWith("{")) return JSON.parse(t);
  if (!t.startsWith("0")) throw new Error("Not a blueprint string (expected leading '0')");
  return JSON.parse(zlib.inflateSync(Buffer.from(t.slice(1), "base64")).toString("utf8"));
}

function firstBlueprint(obj) {
  if (obj.blueprint) return obj.blueprint;
  if (obj.blueprint_book) {
    for (const e of obj.blueprint_book.blueprints || []) {
      const bp = firstBlueprint(e);
      if (bp) return bp;
    }
  }
  return null;
}

function loadFootprints() {
  try {
    const p = path.join(toolsPath(), "data", "gamedata.json");
    return JSON.parse(fs.readFileSync(p, "utf8")).footprints || {};
  } catch (e) {
    return {};
  }
}

function send(doc) {
  if (!panel) return;
  current = doc;
  try {
    const obj = decodeText(doc.getText());
    const bp = firstBlueprint(obj);
    if (!bp) throw new Error("No blueprint in this file");
    panel.webview.postMessage({ type: "blueprint", bp, footprints: loadFootprints(), file: path.basename(doc.fileName) });
    panel.title = "fbp: " + (bp.label || path.basename(doc.fileName));
  } catch (e) {
    panel.webview.postMessage({ type: "error", message: String(e.message || e) });
  }
}

let current = null;

function openViewer(context) {
  const editor = vscode.window.activeTextEditor;
  // With no editor the panel still opens; its open… button picks a file.
  const doc = editor && !editor.document.fileName.endsWith(".js") ? editor.document : null;
  if (!panel) {
    panel = vscode.window.createWebviewPanel("fbpViewer", "fbp viewer", vscode.ViewColumn.Beside, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, "media"))],
    });
    const mediaUri = (f) => panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, "media", f)));
    let html = fs.readFileSync(path.join(context.extensionPath, "media", "viewer.html"), "utf8");
    const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src ' +
      panel.webview.cspSource + " 'unsafe-inline'; script-src " + panel.webview.cspSource + ';">';
    html = html.replace("<!--CSP-->", csp)
      .replace('href="viewer.css"', 'href="' + mediaUri("viewer.css") + '"')
      .replace('src="viewer.js"', 'src="' + mediaUri("viewer.js") + '"');
    panel.webview.html = html;
    panel.onDidDispose(() => { panel = null; });
    panel.webview.onDidReceiveMessage(async (m) => {
      if (m.type === "copy") vscode.env.clipboard.writeText(m.text);
      if (m.type === "status") vscode.window.setStatusBarMessage(m.text, 3000);
      if (m.type === "open") {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false, openLabel: "Open blueprint",
          filters: { "Blueprint strings": ["txt", "fbp", "json"], "All files": ["*"] },
        });
        if (picked && picked[0]) send(await vscode.workspace.openTextDocument(picked[0]));
      }
    });
  }
  if (doc) send(doc);
  const sub = vscode.workspace.onDidSaveTextDocument((d) => { if (d === current) send(d); });
  context.subscriptions.push(sub);
}

function runFbp(args, title) {
  const py = vscode.workspace.getConfiguration("fbp").get("python") || "python";
  if (!output) output = vscode.window.createOutputChannel("fbp");
  output.show(true);
  output.appendLine("$ " + py + " -m fbp " + args.map((a) => (a.includes(" ") ? '"' + a + '"' : a)).join(" "));
  const child = spawn(py, ["-m", "fbp", ...args], { cwd: toolsPath() });
  child.stdout.on("data", (d) => output.append(d.toString()));
  child.stderr.on("data", (d) => output.append(d.toString()));
  child.on("close", (code) => output.appendLine("[" + title + " exited " + code + "]"));
}

function activeFile() {
  const editor = vscode.window.activeTextEditor;
  return editor ? editor.document.fileName : null;
}

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand("fbp.open", () => openViewer(context)));
  context.subscriptions.push(vscode.commands.registerCommand("fbp.check", () => {
    const f = activeFile(); if (f) runFbp(["check", f], "check");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("fbp.trace", async () => {
    const f = activeFile(); if (!f) return;
    const recipe = await vscode.window.showInputBox({ prompt: "Recipe to trace (e.g. big-electric-pole)" });
    if (recipe) runFbp(["trace", f, "--recipe", recipe], "trace");
  }));
}

function deactivate() {}

module.exports = { activate, deactivate };
