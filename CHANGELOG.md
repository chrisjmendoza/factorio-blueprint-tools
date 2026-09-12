# Changelog

All notable changes to fbp are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- The viewer computes lane flow in the page (`vscode/media/flow.js`, a port
  of `fbp/flow.py` checked against it by a test on a real fixture), with game
  data shipped as `gamedata.js`. Flow, feeds and machine status therefore
  work in any browser, not only in the VS Code panel; standalone pages keep
  feeds in local storage. The panel still saves `<name>.feeds.json` and
  offers export.
- `fbp flow`: lane-level item flow. Computes what can be on the left and
  right lane of every belt from inserter drops (far lane), curves,
  sideloads (near lane), underground half-blocking, splitter filters,
  crafter products, furnace smelting and chest relays, to a fixed point with
  a worklist. Machines get a status: ok, missing inputs, or unknown.
- Edge feeds: declare items entering the print from outside in
  `<name>.feeds.json` (`{"x","y","items","lane"}`), so a furnace column fed
  iron ore resolves to iron plate all the way down the bus.
- Viewer "flow" toggle paints each lane with its items and outlines machines
  green, red or dashed grey by status; hover shows lane contents and what a
  machine receives and makes. "feed" mode declares an input by picking an
  item and clicking a belt; right-click a feed marker to remove it. Feeds
  save beside the blueprint and the flow recomputes.
- Viewer edit mode: mark entities for removal, rotate, flip underground
  ends, change a machine's recipe from the game data list, and place new
  belts, undergrounds, splitters, inserters, chests, poles, machines and
  pipes from a palette with a placement ghost and occupancy warning. Edits
  accumulate as a patch in the `fbp patch` format; undo, clear and copy.
- Editing ergonomics: right-click removes or restores (as in the game),
  clicking a placed item with a palette selection replaces it, shift-drag
  paints a run of belts or inserters, placing a machine clears the palette,
  and a change list in the side panel reverts any single edit. Undo is one
  step at a time and "clear all" is itself undoable.
- Export from the viewer writes the patch beside the source under
  `patches/`, runs `fbp patch` into a new `<name> - edit N.txt` (never
  overwriting the source), then `fbp diff` and `fbp check`, shows the result
  in the output channel and reloads the viewer on the new file. Standalone in
  a browser, export downloads the patch JSON instead.
- Inserters are coloured by type as in game (yellow, red long-handed, blue
  fast, green bulk, white stack) and drawn as an arrow in the direction the
  item travels, with a second chevron on long-handed inserters.
- Viewer: belts, undergrounds and splitters are coloured by tier (yellow,
  red, blue, green for turbo), undergrounds draw a dashed tunnel line to
  their partner, unpaired ends are outlined red, and hovering an underground
  shades every tile it could reach and names its partner and gap. The PNG
  render uses the same tier colours.
- VS Code extension in `vscode/`: pan-and-zoom canvas viewer for the active
  blueprint string with hover details, click-to-pin with copy id/position/JSON,
  search highlighting, wire overlay, recipe labels and a tile grid. Commands
  to run `check` and `trace` from the editor into an output channel.
- The viewer page also runs standalone in any browser: drop a `.txt`, paste a
  string, or use the open button. Decoding uses the browser's built-in deflate
  stream.
- `fbp lint`: geometry checks that need no recipe data. Belt dead ends, belts
  pointing into machines, unpaired undergrounds, starved splitters, inserters
  that pick from or drop onto nothing or onto poles and lamps.
- `fbp diff A B`: compares two versions of a blueprint by machine position and
  reports changed recipes, inputs and outputs with ingredient status, plus
  check problems, lint findings and lane-mix warnings that appeared or went
  away. Exit code 1 when anything new appears.
- `fbp trace --at X Y`: for a belt tile, the upstream line and every consumer
  downstream through undergrounds and splitters.
- Lane-mix warnings in `fbp check`: inserters putting two different items on
  the same lane of one belt line, with the inserter counts per item.
- `CLAUDE.md`: working rules and verification workflow for edits made with
  an AI assistant, distilled from mistakes caught on a real base.
- `docs/belt-patterns.md`: reference on lane mechanics, sideloading,
  underground lane filtering, splitter filters and mall belt conventions.

### Fixed
- Flow: a belt running into the side of an underground *exit* now feeds it,
  with only the lane aligned with the open half passing. Previously exits
  received from their tunnel only, so lines that end this way showed empty.
- Flow and lane-mix: long-handed inserters dropped onto the wrong lane
  because a two-tile offset was compared with a unit vector.
- Trace output printed belt bounding boxes with x and y interleaved.
- Fluid-only recipes (refineries, cracking, sulfur, acid) were reported as
  missing inserters. Recipes with no item ingredients or no item results are
  now skipped on that side.

## [0.1.0] - 2026-09-12

### Added
- `fbp` command line: `info`, `decode`, `encode`, `render` (ASCII and PNG),
  `find`, `trace`, `check`, `patch`, `crop`, `gamedata`, `recipe`.
- Belt graph tracer that follows underground pairs and splitters and infers
  what a belt carries from its producers.
- Supply check that flags crafters with an ingredient nothing adjacent can
  supply, and reports externally fed belts as inconclusive rather than clean.
- JSON patch format for remove / re-recipe / add with collision and wire
  checks and contiguous renumbering.
- Game data boiled down from `factorio --dump-data` into `data/gamedata.json`
  (668 recipes, 396 footprints from Factorio 2.0.77 with Space Age).
- Test suite with a cropped real mall as fixture.
