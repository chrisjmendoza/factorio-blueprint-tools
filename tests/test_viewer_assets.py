"""Static checks on the viewer's HTML, CSS and JavaScript.

These catch wiring mistakes that are invisible until the page is open: a handler
bound to an element that no longer exists, a control the script never reads, or
a stylesheet rule for an id nothing renders. A missing element makes the script
throw at load, which silently breaks every later control.
"""
import os
import re
import shutil
import subprocess

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
MEDIA = os.path.join(os.path.dirname(HERE), "vscode", "media")


def read(name):
    with open(os.path.join(MEDIA, name), encoding="utf-8") as handle:
        return handle.read()


def html_ids():
    return set(re.findall(r'id="([^"]+)"', read("viewer.html")))


def script_ids():
    """Ids the script looks up, via $("x") or getElementById("x")."""
    js = read("viewer.js")
    return set(re.findall(r'\$\("([^"]+)"\)', js)) | set(re.findall(r'getElementById\("([^"]+)"\)', js))


def test_every_id_the_script_uses_exists_in_the_page():
    missing = sorted(script_ids() - html_ids() - {"recipelist"})   # recipelist is created at runtime
    assert missing == [], "viewer.js looks up ids the page does not define: %s" % missing


def test_every_control_in_the_page_is_wired_up():
    """Every input and button must be read by the script, or it is dead UI."""
    html = read("viewer.html")
    controls = set(re.findall(r'<(?:input|button|select)[^>]*id="([^"]+)"', html))
    unused = sorted(controls - script_ids())
    assert unused == [], "controls in viewer.html that viewer.js never touches: %s" % unused


def test_layout_has_no_hardcoded_bar_heights():
    """The bars wrap; heights must come from flex, not from calc() arithmetic that goes stale."""
    css = read("viewer.css")
    assert "calc(100%" not in css, "viewer.css still computes #main height by hand"
    assert re.search(r"body\s*\{[^}]*flex-direction:\s*column", css), "body should be a flex column"


def test_classes_used_by_the_page_are_styled():
    html, css = read("viewer.html"), read("viewer.css")
    used = set()
    for attr in re.findall(r'class="([^"]+)"', html):
        used.update(attr.split())
    styled = set(re.findall(r"\.([A-Za-z][\w-]*)", css))
    missing = sorted(used - styled)
    assert missing == [], "classes in viewer.html with no rule in viewer.css: %s" % missing


@pytest.mark.skipif(not shutil.which("node"), reason="node not available")
def test_scripts_parse():
    for name in ("viewer.js", "flow.js", "gamedata.js"):
        subprocess.run([shutil.which("node"), "--check", os.path.join(MEDIA, name)], check=True,
                       capture_output=True)
