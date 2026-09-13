# Working on Factorio blueprints with fbp

Notes for an AI assistant (or anyone) editing blueprints with this tool. Run
commands from the repo root with `python -m fbp ...`. Read
`docs/belt-patterns.md` before designing belts.

## Hard rules, learned the expensive way

1. **Never trust a partial trace of a belt.** Before dropping anything onto a
   belt, run `fbp trace FILE --at X Y` on the drop tile and read the
   *downstream* consumer list. Belts dive under machines and resurface: one that
   looks like it ends at a steam engine can feed 35 machines two tiles later.
   Trust the tool's underground pairing rather than reading an ASCII map.
2. **One item per lane.** Only sideload item X onto a lane if nothing upstream
   already puts a different item there, and every consumer downstream either
   uses X or has its own lane for what it needs. `fbp check` prints LANE MIX
   warnings; a real base will have some by design, so compare before and after
   with `fbp diff` and treat only new ones as regressions.
3. **After every patch run `fbp diff BEFORE AFTER`.** Only the intended machines
   may appear as CHANGED, every CHANGED line must end `=> OK`, and there must be
   no `NEW:` check problems or lane-mix warnings. Then run `fbp lint AFTER`.
4. **Count the free tiles before promising a fix.** An inserter needs its own
   tile, and two machines placed edge to edge have no gap between them. A recipe
   with three item ingredients needs three input slots plus an output slot, so a
   cell ringed by belts may simply have nowhere left to put one.
5. **Recipe data comes from the game, not the wiki.** `data/gamedata.json` is
   generated from a `--dump-data` of a specific install including its mods; the
   wiki has been wrong about at least one 2.0 recipe. Rebuild after updates.
6. **Prefer belt and chest solutions to logistics.** Requester and buffer chests
   arrive late in Space Age, so a fix that depends on them may be unbuildable at
   the point in the game the base is at.

## Belt mechanics quick reference (2.0; full text and sources in docs/belt-patterns.md)

- An inserter drops on the far lane. Two inserters on the same side of a belt
  fill one lane; opposite sides fill both.
- A belt running into the *side* of another belt sideloads: all its items land
  on the target's near lane. A curve, where the target starts at the junction,
  keeps both lanes.
- A belt sideloading into an underground tile passes only the lane aligned with
  the open half; the hood half blocks. **Exits accept side feeds too** — this is
  used deliberately to merge one lane into a tunnel while the other lane
  continues past. Never "fix" a layout that does this.
- Splitters preserve lanes and split each lane independently. A filter holds one
  item type; filtered items never leak to the other output.
- Underground pairs need the same tier, axis and opposite type, with gaps of
  4/6/8/10 tiles for basic/fast/express/turbo. Same-tier undergrounds on one
  axis cannot cross; different tiers can; perpendicular axes never interact.
- Inserters never pick what the target cannot accept, so one item per lane is
  safe and three items on one lane is a deadlock risk.
- Long-handed inserters pick and drop at exactly two tiles, skipping the
  adjacent tile. Any side or lane test must normalise the offset, or it silently
  picks the wrong lane.
- A furnace or assembler column with machines on one side of its output belt
  fills one lane and caps at half a belt; two-sided columns fill both.

## Geometry the tool encodes (see fbp/model.py)

- Positions are entity centres. A 3x3 at (114.5, 77.5) covers x 113–115,
  y 76–78. A 2x2 pole at (-6, -6) covers -7..-6 on both axes.
- An inserter's `direction` (0 N, 4 E, 8 S, 12 W) points at its **pickup** tile;
  the drop is on the opposite side.
- Wires are `[entity, connector, entity, connector]`; connector 5 is copper,
  1 red, 2 green. Removing a wired entity strands wires, and `fbp patch` refuses
  unless `drop_wires` is set.

## Workflow for a fix request

1. If a `<name>.feeds.json` exists beside the string, `fbp flow FILE --at X Y`
   answers "what is on this lane" with the declared inputs applied. Prefer it to
   guessing from producers. When furnace output shows as `smelted?`, the ore
   feeds have not been declared yet.
2. `fbp info` and `fbp check`; `fbp trace --recipe R` for the machine in
   question. Confirm the recipe with `fbp recipe R` rather than from memory.
3. `fbp render FILE x0 y0 x1 y1 --entities` around the cell. Count the free ring
   tiles and list what each candidate pickup tile holds.
4. Write the patch as JSON with `_comment` keys explaining why, then apply it.
5. Verify with rule 3 above. Only then report.
6. State trade-offs explicitly. If a fix sacrifices a recipe or removes a
   machine, that is the user's call to make, not something to slip in.
