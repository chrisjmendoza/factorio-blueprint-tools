# Working on Factorio blueprints with fbp

This repo is the tool I use to read, check and edit Factorio 2.0 blueprint
strings for Chris. Blueprint files live in `D:\Dev\factorio blueprints`
(strings as `.txt`, patches in `patches/`). Run commands from this folder
with `python -m fbp ...`. Read `docs/belt-patterns.md` before designing belts.

## Hard rules learned the expensive way

1. **Never trust a partial trace of a belt.** Before dropping anything onto a
   belt, run `fbp trace FILE --at X Y` on the drop tile and read the
   *downstream* consumer list. A steel belt in the mall column at x=103 looked
   like it ended at a steam engine; it actually dives under two tiles and feeds
   35 machines. Check which underground pairs with which (the tool prints the
   pair) rather than reading the ASCII map.
2. **One item per lane.** Only sideload item X onto a lane if nothing upstream
   already puts a different item on that lane, and every consumer downstream
   either uses X or has its own lane for what it needs. `fbp check` prints
   LANE MIX warnings; this base has 19 by design, so compare before/after with
   `fbp diff` and only new ones matter.
3. **After every patch run `fbp diff BEFORE AFTER`.** Only the intended
   machines may appear as CHANGED, every CHANGED line must end `=> OK`, and
   there must be no `NEW:` check problems or lane-mix warnings. Then run
   `fbp lint AFTER`.
4. **Adjacent machines cannot exchange items.** An inserter needs its own
   tile; two 3x3 machines touching edge to edge have no gap. Every mall cell
   here has one ring of inserter tiles, so a machine's usable slots are the
   ring tiles that face something (a belt, a chest, a neighbour machine).
   Count the slots before promising a fix: a recipe with 3 item ingredients
   needs 3 inputs + 1 output = 4 slots.
5. **Recipe data comes from the game, not the wiki.** `data/gamedata.json` is
   from Chris's install (2.0.77 + Space Age + mods); the wiki was wrong about
   the medium electric pole. Rebuild with `factorio --dump-data` (game closed)
   then `fbp gamedata` after updates.
6. **Chris wants belt or chest solutions.** Requester and buffer chests are
   late (Fulgora) in Space Age. Passive providers exist in this base but do not
   count as a fix.

## Geometry facts the tool encodes (see fbp/model.py)

- Positions are entity centres. A 3x3 at (114.5, 77.5) covers x 113..115,
  y 76..78. A 2x2 pole at (-6, -6) covers -7..-6 on both axes.
- Inserter `direction` (0 N, 4 E, 8 S, 12 W) points at the **pickup** tile;
  the drop is on the opposite side. Long-handed reach is 2.
- An inserter drops onto the belt lane **farthest** from itself. Belt
  travelling south: east side is the left lane, west side the right lane.
- Underground pairs are matched by same name, same direction, opposite type,
  first match within reach (5 for basic, 7 fast, 9 express, 11 turbo). An
  east-facing pair and a south-facing pair can share a tile column.
- Blueprint wires are `[entity, connector, entity, connector]`; connector 5 is
  copper, 1 red, 2 green. Removing a wired entity strands wires; `patch`
  refuses unless `drop_wires` is set.

## Belt mechanics quick reference (2.0.77; full text and sources in docs/belt-patterns.md)

- Inserter drop lane is the far lane. Two inserters on the same side of a belt
  fill one lane; opposite sides fill both. (2.1 adds a flip hotkey; not 2.0.)
- A belt running into the *side* of another belt sideloads: all its items land
  on the target's near lane. A curve (target starts at the junction) keeps
  both lanes.
- A belt sideloading into an underground tile passes only the lane aligned
  with the open half; the hood half blocks. Entrance: hood on the far half;
  exit: hood on the near half. This is the one-lane filter trick, and the
  blocked lane backs up unless routed elsewhere. **Exits accept side feeds
  too** (verified in game by Chris on the robot mall column at (84,147):
  frames on the west lane enter a west-facing exit, batteries on the east
  lane stop). Chris's base uses this deliberately; never "fix" it.
- Long-handed inserters stand two tiles from the belt they drop on. Any
  side test must normalise the offset or it silently picks the wrong lane.
- Splitters preserve lanes and split each lane independently. A filter holds
  one item type; filtered items never leak to the other output.
- Underground pairs need the same tier, axis and opposite type; gap 4/6/8
  tiles for basic/fast/express (turbo 10, reach unverified). Same-tier
  undergrounds on one axis cannot cross; different tiers can; perpendicular
  axes never interact.
- Inserters never pick what the target cannot accept, so one item per lane is
  safe and three items on one lane is a deadlock risk.
- Inserters picking from underground tiles are slower; dropping onto a
  perpendicular splitter is faster than onto a belt.
- Long-handed inserters pick and drop at exactly 2 tiles, skipping tile 1.
- A furnace or assembler column with machines on one side of the output belt
  fills one lane and caps at half a belt; two-sided columns fill both.

## Workflow for a fix request

0. If `<name>.feeds.json` exists beside the string, `fbp flow FILE --at X Y`
   answers "what is on this lane" with the user's declared inputs applied;
   prefer it over guessing from `trace`. Ask Chris to declare edge feeds in
   the viewer's feed mode when furnace output shows as `smelted?`.
1. `fbp info` and `fbp check` on the current string; `fbp trace --recipe R`
   for the machine in question. Confirm the recipe with `fbp recipe R`.
2. `fbp render FILE x0 y0 x1 y1 --entities` around the cell. Count free ring
   tiles. List every candidate slot and what its pickup tile holds.
3. Write the patch as JSON in `patches/`, with `_comment` keys explaining why.
4. `fbp patch`, then rule 3 above. Only then report.
5. Report trade-offs (recipes sacrificed, machines removed) explicitly. Chris
   decides those; do not remove a recipe without saying so.

## Open items on the base (2026-09-12)

- Medium electric pole assembler at (106.5, 83.5) still has no copper cable
  source. Its cell has exactly four usable slots and all are taken; the lane
  sideload was withdrawn (rule 1). Needs a re-layout of that column or a
  relocated pole cell. Do not repeat the sideload.
- Nine unpaired undergrounds at y 59..61 and one splitter without outputs at
  (116.5, 68) are pre-existing edge conditions of the export, not bugs we made.
