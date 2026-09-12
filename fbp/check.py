"""Supply check: does every crafter have a plausible source for each item ingredient?

A finding is raised when an ingredient is not produced by anything adjacent
to the machine's input inserters, and none of those inputs is an unknown
source (a chest without filters, or a belt fed from outside the blueprint).
Unknown sources make the check inconclusive rather than clean, and are
reported separately.
"""
from .model import kind
from .trace import Tracer


def check(grid, gamedata, recipe=None):
    tr = Tracer(grid, gamedata)
    findings, inconclusive, unknown_recipes = [], [], set()
    for m in grid.entities:
        if kind(m) != "crafter" or not m.get("recipe"):
            continue
        if recipe and m["recipe"] != recipe:
            continue
        needs = gamedata.ingredients(m["recipe"])
        if needs is None:
            unknown_recipes.add(m["recipe"])
            continue
        inputs, outputs = tr.machine_io(m)
        available = set()
        any_unknown = False
        for i in inputs:
            available |= i["items"]
            any_unknown = any_unknown or i["unknown"]
        missing = [item for item in needs if item not in available]
        if needs and not inputs:
            findings.append({"machine": m, "missing": list(needs), "reason": "no input inserters"})
        elif missing and not any_unknown:
            findings.append({"machine": m, "missing": missing, "reason": "no adjacent source"})
        elif missing:
            inconclusive.append({"machine": m, "missing": missing, "reason": "only unknown sources could supply these"})
        if not outputs and gamedata.has_item_results(m["recipe"]):
            findings.append({"machine": m, "missing": [], "reason": "no output inserter"})
    return findings, inconclusive, sorted(unknown_recipes)


def format_report(grid, findings, inconclusive, unknown_recipes, source):
    lines = ["recipe data: %s" % source]
    if findings:
        lines.append("PROBLEMS (%d):" % len(findings))
        for f in findings:
            lines.append("  %s: %s%s" % (grid.describe(f["machine"]), f["reason"],
                                       (" -> missing " + ", ".join(f["missing"])) if f["missing"] else ""))
    else:
        lines.append("PROBLEMS: none")
    if inconclusive:
        lines.append("INCONCLUSIVE (%d):" % len(inconclusive))
        for f in inconclusive:
            lines.append("  %s: %s -> %s" % (grid.describe(f["machine"]), f["reason"], ", ".join(f["missing"])))
    if unknown_recipes:
        lines.append("UNKNOWN RECIPES (not in data): " + ", ".join(unknown_recipes))
    return "\n".join(lines)
