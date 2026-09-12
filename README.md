# Factorio blueprint tools (fbp)

Command line tools for working on Factorio 2.0 blueprint strings outside the
game: decode and re-encode them, draw a region as an ASCII map, trace what
feeds a machine, find machines whose ingredients nothing nearby supplies, and
apply small edits without hand-editing 500 KB of JSON.

Written for base strings in the tens of thousands of entities. Everything runs
in a second or two on the full base export.

## Install

```
pip install -e ".[dev]"      # from this folder; gives you the `fbp` command
```

Or run without installing: `python -m fbp ...` from this folder.

## Commands

```
fbp info FILE [--counts] [--recipes]         summary, entity counts, recipe counts
fbp decode FILE [-o out.json]                blueprint string -> JSON
fbp encode FILE.json [-o out.txt]            JSON -> blueprint string
fbp render FILE [x0 y0 x1 y1] [--entities]   ASCII map of a region (whole print if no box)
fbp render FILE --png out.png [--scale N]    tile-coloured PNG of the whole print
fbp find FILE --recipe R | --name N          list matching entities with ids and positions
fbp trace FILE --recipe R | --id N ...       inputs, outputs and belt lines of a machine
fbp trace FILE --at X Y                      a belt tile: what flows in, and every consumer downstream
fbp check FILE [--recipe R]                  flag crafters missing an ingredient source; lane-mix warnings
fbp lint FILE [--only CODE ...] [--strict]   belts and inserters that point at nothing useful
fbp diff A B                                 what changed between two versions (machines, check, lint, lanes)
fbp patch FILE patch.json -o out.txt         remove / re-recipe / add entities, write new string
fbp crop FILE x0 y0 x1 y1 -o out.txt         cut a region out as its own blueprint
fbp gamedata [--dump PATH]                   rebuild data/gamedata.json from the game's dump
fbp recipe NAME ...                          show recipes from the loaded data
```

`FILE` may be a blueprint string (a `.txt` as exported from the game) or a
decoded `.json`. Books are read; commands operate on the first blueprint.

## How tracing works

Positions in the string are entity centres; a 3x3 machine at (114.5, 77.5)
covers x 113..115, y 76..78. An inserter's `direction` points at its pickup
tile and it drops on the opposite side; long-handed inserters reach two tiles.
Belts are followed tile to tile through underground pairs and splitters.

What a belt carries is inferred, not read: an assembler feeding it contributes
its recipe products, a furnace contributes every smelting product, a filtered
requester chest contributes its filters, and anything else (a plain chest, a
belt that enters from outside the blueprint) is "unknown". `check` reports a
machine as a **problem** only when an ingredient has no plausible source and
no unknown source is present; otherwise it is **inconclusive**. Fluids are not
traced, so machines whose recipe is fluid-only on a side are not judged on
that side.

## Verifying an edit

The intended workflow after any patch is `fbp diff BEFORE AFTER`. It matches
machines by position and lists every one whose recipe, inputs or outputs
changed, each with an ingredient status, then shows which `check` problems,
`lint` findings and lane-mix warnings appeared or disappeared. Only the
machines you meant to touch should be listed, and nothing should be `NEW:`.

`fbp trace FILE --at X Y` is the tool for the question "if I drop an item on
this tile, where does it go?": it prints the upstream line and every consumer
downstream, following undergrounds and splitters. Use it before sideloading.

**Lane mix.** A mall belt is meant to carry one item per lane. `check` warns
when inserters put two different items on the same lane of one line. Many
real bases do this on purpose (this one has 19 such lanes), so treat the
warnings as a before/after comparison rather than an absolute.

**Lint codes:** `belt-dead-end`, `belt-into-entity`, `underground-unpaired`,
`splitter-no-input`, `splitter-no-output`, `inserter-from-empty`,
`inserter-to-ground`, `inserter-from-useless`, `inserter-to-useless`.
Undergrounds at the edge of an export whose partner was outside the selection
show up as unpaired; that is information, not an error.

## Game data

Recipes and footprints come from the game itself. With Factorio closed:

```
"C:\Games\Steam\steamapps\common\Factorio\bin\x64\factorio.exe" --dump-data
fbp gamedata
```

The first line writes `%APPDATA%\Factorio\script-output\data-raw-dump.json`
(about 28 MB, includes your enabled mods). The second boils it down to
`data/gamedata.json`, which is committed so the tool works without the dump.
Re-run both after a game update or a mod change that touches recipes. If
neither file exists a tiny built-in table covers a dozen mall recipes and
everything else is reported as unknown rather than guessed.

## Patch format

```json
{
  "remove": [1057, 885],
  "recipe": {"883": "copper-cable"},
  "add": [
    {"name": "inserter", "position": {"x": 113.5, "y": 75.5}, "direction": 0},
    {"name": "transport-belt", "position": {"x": 111.5, "y": 77.5}, "direction": 8}
  ]
}
```

Ids refer to the input file (get them from `find` or `trace`). New entities
may not overlap existing ones. Removing an entity that has circuit or copper
wires is refused unless `"drop_wires": true`. Output is renumbered and wires
are remapped.

## VS Code viewer

`vscode/` is a small extension that draws the active blueprint string on a
pan-and-zoom canvas. It decodes with Node's zlib in the extension host, reads
footprints from `data/gamedata.json`, and redraws whenever the file is saved.

- **fbp: Open blueprint viewer** (editor title button, or the command palette
  with a `.txt`/`.fbp` open). Drag to pan, wheel to zoom, `F` to fit. Hover
  for name, id, position, recipe and direction; click to pin an entity and
  copy its id, position or JSON for a patch file. The search box highlights
  entities by name or recipe. Toggles for copper/circuit wires, recipe
  labels and a tile grid.
- **fbp: Run supply check on this file** and **fbp: Trace machines by
  recipe** run the Python tool and print to an "fbp" output channel.

Install for development by linking the folder into your extensions directory
(no build step, plain JavaScript):

```
mklink /J "%USERPROFILE%\.vscode\extensions\chrisjmendoza.fbp-viewer-0.1.0" "D:\Dev\factorio mods\blueprint-tools\vscode"
```

then reload the window. Settings: `fbp.python` (interpreter) and
`fbp.toolsPath` (folder holding the `fbp` package; defaults to this repo).

## Layout

```
vscode/         VS Code extension: extension.js (host), media/viewer.* (webview)
fbp/
  codec.py      string <-> JSON, books
  model.py      footprints, tile index, inserter geometry
  gamedata.py   recipe and footprint data (dump -> slim file -> fallback)
  render.py     ASCII and PNG
  trace.py      belt graph, feeders, consumers, item inference
  check.py      supply check
  patch.py      apply / crop
  cli.py        argparse front end
data/gamedata.json
tests/          pytest; fixtures/mall.txt is a crop of a real mall
```

## Tests

```
pytest
```
