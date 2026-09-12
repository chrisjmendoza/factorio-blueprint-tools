"""Tests against tests/fixtures/mall.txt, a crop of a real 2.0.77 mall.

The fixture contains a big-electric-pole assembler fed copper plate (the 2.0.7
recipe wants copper cable) with a steel-furnace assembler directly north of it.
"""
import json
import os

import pytest

from fbp import codec, gamedata, patch, render
from fbp.check import check
from fbp.model import Grid, footprint, inserter_ends
from fbp.trace import Tracer

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "fixtures", "mall.txt")


@pytest.fixture
def gd():
    return gamedata.GameData()


@pytest.fixture
def bp():
    return codec.first_blueprint(codec.load(FIXTURE))


def by_pos(grid, name, x, y):
    for e in grid.find(name=name):
        if e["position"] == {"x": x, "y": y}:
            return e
    raise AssertionError("no %s at (%s,%s)" % (name, x, y))


def by_recipe(grid, recipe):
    found = list(grid.find(recipe=recipe))
    assert len(found) == 1, recipe
    return found[0]


# -- codec -----------------------------------------------------------------

def test_roundtrip_is_lossless():
    text = open(FIXTURE, encoding="utf-8").read().strip()
    obj = codec.decode(text)
    again = codec.decode(codec.encode(obj))
    assert obj == again
    assert codec.encode(obj)[0] == "0"


def test_version_decodes(bp):
    assert codec.game_version(bp) == "2.0.77"


def test_book_wraps_and_indexes(bp):
    book = codec.make_book("Test book", [{"blueprint": bp}, {"blueprint": dict(bp, label="two")}])
    paths = [p for p, _ in codec.blueprints(book)]
    assert paths == [("Test book", "Mall fixture"), ("Test book", "two")]
    assert [e["index"] for e in book["blueprint_book"]["blueprints"]] == [0, 1]


# -- model -----------------------------------------------------------------

def test_footprint_centres():
    asm = {"name": "assembling-machine-1", "position": {"x": 114.5, "y": 77.5}}
    assert set(footprint(asm)) == {(x, y) for x in (113, 114, 115) for y in (76, 77, 78)}
    pole = {"name": "big-electric-pole", "position": {"x": -6, "y": -6}}
    assert set(footprint(pole)) == {(-7, -7), (-6, -7), (-7, -6), (-6, -6)}
    belt = {"name": "transport-belt", "position": {"x": 111.5, "y": 79.5}}
    assert footprint(belt) == [(111, 79)]
    splitter = {"name": "splitter", "position": {"x": 111, "y": 75.5}, "direction": 0}
    assert set(footprint(splitter)) == {(110, 75), (111, 75)}


def test_inserter_direction_points_at_pickup():
    ins = {"name": "inserter", "position": {"x": 112.5, "y": 80.5}, "direction": 4}
    assert inserter_ends(ins) == ((113, 80), (111, 80))
    long = {"name": "long-handed-inserter", "position": {"x": 111.5, "y": 79.5}, "direction": 12}
    assert inserter_ends(long) == ((109, 79), (113, 79))


def test_gamedata_has_2_0_recipes(gd):
    assert gd.ingredients("big-electric-pole")["copper-cable"] == 4
    assert gd.ingredients("substation")["copper-cable"] == 6
    assert "sulfuric-acid" not in gd.ingredients("processing-unit")  # fluids are not traced
    assert gd.products("copper-cable") == {"copper-cable"}
    assert "iron-plate" in gd.smelted_items()


# -- trace -----------------------------------------------------------------

def test_trace_big_pole_inputs(bp, gd):
    grid = Grid(bp, gd.footprints())
    tr = Tracer(grid, gd)
    pole = by_recipe(grid, "big-electric-pole")
    inputs, outputs = tr.machine_io(pole)
    items = set().union(*(i["items"] for i in inputs))
    assert "iron-stick" in items            # direct from the iron-stick assembler
    assert "copper-cable" not in items      # the bug
    # the plate belts leave the cropped area, so they are unknown, not empty
    belt_inputs = [i for i in inputs if "line" in i]
    assert len(belt_inputs) == 2 and all(i["unknown"] for i in belt_inputs)
    assert len(outputs) == 1 and outputs[0]["targets"][0]["name"] == "steel-chest"


def test_underground_pairs_are_followed(bp, gd):
    grid = Grid(bp, gd.footprints())
    tr = Tracer(grid, gd)
    entrance = by_pos(grid, "underground-belt", 109.5, 84.5)
    exit_ = by_pos(grid, "underground-belt", 109.5, 79.5)
    assert tr.underground_pair(entrance) is exit_
    assert tr.upstream(exit_) == [entrance]


# -- check -----------------------------------------------------------------

def test_check_big_pole_is_inconclusive_in_cropped_fixture(bp, gd):
    # The crop severs the main bus, so its belts are fed from outside the print
    # and the tool must say "inconclusive", not "problem".
    grid = Grid(bp, gd.footprints())
    findings, inconclusive, unknown = check(grid, gd, recipe="big-electric-pole")
    assert findings == []
    assert len(inconclusive) == 1
    assert set(inconclusive[0]["missing"]) == {"copper-cable", "steel-plate"}
    assert unknown == []


def synthetic():
    """A big-pole assembler fed iron sticks directly and plates from a furnace, no copper cable."""
    ents = [
        {"entity_number": 1, "name": "assembling-machine-1", "position": {"x": 5.5, "y": 5.5},
         "recipe": "big-electric-pole"},
        {"entity_number": 2, "name": "assembling-machine-1", "position": {"x": 1.5, "y": 5.5}, "recipe": "iron-stick"},
        {"entity_number": 3, "name": "inserter", "position": {"x": 3.5, "y": 5.5}, "direction": 12},
        {"entity_number": 4, "name": "stone-furnace", "position": {"x": 5, "y": 2}},
        {"entity_number": 5, "name": "inserter", "position": {"x": 4.5, "y": 3.5}, "direction": 0},
        {"entity_number": 6, "name": "inserter", "position": {"x": 7.5, "y": 5.5}, "direction": 12},
        {"entity_number": 7, "name": "iron-chest", "position": {"x": 8.5, "y": 5.5}},
    ]
    return {"entities": ents, "wires": []}


def test_check_reports_definite_problem(gd):
    grid = Grid(synthetic(), gd.footprints())
    findings, inconclusive, unknown = check(grid, gd, recipe="big-electric-pole")
    assert [f["missing"] for f in findings] == [["copper-cable"]]
    assert inconclusive == []


def test_check_passes_when_cable_arrives(gd):
    bp = synthetic()
    bp["entities"][1]["recipe"] = "copper-cable"          # sticks no longer arrive, cable does
    bp["entities"].append({"entity_number": 8, "name": "assembling-machine-1",
                           "position": {"x": 5.5, "y": 9.5}, "recipe": "iron-stick"})
    bp["entities"].append({"entity_number": 9, "name": "inserter", "position": {"x": 5.5, "y": 7.5},
                           "direction": 8})
    grid = Grid(bp, gd.footprints())
    findings, inconclusive, unknown = check(grid, gd, recipe="big-electric-pole")
    assert findings == [] and inconclusive == []


def test_check_does_not_flag_fluid_only_machines(gd):
    bp = {"entities": [{"entity_number": 1, "name": "chemical-plant", "position": {"x": 1.5, "y": 1.5},
                        "recipe": "sulfur"}], "wires": []}
    grid = Grid(bp, gd.footprints())
    findings, inconclusive, unknown = check(grid, gd)
    assert findings == [] or all(f["reason"] != "no input inserters" for f in findings)


# -- patch -----------------------------------------------------------------

def test_patch_fixes_big_pole(bp, gd):
    grid = Grid(bp, gd.footprints())
    pole = by_recipe(grid, "big-electric-pole")
    cable_asm = by_recipe(grid, "steel-furnace")
    p = {
        "remove": [by_pos(grid, "long-handed-inserter", 111.5, 79.5)["entity_number"],
                   by_pos(grid, "long-handed-inserter", 117.5, 77.5)["entity_number"],
                   by_pos(grid, "inserter", 116.5, 78.5)["entity_number"],
                   by_pos(grid, "steel-chest", 111.5, 77.5)["entity_number"]],
        "recipe": {str(cable_asm["entity_number"]): "copper-cable"},
        "add": [
            {"name": "inserter", "position": {"x": 113.5, "y": 75.5}, "direction": 0},
            {"name": "transport-belt", "position": {"x": 111.5, "y": 77.5}, "direction": 8},
            {"name": "transport-belt", "position": {"x": 111.5, "y": 78.5}, "direction": 8},
            {"name": "transport-belt", "position": {"x": 111.5, "y": 79.5}, "direction": 4},
            {"name": "inserter", "position": {"x": 112.5, "y": 79.5}, "direction": 12},
        ],
    }
    before = len(bp["entities"])
    log = []
    patch.apply(bp, p, gd.footprints(), log)
    assert len(bp["entities"]) == before - 4 + 5
    assert [e["entity_number"] for e in bp["entities"]] == list(range(1, len(bp["entities"]) + 1))
    grid2 = Grid(bp, gd.footprints())
    findings, inconclusive, _ = check(grid2, gd, recipe="big-electric-pole")
    assert findings == []
    # cable now has a definite adjacent source; only the severed steel belt stays unknown
    assert [f["missing"] for f in inconclusive] == [["steel-plate"]]
    assert any("copper-cable" in line for line in log)


def test_patch_refuses_collisions(bp, gd):
    with pytest.raises(patch.PatchError):
        patch.apply(bp, {"add": [{"name": "inserter", "position": {"x": 114.5, "y": 80.5}}]}, gd.footprints())


def test_patch_refuses_stranding_wires(bp, gd):
    wired = {bp["wires"][0][0]} if bp.get("wires") else set()
    if not wired:
        pytest.skip("fixture has no wires")
    with pytest.raises(patch.PatchError):
        patch.apply(bp, {"remove": list(wired)}, gd.footprints())


def test_crop_keeps_only_fully_inside(bp, gd):
    new = patch.crop(bp, 104, 76, 122, 86, gd.footprints())
    grid = Grid(new, gd.footprints())
    x0, y0, x1, y1 = grid.bbox()
    assert x0 >= 104 and y0 >= 76 and x1 <= 122 and y1 <= 86
    assert [e["entity_number"] for e in new["entities"]] == list(range(1, len(new["entities"]) + 1))


# -- render ----------------------------------------------------------------

def test_ascii_render_marks_machines_and_belts(bp, gd):
    grid = Grid(bp, gd.footprints())
    text = render.ascii_region(grid, 108, 74, 118, 82)
    assert "A" in text and ">" in text and "i" in text
    assert text.splitlines()[1].startswith("  74 ")
