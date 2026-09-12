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
fbp check FILE [--recipe R]                  flag crafters missing an ingredient source
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

## Layout

```
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
