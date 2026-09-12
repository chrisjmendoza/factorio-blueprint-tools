# Changelog

All notable changes to fbp are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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
