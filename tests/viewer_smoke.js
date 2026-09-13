// Loads the viewer's scripts against a minimal DOM and feeds them a real blueprint.
//
// The point is to catch the errors that kill the page at load: a `let` read before its
// declaration, a handler bound to an element that does not exist, a typo in a branch that
// only runs at startup. Any of those leaves every control below the failure unbound, which
// looks to a user like "the open button does nothing".
//
//   node tests/viewer_smoke.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const MEDIA = path.join(ROOT, "vscode", "media");
const read = (f) => fs.readFileSync(path.join(MEDIA, f), "utf8");

const html = read("viewer.html");
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

const calls = {};
const count = (name) => { calls[name] = (calls[name] || 0) + 1; };

function element(id) {
  const node = {
    id, style: {}, dataset: {}, children: [], hidden: false, checked: false, disabled: false,
    value: "", textContent: "", innerHTML: "", title: "", className: "", tagName: "DIV", files: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, setAttribute() {}, getAttribute: () => null, click() { count("click"); },
    focus() {}, blur() {}, closest: () => null, querySelector: () => null,
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    insertBefore(c) { this.children.push(c); return c; },
  };
  node.parentElement = { title: "", classList: node.classList, appendChild() {} };
  if (id === "map") {
    node.tagName = "CANVAS";
    node.width = 1200; node.height = 800;
    node.getContext = () => new Proxy({}, {
      get(_, prop) {
        if (prop === "measureText") return () => ({ width: 10 });
        if (prop === "canvas") return node;
        return typeof prop === "string" && /^[a-z]/.test(prop) ? (() => count(prop)) : undefined;
      },
      set() { return true; },
    });
  }
  return node;
}

const nodes = new Map([...ids].map((id) => [id, element(id)]));
const windowListeners = {}, documentListeners = {};
const listen = (bag) => (type, fn) => { (bag[type] = bag[type] || []).push(fn); };

const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Image: class { set src(_) {} },
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { clipboard: { writeText() {} } },
  atob: (b) => Buffer.from(b, "base64").toString("binary"),
  URL: { createObjectURL: () => "blob:" }, Blob: class {},
  document: {
    getElementById: (id) => nodes.get(id) || null,
    createElement: (tag) => { const n = element("new-" + tag); n.tagName = tag.toUpperCase(); return n; },
    body: element("body"),
    activeElement: null,
    addEventListener: listen(documentListeners),
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.addEventListener = listen(windowListeners);

vm.createContext(sandbox);

function fail(msg) { console.error("FAIL: " + msg); process.exit(1); }

for (const file of ["gamedata.js", "icons.js", "flow.js", "viewer.js"]) {
  const full = path.join(MEDIA, file);
  if (!fs.existsSync(full)) continue;          // gamedata.js and icons.js are generated
  try {
    vm.runInContext(read(file), sandbox, { filename: file });
  } catch (e) {
    fail(file + " threw while loading: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  }
}

// The page is only useful if it listens for a blueprint and for user input.
if (!windowListeners.message) fail("viewer.js never registered a message listener");
if (!documentListeners.paste) fail("viewer.js never registered a paste listener");
if (!nodes.get("open").onclick) fail("the open button has no click handler");
if (!nodes.get("editmode").onchange) fail("the edit toggle has no change handler");

// Feed it a real blueprint the way the extension host does.
const text = fs.readFileSync(path.join(ROOT, "tests", "fixtures", "mall.txt"), "utf8").trim();
const bp = JSON.parse(zlib.inflateSync(Buffer.from(text.slice(1), "base64")).toString("utf8")).blueprint;
try {
  for (const fn of windowListeners.message) fn({ data: { type: "blueprint", bp, file: "mall.txt" } });
} catch (e) {
  fail("handling a blueprint threw: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
}

if (!calls.fillRect) fail("nothing was drawn after loading a blueprint");
const status = nodes.get("flowstatus").textContent;
if (!/belts resolved/.test(status)) fail("the flow did not run in the page; status was: " + JSON.stringify(status));

console.log("viewer smoke ok: %d draw calls, flow says %j", calls.fillRect, status);
