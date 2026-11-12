"""ART-* tests: the committed landing-page art must match the sample library.

`build_landing_art.py` draws the landing page's static illustrations and
sample details from `samples/` (DESIGN_V2.md §4.1). These tests fail when the
library has changed (or been re-extracted) and the script was not re-run.
"""

from __future__ import annotations

import json

import build_landing_art as art


def test_ART_001_samples_json_matches_library():
    """frontend/src/assets/landing/samples.json == the current manifest's
    public fields. Fix: `python build_landing_art.py`."""
    committed = json.loads((art.OUT_DIR / "samples.json").read_text())
    assert committed == art.summary(art.load_manifest()), (
        "landing samples.json is stale — run `python build_landing_art.py`")


def test_ART_002_every_sample_has_a_thumbnail_and_no_extras():
    ids = {s["id"] for s in art.load_manifest()}
    thumbs = {p.stem for p in (art.OUT_DIR / "thumbs").glob("*.png")}
    assert thumbs == ids, "thumbnails out of step with the library — run `python build_landing_art.py`"
    for p in (art.OUT_DIR / "thumbs").glob("*.png"):
        assert p.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_ART_003_illustrations_are_current():
    """The three SVGs are regenerated in memory and compared byte-for-byte
    (the script is deterministic), so re-extracted features can't leave the
    landing art showing old trails."""
    manifest = art.load_manifest()
    for name, build in (("hero-trails.svg", art.hero_svg),
                        ("view-trail.svg", art.trail_view_svg),
                        ("view-spectral.svg", art.spectral_view_svg)):
        assert (art.OUT_DIR / name).read_text() == build(manifest), (
            f"{name} is stale — run `python build_landing_art.py`")


def test_ART_004_page_weight_budget():
    """The static art must stay small: the landing page's budget is 300 KB
    without fonts (DESIGN_V2.md §7), and the SVGs are inlined into its JS."""
    svgs = sum((art.OUT_DIR / n).stat().st_size
               for n in ("hero-trails.svg", "view-trail.svg", "view-spectral.svg"))
    assert svgs < 120 * 1024
    for p in (art.OUT_DIR / "thumbs").glob("*.png"):
        assert p.stat().st_size < 16 * 1024
