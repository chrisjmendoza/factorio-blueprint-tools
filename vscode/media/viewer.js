// Canvas renderer for one Factorio blueprint. Receives {bp, footprints} from the
// extension host; everything else happens here.
(function () {
  const inVsCode = typeof acquireVsCodeApi === "function";
  const vscode = inVsCode ? acquireVsCodeApi() : {
    postMessage(m) {
      if (m.type === "copy" && navigator.clipboard) navigator.clipboard.writeText(m.text);
      if (m.type === "open") document.getElementById("filepick").click();
    },
  };
  const canvas = document.getElementById("map");
  const ctx = canvas.getContext("2d");
  const tip = document.getElementById("tip");
  const detail = document.getElementById("detail");
  const coords = document.getElementById("coords");

  // (w,h) facing north for anything not in gamedata footprints.
  const BUILTIN = {
    "assembling-machine-1": [3, 3], "assembling-machine-2": [3, 3], "assembling-machine-3": [3, 3],
    "chemical-plant": [3, 3], "oil-refinery": [5, 5], "lab": [3, 3], "roboport": [4, 4], "radar": [3, 3],
    "stone-furnace": [2, 2], "steel-furnace": [2, 2], "electric-furnace": [3, 3], "storage-tank": [3, 3],
    "big-electric-pole": [2, 2], "substation": [2, 2], "splitter": [2, 1], "fast-splitter": [2, 1],
    "express-splitter": [2, 1], "turbo-splitter": [2, 1], "pumpjack": [3, 3], "train-stop": [2, 2],
  };
  const UNMODELLED = new Set(["legacy-straight-rail", "legacy-curved-rail", "straight-rail", "curved-rail-a",
    "curved-rail-b", "half-diagonal-rail", "cargo-wagon", "locomotive", "fluid-wagon", "artillery-wagon"]);
  const DIRS = { 0: [0, -1], 4: [1, 0], 8: [0, 1], 12: [-1, 0] };

  const KINDS = [
    ["belt", /-transport-belt$|^transport-belt$/, "#c9a227"],
    ["underground", /underground-belt$/, "#8a6f1a"],
    ["splitter", /splitter$/, "#e0b23a"],
    ["long inserter", /^long-handed-inserter$/, "#7a6fd6"],
    ["inserter", /inserter$/, "#4f86d9"],
    ["crafter", /^assembling-machine|^chemical-plant$|^oil-refinery$|^centrifuge$|^foundry$|^electromagnetic-plant$|^biochamber$|^cryogenic-plant$|^recycler$/, "#5fae6a"],
    ["furnace", /furnace$/, "#c96a3f"],
    ["lab", /^lab$/, "#d66aa8"],
    ["chest", /chest$/, "#a57fd0"],
    ["pole", /electric-pole$|^substation$/, "#ececec"],
    ["pipe", /^pipe|^pump$|^storage-tank$|^offshore-pump$/, "#3fa9a3"],
    ["lamp", /^small-lamp$/, "#f6ec9a"],
    ["combinator", /combinator$|^power-switch$|^programmable-speaker$/, "#d95050"],
    ["roboport", /^roboport$|^radar$/, "#7f8fa6"],
    ["rail", /rail|wagon|locomotive|signal|train-stop/, "#9a9a9a"],
    ["other", /.*/, "#6e6e6e"],
  ];
  function kindOf(name) { for (const k of KINDS) if (k[1].test(name)) return k; return KINDS[KINDS.length - 1]; }

  let bp = null, footprints = {}, ents = [], tiles = new Map(), bbox = [0, 0, 1, 1];
  let scale = 12, ox = 0, oy = 0;          // pixels per tile, pixel offset of tile (0,0)
  let hover = null, pinned = null, highlight = "";
  let showWires = false, showLabels = true, showGrid = false;

  function cellsOf(e) {
    if (UNMODELLED.has(e.name)) return [[Math.floor(e.position.x), Math.floor(e.position.y)]];
    let wh = footprints[e.name] || BUILTIN[e.name] || [1, 1];
    let [w, h] = wh;
    const d = (e.direction || 0) & 12;
    if (d === 4 || d === 12) [w, h] = [h, w];
    const x0 = Math.floor(e.position.x - w / 2), y0 = Math.floor(e.position.y - h / 2);
    const out = [];
    for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) out.push([x0 + dx, y0 + dy]);
    return out;
  }

  function load(msg) {
    bp = msg.bp; footprints = msg.footprints || {};
    ents = (bp.entities || []).map((e) => ({ e, cells: cellsOf(e), kind: kindOf(e.name) }));
    tiles = new Map();
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const r of ents) for (const [x, y] of r.cells) {
      const k = x + "," + y;
      if (!tiles.has(k)) tiles.set(k, []);
      tiles.get(k).push(r);
      if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y;
    }
    bbox = ents.length ? [minx, miny, maxx, maxy] : [0, 0, 1, 1];
    document.getElementById("file").textContent = (bp.label || msg.file || "") + "  ·  " + ents.length + " entities";
    pinned = null; hover = null;
    fit(); legend(); draw();
  }

  function fit() {
    const [x0, y0, x1, y1] = bbox;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    scale = Math.max(1, Math.min(canvas.width / (w + 2), canvas.height / (h + 2)));
    ox = (canvas.width - w * scale) / 2 - x0 * scale;
    oy = (canvas.height - h * scale) / 2 - y0 * scale;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(r.width)); canvas.height = Math.max(1, Math.floor(r.height));
    draw();
  }

  function px(x) { return ox + x * scale; }
  function py(y) { return oy + y * scale; }

  function matches(r) {
    if (!highlight) return false;
    const rec = r.e.recipe || "";
    return r.e.name.includes(highlight) || rec.includes(highlight);
  }

  function draw() {
    if (!bp) { ctx.fillStyle = "#1b1b1d"; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
    ctx.fillStyle = "#1b1b1d"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const vx0 = Math.floor(-ox / scale) - 1, vy0 = Math.floor(-oy / scale) - 1;
    const vx1 = Math.ceil((canvas.width - ox) / scale) + 1, vy1 = Math.ceil((canvas.height - oy) / scale) + 1;
    const gap = scale >= 6 ? 1 : 0;

    if (showGrid && scale >= 8) {
      ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = vx0; x <= vx1; x++) { ctx.moveTo(px(x) + 0.5, 0); ctx.lineTo(px(x) + 0.5, canvas.height); }
      for (let y = vy0; y <= vy1; y++) { ctx.moveTo(0, py(y) + 0.5); ctx.lineTo(canvas.width, py(y) + 0.5); }
      ctx.stroke();
    }

    const drawn = new Set();
    for (const r of ents) {
      const c0 = r.cells[0];
      let inside = false;
      for (const [x, y] of r.cells) if (x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1) { inside = true; break; }
      if (!inside) continue;
      const dim = highlight && !matches(r);
      ctx.globalAlpha = dim ? 0.25 : 1;
      ctx.fillStyle = r.kind[2];
      if (r.cells.length === 1) {
        ctx.fillRect(px(c0[0]) + gap, py(c0[1]) + gap, scale - gap * 2, scale - gap * 2);
      } else {
        const xs = r.cells.map((c) => c[0]), ys = r.cells.map((c) => c[1]);
        const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
        ctx.fillRect(px(x0) + gap, py(y0) + gap, w * scale - gap * 2, h * scale - gap * 2);
        if (showLabels && scale >= 9 && (r.e.recipe || r.kind[0] === "furnace")) {
          ctx.fillStyle = "rgba(0,0,0,0.75)";
          ctx.font = Math.max(8, Math.min(12, scale * 0.9)) + "px sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          const label = (r.e.recipe || r.e.name).replace(/-/g, " ");
          wrapText(label, px(x0) + w * scale / 2, py(y0) + h * scale / 2, w * scale - 4, Math.max(8, Math.min(12, scale * 0.9)));
        }
      }
      if (scale >= 5) decorate(r);
      if (matches(r)) { ctx.globalAlpha = 1; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; outline(r); }
      drawn.add(r);
    }
    ctx.globalAlpha = 1;

    if (showWires && bp.wires) {
      const byId = new Map(ents.map((r) => [r.e.entity_number, r]));
      ctx.lineWidth = Math.max(1, scale / 12);
      for (const [a, ca, b, cb] of bp.wires) {
        const ra = byId.get(a), rb = byId.get(b); if (!ra || !rb) continue;
        ctx.strokeStyle = ca === 5 ? "rgba(255,140,60,0.8)" : ca === 1 ? "rgba(255,70,70,0.8)" : "rgba(70,220,90,0.8)";
        ctx.beginPath(); ctx.moveTo(px(ra.e.position.x), py(ra.e.position.y)); ctx.lineTo(px(rb.e.position.x), py(rb.e.position.y)); ctx.stroke();
      }
    }

    const sel = pinned || hover;
    if (sel) { ctx.strokeStyle = pinned ? "#ffd166" : "#ffffff"; ctx.lineWidth = 2; outline(sel); }
  }

  function wrapText(text, cx, cy, maxW, lh) {
    const words = text.split(" "), lines = []; let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    const y0 = cy - (lines.length - 1) * lh / 2;
    lines.forEach((l, i) => ctx.fillText(l, cx, y0 + i * lh));
  }

  function outline(r) {
    const xs = r.cells.map((c) => c[0]), ys = r.cells.map((c) => c[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
    ctx.strokeRect(px(x0) + 1, py(y0) + 1, w * scale - 2, h * scale - 2);
  }

  // Arrows on belts, pickup ticks on inserters, in/out marks on undergrounds.
  function decorate(r) {
    const e = r.e, k = r.kind[0];
    const d = (e.direction || 0) & 12, v = DIRS[d] || [0, -1];
    const [tx, ty] = r.cells[0];
    const cx = px(tx) + scale / 2, cy = py(ty) + scale / 2;
    if (k === "belt" || k === "underground" || k === "splitter") {
      ctx.fillStyle = k === "underground" ? (e.type === "input" ? "#3a2e08" : "#f5d76e") : "rgba(0,0,0,0.6)";
      const s = scale * 0.28;
      ctx.beginPath();
      ctx.moveTo(cx + v[0] * s, cy + v[1] * s);
      ctx.lineTo(cx - v[0] * s + v[1] * s, cy - v[1] * s - v[0] * s);
      ctx.lineTo(cx - v[0] * s - v[1] * s, cy - v[1] * s + v[0] * s);
      ctx.closePath(); ctx.fill();
      if (k === "splitter") {
        const [tx2, ty2] = r.cells[1] || r.cells[0];
        const cx2 = px(tx2) + scale / 2, cy2 = py(ty2) + scale / 2;
        ctx.beginPath();
        ctx.moveTo(cx2 + v[0] * s, cy2 + v[1] * s);
        ctx.lineTo(cx2 - v[0] * s + v[1] * s, cy2 - v[1] * s - v[0] * s);
        ctx.lineTo(cx2 - v[0] * s - v[1] * s, cy2 - v[1] * s + v[0] * s);
        ctx.closePath(); ctx.fill();
      }
    } else if (k === "inserter" || k === "long inserter") {
      // line from centre toward the pickup side, dot on the drop side
      const reach = k === "long inserter" ? 0.5 : 0.42;
      ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = Math.max(1, scale / 10);
      ctx.beginPath(); ctx.moveTo(cx - v[0] * scale * 0.3, cy - v[1] * scale * 0.3); ctx.lineTo(cx + v[0] * scale * reach, cy + v[1] * scale * reach); ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.8)";
      ctx.beginPath(); ctx.arc(cx - v[0] * scale * 0.3, cy - v[1] * scale * 0.3, Math.max(1, scale * 0.12), 0, Math.PI * 2); ctx.fill();
    } else if (k === "pole") {
      ctx.fillStyle = "#333"; ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, scale * 0.18), 0, Math.PI * 2); ctx.fill();
    }
  }

  function legend() {
    const el = document.getElementById("legend"); el.innerHTML = "";
    for (const k of KINDS) {
      if (k[0] === "other") continue;
      const sw = document.createElement("i"); sw.style.background = k[2];
      const lab = document.createElement("span"); lab.textContent = k[0];
      el.appendChild(sw); el.appendChild(lab);
    }
  }

  function tileAt(mx, my) { return [Math.floor((mx - ox) / scale), Math.floor((my - oy) / scale)]; }
  function entityAt(mx, my) {
    const [x, y] = tileAt(mx, my);
    const list = tiles.get(x + "," + y);
    if (!list) return null;
    // prefer the smallest footprint so inserters win over machines sharing a tile (they don't, but be safe)
    return list.slice().sort((a, b) => a.cells.length - b.cells.length)[0];
  }

  function describe(r) {
    const e = r.e, p = e.position;
    const d = e.direction || 0;
    let s = e.name + " #" + e.entity_number + "  @ (" + p.x + ", " + p.y + ")";
    if (e.recipe) s += "\nrecipe: " + e.recipe;
    if (e.direction !== undefined) s += "\ndirection: " + d + (DIRS[d & 12] ? " (" + ["N", "E", "S", "W"][(d & 12) / 4] + ")" : "");
    if (e.type) s += "\ntype: " + e.type;
    if (e.bar !== undefined) s += "\nbar: " + e.bar;
    if (e.request_filters) s += "\nrequests: " + (e.request_filters.sections || []).flatMap((s) => (s.filters || []).map((f) => f.name + (f.count ? " " + f.count : ""))).join(", ");
    if (e.control_behavior && e.control_behavior.circuit_condition) {
      const c = e.control_behavior.circuit_condition;
      s += "\ncircuit: " + ((c.first_signal || {}).name || "?") + " " + (c.comparator || "") + " " + (c.second_signal ? c.second_signal.name : c.constant);
    }
    return s;
  }

  function showDetail(r) {
    if (!r) { detail.innerHTML = '<div class="muted">Hover for details, click to pin. Drag to pan, wheel to zoom.</div>'; return; }
    const e = r.e;
    detail.innerHTML = "";
    const h = document.createElement("h3"); h.textContent = e.name + " #" + e.entity_number; detail.appendChild(h);
    const pre = document.createElement("pre"); pre.textContent = describe(r); detail.appendChild(pre);
    const b1 = document.createElement("button"); b1.textContent = "copy id"; b1.onclick = () => vscode.postMessage({ type: "copy", text: String(e.entity_number) });
    const b2 = document.createElement("button"); b2.textContent = "copy position"; b2.onclick = () => vscode.postMessage({ type: "copy", text: e.position.x + " " + e.position.y });
    const b3 = document.createElement("button"); b3.textContent = "copy JSON"; b3.onclick = () => vscode.postMessage({ type: "copy", text: JSON.stringify(e) });
    detail.appendChild(b1); detail.appendChild(b2); detail.appendChild(b3);
    const pre2 = document.createElement("pre"); pre2.textContent = JSON.stringify(e, null, 1); detail.appendChild(pre2);
  }

  // -- interaction ---------------------------------------------------------
  let dragging = false, lastX = 0, lastY = 0, moved = false;
  canvas.addEventListener("mousedown", (ev) => { dragging = true; moved = false; lastX = ev.clientX; lastY = ev.clientY; canvas.classList.add("dragging"); });
  window.addEventListener("mouseup", (ev) => {
    if (dragging && !moved) { pinned = entityAt(ev.offsetX, ev.offsetY); showDetail(pinned); draw(); }
    dragging = false; canvas.classList.remove("dragging");
  });
  canvas.addEventListener("mousemove", (ev) => {
    const r = canvas.getBoundingClientRect(); const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    if (dragging) {
      const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      ox += dx; oy += dy; lastX = ev.clientX; lastY = ev.clientY; draw(); return;
    }
    const [tx, ty] = tileAt(mx, my);
    coords.textContent = "tile " + tx + ", " + ty + "   " + scale.toFixed(1) + " px/tile";
    const h = entityAt(mx, my);
    if (h !== hover) { hover = h; draw(); if (!pinned) showDetail(h); }
    if (h) { tip.hidden = false; tip.textContent = describe(h).split("\n").slice(0, 2).join("  "); tip.style.left = (ev.clientX + 14) + "px"; tip.style.top = (ev.clientY + 14) + "px"; }
    else tip.hidden = true;
  });
  canvas.addEventListener("mouseleave", () => { tip.hidden = true; hover = null; draw(); });
  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const r = canvas.getBoundingClientRect(); const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    zoomAt(mx, my, ev.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });
  function zoomAt(mx, my, factor) {
    const ns = Math.max(0.5, Math.min(80, scale * factor));
    ox = mx - (mx - ox) * (ns / scale); oy = my - (my - oy) * (ns / scale); scale = ns; draw();
    coords.textContent = scale.toFixed(1) + " px/tile";
  }
  window.addEventListener("keydown", (ev) => {
    if (ev.target && ev.target.tagName === "INPUT") return;
    if (ev.key === "f" || ev.key === "F") { fit(); draw(); }
    if (ev.key === "Escape") { pinned = null; showDetail(hover); draw(); }
    if (ev.key === "+" || ev.key === "=") zoomAt(canvas.width / 2, canvas.height / 2, 1.25);
    if (ev.key === "-" || ev.key === "_") zoomAt(canvas.width / 2, canvas.height / 2, 1 / 1.25);
  });
  canvas.addEventListener("dblclick", (ev) => {
    const r = canvas.getBoundingClientRect(); zoomAt(ev.clientX - r.left, ev.clientY - r.top, 2);
  });
  document.getElementById("fit").onclick = () => { fit(); draw(); };
  document.getElementById("wires").onchange = (ev) => { showWires = ev.target.checked; draw(); };
  document.getElementById("labels").onchange = (ev) => { showLabels = ev.target.checked; draw(); };
  document.getElementById("gridlines").onchange = (ev) => { showGrid = ev.target.checked; draw(); };
  document.getElementById("search").oninput = (ev) => {
    highlight = ev.target.value.trim();
    const n = highlight ? ents.filter(matches).length : 0;
    vscode.postMessage({ type: "status", text: highlight ? n + " entities match '" + highlight + "'" : "" });
    draw();
  };
  window.addEventListener("resize", resize);
  window.addEventListener("message", (ev) => {
    const m = ev.data;
    if (m.type === "blueprint") { drop.hidden = true; resize(); load(m); }
    if (m.type === "error") { document.getElementById("file").textContent = "error: " + m.message; }
  });

  // -- getting a blueprint in without the extension host -------------------
  const drop = document.getElementById("drop");
  document.getElementById("mode").textContent = inVsCode
    ? "Running inside VS Code. The active editor's blueprint loads automatically; open… picks another file."
    : "Running standalone in a browser: decoding happens here, footprints use built-in defaults.";
  drop.hidden = false;

  async function decodeStandalone(text) {
    const t = text.trim();
    if (t.startsWith("{")) return JSON.parse(t);
    if (!t.startsWith("0")) throw new Error("not a blueprint string (expected leading '0')");
    const bin = Uint8Array.from(atob(t.slice(1)), (c) => c.charCodeAt(0));
    const ds = new DecompressionStream("deflate");
    const stream = new Blob([bin]).stream().pipeThrough(ds);
    return JSON.parse(await new Response(stream).text());
  }
  function firstBlueprint(obj) {
    if (obj.blueprint) return obj.blueprint;
    for (const e of (obj.blueprint_book || {}).blueprints || []) { const b = firstBlueprint(e); if (b) return b; }
    return null;
  }
  async function loadText(text, name) {
    try {
      const obj = await decodeStandalone(text);
      const b = firstBlueprint(obj);
      if (!b) throw new Error("no blueprint in this data");
      drop.hidden = true; resize(); load({ bp: b, footprints: footprints, file: name || "pasted string" });
    } catch (e) { document.getElementById("file").textContent = "error: " + (e.message || e); drop.hidden = false; }
  }
  document.getElementById("open").onclick = () => vscode.postMessage({ type: "open" });
  document.getElementById("filepick").onchange = (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    f.text().then((t) => loadText(t, f.name)); ev.target.value = "";
  };
  document.addEventListener("paste", (ev) => {
    const t = (ev.clipboardData || {}).getData ? ev.clipboardData.getData("text") : "";
    if (t && t.trim().length > 20 && (t.trim().startsWith("0") || t.trim().startsWith("{"))) { ev.preventDefault(); loadText(t); }
  });
  for (const el of [document.body, drop]) {
    el.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.hidden = false; drop.classList.add("over"); });
    el.addEventListener("dragleave", () => drop.classList.remove("over"));
    el.addEventListener("drop", (ev) => {
      ev.preventDefault(); drop.classList.remove("over");
      const f = ev.dataTransfer.files[0];
      if (f) f.text().then((t) => loadText(t, f.name));
      else { const t = ev.dataTransfer.getData("text"); if (t) loadText(t); else drop.hidden = !bp; }
    });
  }
  resize();
})();
