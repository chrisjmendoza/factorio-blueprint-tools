// Canvas viewer and patch editor for one Factorio blueprint.
//
// The page never modifies the blueprint itself. Edits accumulate as a patch
// (remove / recipe / add) exactly in the format fbp/patch.py accepts; export
// hands that patch to the Python tool, which validates, applies, renumbers and
// diffs. Rotations and moves are expressed as remove + add of a clone.
(function () {
  const inVsCode = typeof acquireVsCodeApi === "function";
  const vscode = inVsCode ? acquireVsCodeApi() : {
    postMessage(m) {
      if (m.type === "copy" && navigator.clipboard) navigator.clipboard.writeText(m.text);
      if (m.type === "open") document.getElementById("filepick").click();
      if (m.type === "export") download("patch.json", JSON.stringify(m.patch, null, 2));
    },
  };
  const $ = (id) => document.getElementById(id);
  const canvas = $("map"), ctx = canvas.getContext("2d");
  const tip = $("tip"), detail = $("detail"), coords = $("coords");

  // ---------------------------------------------------------------- data tables
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
  const DIRNAME = { 0: "N", 4: "E", 8: "S", 12: "W" };

  const TIER = {
    basic: { belt: "#c9a227", ug: "#7d6416", split: "#e6c352", reach: 5, label: "yellow" },
    fast: { belt: "#d24a3a", ug: "#7f2a20", split: "#e8746a", reach: 7, label: "red" },
    express: { belt: "#3b7fd6", ug: "#224b82", split: "#6ea3e6", reach: 9, label: "blue" },
    turbo: { belt: "#3fbf6b", ug: "#24703f", split: "#78d69a", reach: 11, label: "green" },
  };
  function tierOf(name) {
    if (name.startsWith("fast-")) return "fast";
    if (name.startsWith("express-")) return "express";
    if (name.startsWith("turbo-")) return "turbo";
    return "basic";
  }
  const KINDS = [
    ["belt", /-transport-belt$|^transport-belt$/, "#c9a227"],
    ["underground", /underground-belt$/, "#7d6416"],
    ["splitter", /splitter$/, "#e6c352"],
    // inserters in their in-game colours: yellow basic, red long-handed, blue fast, green bulk, white stack, grey burner
    ["long inserter", /^long-handed-inserter$/, "#d9503c"],
    ["fast inserter", /^fast-inserter$/, "#3d8be6"],
    ["bulk inserter", /^bulk-inserter$/, "#3fbf6b"],
    ["stack inserter", /^stack-inserter$/, "#e8e8e8"],
    ["burner inserter", /^burner-inserter$/, "#8a8a8a"],
    ["inserter", /inserter$/, "#e0c341"],
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
  function kindOf(name) {
    for (const k of KINDS) {
      if (!k[1].test(name)) continue;
      if (k[0] === "belt" || k[0] === "underground" || k[0] === "splitter") {
        const t = TIER[tierOf(name)];
        return [k[0], k[1], k[0] === "belt" ? t.belt : k[0] === "underground" ? t.ug : t.split];
      }
      return k;
    }
    return KINDS[KINDS.length - 1];
  }
  // Things one places by hand when patching a mall. Machines get a recipe from the side panel.
  const PALETTE = [
    "transport-belt", "fast-transport-belt", "express-transport-belt", "turbo-transport-belt",
    "underground-belt", "fast-underground-belt", "express-underground-belt", "turbo-underground-belt",
    "splitter", "fast-splitter", "express-splitter", "turbo-splitter",
    "inserter", "fast-inserter", "long-handed-inserter", "bulk-inserter",
    "wooden-chest", "iron-chest", "steel-chest", "passive-provider-chest", "requester-chest",
    "small-electric-pole", "medium-electric-pole", "big-electric-pole", "substation",
    "assembling-machine-1", "assembling-machine-2", "assembling-machine-3", "stone-furnace", "steel-furnace",
    "electric-furnace", "chemical-plant", "pipe", "pipe-to-ground", "pump", "storage-tank", "small-lamp",
  ];
  const DIRECTIONAL = /belt$|splitter$|inserter$|^pipe-to-ground$|^pump$|^boiler$|^steam-engine$|^offshore-pump$|^train-stop$|^rail-/;

  // ---------------------------------------------------------------- state
  let bp = null, base = [], footprints = {}, recipeList = [], fileName = "";
  let ents = [], tiles = new Map(), bbox = [0, 0, 1, 1];
  let scale = 12, ox = 0, oy = 0;
  let hover = null, pinned = null, highlight = "";
  let showWires = false, showLabels = true, showGrid = false, showTunnels = true;
  let editMode = false, nextTemp = -1;
  // edits: base entity number -> action. remove: true; recipe: string; replace: clone entity (rotation/move).
  const edits = { remove: new Set(), recipe: new Map(), replace: new Map(), add: [], history: [] };

  // ---------------------------------------------------------------- geometry
  function cellsOf(e) {
    if (UNMODELLED.has(e.name)) return [[Math.floor(e.position.x), Math.floor(e.position.y)]];
    let [w, h] = footprints[e.name] || BUILTIN[e.name] || [1, 1];
    const d = (e.direction || 0) & 12;
    if (d === 4 || d === 12) [w, h] = [h, w];
    const x0 = Math.floor(e.position.x - w / 2), y0 = Math.floor(e.position.y - h / 2);
    const out = [];
    for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) out.push([x0 + dx, y0 + dy]);
    return out;
  }
  function sizeOf(name, dir) {
    let [w, h] = footprints[name] || BUILTIN[name] || [1, 1];
    if ((dir & 12) === 4 || (dir & 12) === 12) [w, h] = [h, w];
    return [w, h];
  }
  // Centre position for an entity whose top-left tile is (tx, ty).
  function centreFor(name, dir, tx, ty) {
    const [w, h] = sizeOf(name, dir);
    return { x: tx + w / 2, y: ty + h / 2 };
  }
  function ugPair(r) {
    const e = r.e, d = (e.direction || 0) & 12, v = DIRS[d] || [0, -1];
    const want = e.type === "input" ? "output" : "input", step = e.type === "input" ? 1 : -1;
    const [x, y] = r.cells[0], reach = TIER[tierOf(e.name)].reach;
    for (let k = 1; k <= reach; k++) {
      const list = tiles.get((x + v[0] * k * step) + "," + (y + v[1] * k * step)) || [];
      for (const q of list) if (!q.removed && q.e.name === e.name && q.e.type === want && ((q.e.direction || 0) & 12) === d) return { pair: q, gap: k - 1 };
    }
    return null;
  }

  // ---------------------------------------------------------------- build view from base + edits
  function rebuild(keepView) {
    ents = [];
    for (const e of base) {
      const id = e.entity_number;
      if (edits.replace.has(id)) {
        ents.push({ e: edits.replace.get(id), cells: cellsOf(edits.replace.get(id)), kind: kindOf(e.name), changed: true, baseId: id });
        continue;
      }
      let shown = e;
      if (edits.recipe.has(id)) shown = Object.assign({}, e, { recipe: edits.recipe.get(id) });
      ents.push({ e: shown, cells: cellsOf(shown), kind: kindOf(e.name), removed: edits.remove.has(id),
        changed: edits.recipe.has(id), baseId: id });
    }
    for (const a of edits.add) ents.push({ e: a, cells: cellsOf(a), kind: kindOf(a.name), added: true, baseId: null });
    tiles = new Map();
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const r of ents) for (const [x, y] of r.cells) {
      const k = x + "," + y;
      if (!tiles.has(k)) tiles.set(k, []);
      tiles.get(k).push(r);
      if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y;
    }
    bbox = ents.length ? [minx, miny, maxx, maxy] : [0, 0, 1, 1];
    const n = edits.remove.size + edits.recipe.size + edits.replace.size + edits.add.length;
    $("patchcount").textContent = n ? n + " edit" + (n === 1 ? "" : "s") : "";
    $("file").textContent = (bp.label || fileName || "") + "  ·  " + base.length + " entities";
    if (!keepView) fit();
    draw();
  }

  function load(msg) {
    bp = msg.bp; footprints = msg.footprints || {}; recipeList = msg.recipes || []; fileName = msg.file || "";
    base = bp.entities || [];
    edits.remove.clear(); edits.recipe.clear(); edits.replace.clear(); edits.add.length = 0; edits.history.length = 0;
    nextTemp = -1; pinned = null; hover = null;
    fillRecipeOptions();
    legend();
    rebuild(false);
    showDetail(null);
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
  const px = (x) => ox + x * scale, py = (y) => oy + y * scale;
  function matches(r) {
    if (!highlight) return false;
    return r.e.name.includes(highlight) || (r.e.recipe || "").includes(highlight);
  }

  // ---------------------------------------------------------------- drawing
  function draw() {
    ctx.fillStyle = "#1b1b1d"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!bp) return;
    const vx0 = Math.floor(-ox / scale) - 1, vy0 = Math.floor(-oy / scale) - 1;
    const vx1 = Math.ceil((canvas.width - ox) / scale) + 1, vy1 = Math.ceil((canvas.height - oy) / scale) + 1;
    const gap = scale >= 6 ? 1 : 0;
    const visible = (r) => r.cells.some(([x, y]) => x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1);

    if (showGrid && scale >= 8) {
      ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = vx0; x <= vx1; x++) { ctx.moveTo(px(x) + 0.5, 0); ctx.lineTo(px(x) + 0.5, canvas.height); }
      for (let y = vy0; y <= vy1; y++) { ctx.moveTo(0, py(y) + 0.5); ctx.lineTo(canvas.width, py(y) + 0.5); }
      ctx.stroke();
    }

    for (const r of ents) {
      if (!visible(r)) continue;
      const dim = (highlight && !matches(r)) || r.removed;
      ctx.globalAlpha = r.removed ? 0.3 : dim ? 0.25 : 1;
      ctx.fillStyle = r.kind[2];
      const xs = r.cells.map((c) => c[0]), ys = r.cells.map((c) => c[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
      ctx.fillRect(px(x0) + gap, py(y0) + gap, w * scale - gap * 2, h * scale - gap * 2);
      if (r.cells.length > 1 && showLabels && scale >= 9 && (r.e.recipe || r.kind[0] === "furnace")) {
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        const fs = Math.max(8, Math.min(12, scale * 0.9));
        ctx.font = fs + "px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        wrapText((r.e.recipe || r.e.name).replace(/-/g, " "), px(x0) + w * scale / 2, py(y0) + h * scale / 2, w * scale - 4, fs);
      }
      if (scale >= 5 && !r.removed) decorate(r);
      ctx.globalAlpha = 1;
      if (r.removed) {   // red X
        ctx.strokeStyle = "#ff3b3b"; ctx.lineWidth = Math.max(1, scale / 8); ctx.beginPath();
        ctx.moveTo(px(x0) + 2, py(y0) + 2); ctx.lineTo(px(x0) + w * scale - 2, py(y0) + h * scale - 2);
        ctx.moveTo(px(x0) + w * scale - 2, py(y0) + 2); ctx.lineTo(px(x0) + 2, py(y0) + h * scale - 2); ctx.stroke();
      } else if (r.added) { ctx.strokeStyle = "#39d353"; ctx.lineWidth = 2; outline(r); }
      else if (r.changed) { ctx.strokeStyle = "#ff9f1c"; ctx.lineWidth = 2; outline(r); }
      if (matches(r)) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; outline(r); }
    }

    if (showWires && bp.wires) {
      const byId = new Map(ents.filter((r) => r.baseId !== null).map((r) => [r.baseId, r]));
      ctx.lineWidth = Math.max(1, scale / 12);
      for (const [a, ca, b] of bp.wires) {
        const ra = byId.get(a), rb = byId.get(b); if (!ra || !rb) continue;
        ctx.strokeStyle = ca === 5 ? "rgba(255,140,60,0.8)" : ca === 1 ? "rgba(255,70,70,0.8)" : "rgba(70,220,90,0.8)";
        ctx.beginPath(); ctx.moveTo(px(ra.e.position.x), py(ra.e.position.y)); ctx.lineTo(px(rb.e.position.x), py(rb.e.position.y)); ctx.stroke();
      }
    }

    if (showTunnels && scale >= 4) {
      for (const r of ents) {
        if (r.kind[0] !== "underground" || r.removed || !visible(r)) continue;
        if (r.e.type === "input") {
          const p = ugPair(r);
          if (p) {
            const [x, y] = r.cells[0], [x2, y2] = p.pair.cells[0];
            ctx.setLineDash([Math.max(2, scale / 3), Math.max(2, scale / 3)]);
            ctx.lineWidth = Math.max(1, scale / 6); ctx.strokeStyle = TIER[tierOf(r.e.name)].belt;
            ctx.beginPath(); ctx.moveTo(px(x) + scale / 2, py(y) + scale / 2); ctx.lineTo(px(x2) + scale / 2, py(y2) + scale / 2); ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        if (!ugPair(r)) { ctx.strokeStyle = "#ff3b3b"; ctx.lineWidth = 2; outline(r); }
      }
    }

    // placement ghost
    if (editMode && ghost && hoverTile) {
      const occupied = ghost.cells.some(([x, y]) => (tiles.get(x + "," + y) || []).some((q) => !q.removed));
      ctx.globalAlpha = 0.6; ctx.fillStyle = occupied ? "#ff3b3b" : kindOf(ghost.e.name)[2];
      for (const [x, y] of ghost.cells) ctx.fillRect(px(x) + 1, py(y) + 1, scale - 2, scale - 2);
      ctx.globalAlpha = 1;
      if (scale >= 5) decorate(ghost);
    }

    const sel = pinned || hover;
    if (sel) {
      ctx.strokeStyle = pinned ? "#ffd166" : "#ffffff"; ctx.lineWidth = 2; outline(sel);
      if (sel.kind[0] === "underground") {
        const e = sel.e, d = (e.direction || 0) & 12, v = DIRS[d] || [0, -1], step = e.type === "input" ? 1 : -1;
        const [x, y] = sel.cells[0], reach = TIER[tierOf(e.name)].reach;
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        for (let k = 1; k <= reach; k++) ctx.fillRect(px(x + v[0] * k * step), py(y + v[1] * k * step), scale, scale);
        const p = ugPair(sel);
        if (p) { ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 2; outline(p.pair); }
      }
    }
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
  function decorate(r) {
    const e = r.e, k = r.kind[0];
    const d = (e.direction || 0) & 12, v = DIRS[d] || [0, -1];
    const [tx, ty] = r.cells[0];
    const cx = px(tx) + scale / 2, cy = py(ty) + scale / 2;
    const tri = (x, y) => {
      const s = scale * 0.28;
      ctx.beginPath(); ctx.moveTo(x + v[0] * s, y + v[1] * s);
      ctx.lineTo(x - v[0] * s + v[1] * s, y - v[1] * s - v[0] * s);
      ctx.lineTo(x - v[0] * s - v[1] * s, y - v[1] * s + v[0] * s); ctx.closePath(); ctx.fill();
    };
    if (k === "belt" || k === "underground" || k === "splitter") {
      ctx.fillStyle = k === "underground" ? (e.type === "input" ? "#3a2e08" : "#f5d76e") : "rgba(0,0,0,0.6)";
      tri(cx, cy);
      if (k === "splitter" && r.cells[1]) tri(px(r.cells[1][0]) + scale / 2, py(r.cells[1][1]) + scale / 2);
    } else if (k.endsWith("inserter")) {
      // arrow in the direction the item travels: from the pickup side (where `direction` points) to the drop side
      // One arrow, tail at the pickup side, head at the drop side. Long-handed: longer shaft, a bar at the tail.
      const long = k === "long inserter";
      const tail = long ? 0.42 : 0.32, headLen = Math.max(2, scale * 0.22), halfW = headLen * 0.42;
      const sx = cx + v[0] * scale * tail, sy = cy + v[1] * scale * tail;                 // pickup end
      const ex = cx - v[0] * scale * (long ? 0.42 : 0.34), ey = cy - v[1] * scale * (long ? 0.42 : 0.34);   // drop tip
      const bx = ex + v[0] * headLen, by = ey + v[1] * headLen;                          // head base
      const ink = "rgba(0,0,0,0.85)";
      ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = Math.max(1.2, scale / 12); ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(bx, by); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex, ey);
      ctx.lineTo(bx + v[1] * halfW, by - v[0] * halfW);
      ctx.lineTo(bx - v[1] * halfW, by + v[0] * halfW); ctx.closePath(); ctx.fill();
      if (long && scale >= 8) {   // tail bar: "reaches over the next tile"
        ctx.beginPath(); ctx.moveTo(sx + v[1] * halfW, sy - v[0] * halfW); ctx.lineTo(sx - v[1] * halfW, sy + v[0] * halfW); ctx.stroke();
      }
      ctx.lineCap = "butt";
    } else if (k === "pole") {
      ctx.fillStyle = "#333"; ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, scale * 0.18), 0, Math.PI * 2); ctx.fill();
    } else if (e.name === "pipe-to-ground" || e.name === "pump") {
      ctx.fillStyle = "rgba(0,0,0,0.6)"; tri(cx, cy);
    }
  }

  function legend() {
    const el = $("legend"); el.innerHTML = "";
    const row = (color, text) => {
      const sw = document.createElement("i"); sw.style.background = color;
      const lab = document.createElement("span"); lab.textContent = text; el.appendChild(sw); el.appendChild(lab);
    };
    for (const [name, t] of Object.entries(TIER)) row(t.belt, name + " belt (" + t.label + "), underground gap " + (t.reach - 1));
    for (const k of KINDS) if (!["other", "belt", "underground", "splitter"].includes(k[0])) row(k[2], k[0]);
    row("#39d353", "added (edit)"); row("#ff9f1c", "recipe or rotation changed (edit)"); row("#ff3b3b", "removed (edit) / unpaired underground");
  }

  // ---------------------------------------------------------------- picking and describing
  function tileAt(mx, my) { return [Math.floor((mx - ox) / scale), Math.floor((my - oy) / scale)]; }
  function entityAt(mx, my) {
    const [x, y] = tileAt(mx, my);
    const list = tiles.get(x + "," + y);
    if (!list) return null;
    return list.slice().sort((a, b) => (a.removed ? 1 : 0) - (b.removed ? 1 : 0) || a.cells.length - b.cells.length)[0];
  }
  function describe(r) {
    const e = r.e, p = e.position, d = e.direction || 0;
    let s = e.name + (r.baseId !== null ? " #" + r.baseId : " (new)") + "  @ (" + p.x + ", " + p.y + ")";
    if (r.removed) s += "\nMARKED FOR REMOVAL";
    if (r.added) s += "\nADDED by this patch";
    if (r.changed && !r.added) s += "\nCHANGED by this patch";
    if (e.recipe) s += "\nrecipe: " + e.recipe;
    if (e.direction !== undefined) s += "\ndirection: " + d + (DIRNAME[d & 12] ? " (" + DIRNAME[d & 12] + ")" : "");
    if (e.type) s += "\ntype: " + e.type + (e.type === "input" ? " (entrance)" : " (exit)");
    if (["belt", "underground", "splitter"].includes(r.kind[0])) s += "\ntier: " + tierOf(e.name) + " (" + TIER[tierOf(e.name)].label + ")";
    if (r.kind[0] === "underground") {
      const q = ugPair(r);
      s += q ? "\npair: " + (q.pair.baseId !== null ? "#" + q.pair.baseId : "(new)") + " @ (" + q.pair.e.position.x + ", " + q.pair.e.position.y + "), gap " + q.gap + " of max " + (TIER[tierOf(e.name)].reach - 1)
             : "\npair: NONE within reach " + (TIER[tierOf(e.name)].reach - 1);
    }
    if (e.bar !== undefined) s += "\nbar: " + e.bar;
    if (e.request_filters) s += "\nrequests: " + (e.request_filters.sections || []).flatMap((sec) => (sec.filters || []).map((f) => f.name + (f.count ? " " + f.count : ""))).join(", ");
    if (e.control_behavior && e.control_behavior.circuit_condition) {
      const c = e.control_behavior.circuit_condition;
      s += "\ncircuit: " + ((c.first_signal || {}).name || "?") + " " + (c.comparator || "") + " " + (c.second_signal ? c.second_signal.name : c.constant);
    }
    return s;
  }

  function button(label, fn, title) {
    const b = document.createElement("button"); b.textContent = label; b.onclick = fn; if (title) b.title = title; return b;
  }
  function showDetail(r) {
    detail.innerHTML = "";
    if (!r) {
      const d = document.createElement("div"); d.className = "muted";
      d.textContent = editMode
        ? "Edit mode. Click an entity, then Delete removes, R rotates, T flips an underground. Pick a palette item and click a tile to place. Ctrl+Z undoes."
        : "Hover for details, click to pin. Drag to pan, wheel to zoom, F to fit.";
      detail.appendChild(d); return;
    }
    const e = r.e;
    const h = document.createElement("h3"); h.textContent = e.name + (r.baseId !== null ? " #" + r.baseId : " (new)"); detail.appendChild(h);
    const pre = document.createElement("pre"); pre.textContent = describe(r); detail.appendChild(pre);
    detail.appendChild(button("copy id", () => vscode.postMessage({ type: "copy", text: String(r.baseId) })));
    detail.appendChild(button("copy position", () => vscode.postMessage({ type: "copy", text: e.position.x + " " + e.position.y })));
    detail.appendChild(button("copy JSON", () => vscode.postMessage({ type: "copy", text: JSON.stringify(e) })));
    if (editMode) {
      detail.appendChild(document.createElement("br"));
      detail.appendChild(button(r.removed ? "restore" : "remove", () => act({ kind: "toggleRemove", r }), "Delete"));
      if (DIRECTIONAL.test(e.name) || r.cells.length > 1) detail.appendChild(button("rotate", () => act({ kind: "rotate", r }), "R"));
      if (r.kind[0] === "underground") detail.appendChild(button("flip in/out", () => act({ kind: "flip", r }), "T"));
      if (r.kind[0] === "crafter" || r.kind[0] === "furnace") {
        const sel = document.createElement("select"); sel.style.maxWidth = "100%";
        const opt0 = document.createElement("option"); opt0.value = ""; opt0.textContent = "(recipe: " + (e.recipe || "none") + ")"; sel.appendChild(opt0);
        for (const name of recipeList) { const o = document.createElement("option"); o.value = name; o.textContent = name; sel.appendChild(o); }
        if (!recipeList.length) { const inp = document.createElement("input"); inp.placeholder = "recipe name"; inp.onchange = () => act({ kind: "recipe", r, recipe: inp.value.trim() }); detail.appendChild(inp); }
        else { sel.onchange = () => { if (sel.value) act({ kind: "recipe", r, recipe: sel.value }); }; detail.appendChild(sel); }
      }
    }
    const pre2 = document.createElement("pre"); pre2.textContent = JSON.stringify(e, null, 1); detail.appendChild(pre2);
  }

  // ---------------------------------------------------------------- editing
  function clone(e) { return JSON.parse(JSON.stringify(e)); }
  function currentOf(r) { return r.baseId !== null && edits.replace.has(r.baseId) ? edits.replace.get(r.baseId) : r.e; }

  function act(a) {
    const snapshot = { remove: new Set(edits.remove), recipe: new Map(edits.recipe), replace: new Map(edits.replace), add: edits.add.slice() };
    edits.history.push(snapshot);
    if (a.kind === "toggleRemove") {
      if (a.r.added) edits.add.splice(edits.add.indexOf(a.r.e), 1);
      else if (edits.remove.has(a.r.baseId)) edits.remove.delete(a.r.baseId);
      else { edits.remove.add(a.r.baseId); edits.recipe.delete(a.r.baseId); edits.replace.delete(a.r.baseId); }
    } else if (a.kind === "rotate" || a.kind === "flip") {
      const target = a.r.added ? a.r.e : clone(currentOf(a.r));
      if (a.kind === "rotate") target.direction = ((target.direction || 0) + 4) % 16;
      else target.type = target.type === "input" ? "output" : "input";
      if (!a.r.added) { edits.replace.set(a.r.baseId, target); edits.remove.delete(a.r.baseId); }
    } else if (a.kind === "recipe") {
      if (a.r.added) { a.r.e.recipe = a.recipe; a.r.e.recipe_quality = "normal"; }
      else if (edits.replace.has(a.r.baseId)) { edits.replace.get(a.r.baseId).recipe = a.recipe; }
      else edits.recipe.set(a.r.baseId, a.recipe);
    } else if (a.kind === "place") {
      edits.add.push(a.entity);
    }
    const keepId = pinned ? pinned.baseId : null, keepAdded = pinned && pinned.added ? pinned.e : null;
    rebuild(true);
    pinned = ents.find((r) => (keepId !== null && r.baseId === keepId) || (keepAdded && r.e === keepAdded)) || null;
    showDetail(pinned);
  }
  function undo() {
    const s = edits.history.pop(); if (!s) return;
    edits.remove.clear(); for (const x of s.remove) edits.remove.add(x);
    edits.recipe.clear(); for (const [k, v] of s.recipe) edits.recipe.set(k, v);
    edits.replace.clear(); for (const [k, v] of s.replace) edits.replace.set(k, v);
    edits.add.length = 0; edits.add.push(...s.add);
    pinned = null; rebuild(true); showDetail(null);
  }
  function buildPatch() {
    const remove = new Set(edits.remove);
    const add = edits.add.map(clone);
    for (const [id, rep] of edits.replace) { remove.add(id); const c = clone(rep); delete c.entity_number; add.push(c); }
    const recipe = {}; for (const [id, rec] of edits.recipe) if (!remove.has(id)) recipe[String(id)] = rec;
    const patch = { _comment: "Made in the fbp viewer for '" + (bp.label || fileName) + "'. Rotations are remove+add of a clone." };
    if (remove.size) patch.remove = [...remove].sort((a, b) => a - b);
    if (Object.keys(recipe).length) patch.recipe = recipe;
    if (add.length) patch.add = add;
    return patch;
  }
  function download(name, text) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = name; a.click();
  }

  // palette ghost
  let ghost = null, hoverTile = null;
  function paletteEntity(tx, ty) {
    const name = $("palette").value; if (!name) return null;
    const dir = parseInt($("pdir").value, 10);
    const e = { name, position: centreFor(name, dir, tx, ty) };
    if (DIRECTIONAL.test(name) || sizeOf(name, 0)[0] !== sizeOf(name, 0)[1]) e.direction = dir;
    if (name.endsWith("underground-belt")) e.type = $("ptype").value;
    if (/^assembling-machine|^chemical-plant$|furnace$/.test(name)) e.recipe_quality = "normal";
    if (/chest$/.test(name) && !/requester|provider/.test(name)) e.bar = 1;
    return e;
  }
  function refreshGhost() {
    ghost = null;
    if (!editMode || !hoverTile) return;
    const e = paletteEntity(hoverTile[0], hoverTile[1]);
    if (e) ghost = { e, cells: cellsOf(e), kind: kindOf(e.name) };
  }

  // ---------------------------------------------------------------- interaction
  let dragging = false, lastX = 0, lastY = 0, moved = false;
  canvas.addEventListener("mousedown", (ev) => { dragging = true; moved = false; lastX = ev.clientX; lastY = ev.clientY; canvas.classList.add("dragging"); });
  window.addEventListener("mouseup", (ev) => {
    if (dragging && !moved && ev.target === canvas) {
      if (editMode && ghost) {
        const occupied = ghost.cells.some(([x, y]) => (tiles.get(x + "," + y) || []).some((q) => !q.removed));
        if (occupied) vscode.postMessage({ type: "status", text: "tile occupied: remove what is there first" });
        else { act({ kind: "place", entity: ghost.e }); refreshGhost(); }
      } else {
        pinned = entityAt(ev.offsetX, ev.offsetY); showDetail(pinned); draw();
      }
    }
    dragging = false; canvas.classList.remove("dragging");
  });
  canvas.addEventListener("mousemove", (ev) => {
    const r = canvas.getBoundingClientRect(); const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    if (dragging) {
      const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      ox += dx; oy += dy; lastX = ev.clientX; lastY = ev.clientY; draw(); return;
    }
    const t = tileAt(mx, my); hoverTile = t;
    coords.textContent = "tile " + t[0] + ", " + t[1] + "   " + scale.toFixed(1) + " px/tile";
    const h = entityAt(mx, my);
    if (h !== hover) { hover = h; if (!pinned) showDetail(h); }
    refreshGhost(); draw();
    if (h) { tip.hidden = false; tip.textContent = describe(h).split("\n").slice(0, 2).join("  "); tip.style.left = (ev.clientX + 14) + "px"; tip.style.top = (ev.clientY + 14) + "px"; }
    else tip.hidden = true;
  });
  canvas.addEventListener("mouseleave", () => { tip.hidden = true; hover = null; hoverTile = null; ghost = null; draw(); });
  function zoomAt(mx, my, factor) {
    const ns = Math.max(0.5, Math.min(80, scale * factor));
    ox = mx - (mx - ox) * (ns / scale); oy = my - (my - oy) * (ns / scale); scale = ns; draw();
    coords.textContent = scale.toFixed(1) + " px/tile";
  }
  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAt(ev.clientX - r.left, ev.clientY - r.top, ev.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });
  canvas.addEventListener("dblclick", (ev) => { const r = canvas.getBoundingClientRect(); zoomAt(ev.clientX - r.left, ev.clientY - r.top, 2); });
  window.addEventListener("keydown", (ev) => {
    if (ev.target && (ev.target.tagName === "INPUT" || ev.target.tagName === "SELECT")) return;
    if (ev.key === "f" || ev.key === "F") { fit(); draw(); }
    if (ev.key === "Escape") { pinned = null; $("palette").value = ""; refreshGhost(); showDetail(hover); draw(); }
    if (ev.key === "+" || ev.key === "=") zoomAt(canvas.width / 2, canvas.height / 2, 1.25);
    if (ev.key === "-" || ev.key === "_") zoomAt(canvas.width / 2, canvas.height / 2, 1 / 1.25);
    if (!editMode) return;
    if ((ev.key === "z" || ev.key === "Z") && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); undo(); }
    if (ev.key === "Delete" || ev.key === "Backspace") { if (pinned) act({ kind: "toggleRemove", r: pinned }); }
    if (ev.key === "r" || ev.key === "R") {
      if (pinned) act({ kind: "rotate", r: pinned });
      else { const d = $("pdir"); d.value = String((parseInt(d.value, 10) + 4) % 16); refreshGhost(); draw(); }
    }
    if ((ev.key === "t" || ev.key === "T") && pinned && pinned.kind[0] === "underground") act({ kind: "flip", r: pinned });
  });

  // toolbar
  $("fit").onclick = () => { fit(); draw(); };
  $("wires").onchange = (ev) => { showWires = ev.target.checked; draw(); };
  $("labels").onchange = (ev) => { showLabels = ev.target.checked; draw(); };
  $("gridlines").onchange = (ev) => { showGrid = ev.target.checked; draw(); };
  $("tunnels").onchange = (ev) => { showTunnels = ev.target.checked; draw(); };
  $("editmode").onchange = (ev) => { editMode = ev.target.checked; document.body.classList.toggle("editing", editMode); refreshGhost(); showDetail(pinned); draw(); };
  $("search").oninput = (ev) => {
    highlight = ev.target.value.trim();
    const n = highlight ? ents.filter(matches).length : 0;
    vscode.postMessage({ type: "status", text: highlight ? n + " entities match '" + highlight + "'" : "" });
    draw();
  };
  $("palette").onchange = () => { $("ptype").hidden = !$("palette").value.endsWith("underground-belt"); refreshGhost(); draw(); };
  $("pdir").onchange = () => { refreshGhost(); draw(); };
  $("ptype").onchange = () => { refreshGhost(); draw(); };
  $("undo").onclick = undo;
  $("clear").onclick = () => { if (edits.history.length) { edits.history.push(null); } edits.remove.clear(); edits.recipe.clear(); edits.replace.clear(); edits.add.length = 0; edits.history.length = 0; pinned = null; rebuild(true); showDetail(null); };
  $("copypatch").onclick = () => vscode.postMessage({ type: "copy", text: JSON.stringify(buildPatch(), null, 2) });
  $("export").onclick = () => {
    const p = buildPatch();
    if (!p.remove && !p.recipe && !p.add) { vscode.postMessage({ type: "status", text: "nothing to export" }); return; }
    vscode.postMessage({ type: "export", patch: p });
  };
  for (const name of PALETTE) { const o = document.createElement("option"); o.value = name; o.textContent = name; $("palette").appendChild(o); }
  function fillRecipeOptions() { /* options are built per selection in showDetail */ }

  // ---------------------------------------------------------------- loading without the extension host
  const drop = $("drop");
  $("mode").textContent = inVsCode
    ? "Running inside VS Code. The active editor's blueprint loads automatically; open… picks another file. Export runs fbp patch and fbp diff."
    : "Running standalone in a browser: decoding happens here, footprints use built-in defaults, export downloads the patch JSON for `fbp patch`.";
  drop.hidden = false;
  async function decodeStandalone(text) {
    const t = text.trim();
    if (t.startsWith("{")) return JSON.parse(t);
    if (!t.startsWith("0")) throw new Error("not a blueprint string (expected leading '0')");
    const bin = Uint8Array.from(atob(t.slice(1)), (c) => c.charCodeAt(0));
    const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream("deflate"));
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
      drop.hidden = true; resize(); load({ bp: b, footprints, recipes: recipeList, file: name || "pasted string" });
    } catch (e) { $("file").textContent = "error: " + (e.message || e); drop.hidden = false; }
  }
  $("open").onclick = () => vscode.postMessage({ type: "open" });
  $("filepick").onchange = (ev) => { const f = ev.target.files[0]; if (f) f.text().then((t) => loadText(t, f.name)); ev.target.value = ""; };
  document.addEventListener("paste", (ev) => {
    if (ev.target && (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA")) return;
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

  window.addEventListener("resize", resize);
  window.addEventListener("message", (ev) => {
    const m = ev.data;
    if (m.type === "blueprint") { drop.hidden = true; resize(); load(m); }
    if (m.type === "error") { $("file").textContent = "error: " + m.message; }
    if (m.type === "exported") { vscode.postMessage({ type: "status", text: "exported " + m.file }); }
  });
  resize();
})();
