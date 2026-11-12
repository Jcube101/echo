"""Echo — static landing-page art, generated from the sample library.

DESIGN_V2.md §4.1: the landing page must not download sample feature files
(≈1.2 MB for the hero alone), so its illustrations are drawn ONCE from
`samples/` into small committed files under `frontend/src/assets/landing/`:

  hero-trails.svg       five sample trails in one fixed-scale box
  view-trail.svg        one trail, coloured by loudness ("3D Trail" card)
  view-spectral.svg     the seven spectral lanes ("Spectral panel" card)
  thumbs/<id>.png       a small spectrogram per sample (landing + phone home)
  samples.json          names, durations and credits for every sample

Run from the repo root:   python build_landing_art.py

Re-run it whenever the sample library changes or is re-extracted
(`migrate_schema.py`). tests/test_landing_art.py fails if samples.json here
has drifted from samples/samples.json. Standard library only — no Pillow.
Output is deterministic: an unchanged library rewrites identical files.

Lives at the repo root on purpose (`verification/` is gitignored).
"""

from __future__ import annotations

import json
import math
import re
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SAMPLES_DIR = ROOT / "samples"
OUT_DIR = ROOT / "frontend" / "src" / "assets" / "landing"
PANEL_FEATURES_JS = ROOT / "frontend" / "src" / "lib" / "panelFeatures.js"

WORLD = 3.0  # half-extent of the fixed box; must match extraction.WORLD

# Design v2 tokens used in the art (DESIGN_V2.md §3).
NIGHT_LINE = "#2E3D33"
BOX = "#3F5246"
MUTED = "#A9B0A0"
CREAM = "#F4EFE4"
AMBER = "#E8B04B"

# Hero: which samples, their colour, and a hand-placed label offset (px) from
# the trail's loudness-weighted centre so the five names never collide.
HERO = [
    ("lion-roar", "Lion", "#E0764B", (-58, 4)),
    ("wolf-howl", "Wolf", "#74ABEA", (-8, -54)),
    ("common-myna", "Common Myna", "#F1ECE1", (26, -66)),
    ("asian-koel", "Asian Koel", "#E8B04B", (44, 30)),
    ("cricket-chirp", "Cricket", "#B9DA7C", (28, 50)),
]
TRAIL_VIEW_SAMPLE = "asian-koel"
SPECTRAL_VIEW_SAMPLE = "common-myna"

# Fields copied into samples.json (same public set as samples.list_samples()).
SUMMARY_KEYS = ("id", "species", "sci_name", "recordist", "license",
                "license_url", "source_url", "provider", "duration_s")


# --- sample loading -----------------------------------------------------------
def load_manifest() -> list[dict]:
    return json.loads((SAMPLES_DIR / "samples.json").read_text())


def load_payload(entry: dict) -> tuple[list[dict], dict | None]:
    payload = json.loads((SAMPLES_DIR / "features" / entry["feature_file"]).read_text())
    if isinstance(payload, list):
        return payload, None
    return payload.get("features", []), payload.get("spectrogram")


def summary(manifest: list[dict]) -> list[dict]:
    return [{k: s.get(k) for k in SUMMARY_KEYS} for s in manifest]


# --- fixed camera (same direction as the app's 3D scene) ----------------------
def _norm(v):
    n = math.sqrt(sum(c * c for c in v))
    return tuple(c / n for c in v)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return sum(x * y for x, y in zip(a, b))


CAM_DIR = _norm((2.1, 1.35, 2.1))
CAM_DIST = 17.0
CAM = tuple(c * CAM_DIST for c in CAM_DIR)
FWD = tuple(-c for c in CAM_DIR)
RIGHT = _norm(_cross(FWD, (0.0, 1.0, 0.0)))
UP = _cross(RIGHT, FWD)


def project(pitch: float, motion: float, timbre: float, size: float, cx: float, cy: float):
    """World (X=pitch, Y=motion, Z=timbre) -> SVG px. `size` ≈ box width in px."""
    v = (pitch - CAM[0], motion - CAM[1], timbre - CAM[2])
    z = _dot(v, FWD)
    f = size * CAM_DIST / (2 * WORLD * 1.62)
    return cx + _dot(v, RIGHT) / z * f, cy - _dot(v, UP) / z * f


def n1(v: float) -> str:
    """One decimal, no trailing '.0' — keeps the SVGs small."""
    s = f"{v:.1f}"
    return s[:-2] if s.endswith(".0") else s


def box_svg(size: float, cx: float, cy: float, grid: bool = True) -> str:
    W = WORLD
    P = lambda x, y, z: project(x, y, z, size, cx, cy)  # noqa: E731
    seg = []
    corners = [(x, y, z) for x in (-W, W) for y in (-W, W) for z in (-W, W)]
    for i, a in enumerate(corners):
        for b in corners[i + 1:]:
            if sum(1 for p, q in zip(a, b) if p != q) == 1:
                seg.append((P(*a), P(*b)))
    d = " ".join(f"M{n1(a[0])},{n1(a[1])}L{n1(b[0])},{n1(b[1])}" for a, b in seg)
    out = f'<path d="{d}" fill="none" stroke="{BOX}" stroke-width="1"/>'
    if grid:
        g = []
        for i in (-2, -1, 0, 1, 2):
            g.append((P(-W, -W, i), P(W, -W, i)))
            g.append((P(i, -W, -W), P(i, -W, W)))
        d = " ".join(f"M{n1(a[0])},{n1(a[1])}L{n1(b[0])},{n1(b[1])}" for a, b in g)
        out = f'<path d="{d}" fill="none" stroke="{NIGHT_LINE}" stroke-width="1"/>' + out
    return out


def axis_labels(size: float, cx: float, cy: float, font_px: int = 13) -> str:
    W = WORLD
    px, py = project(0, -W, W, size, cx, cy)
    tx, ty = project(W, -W, 0, size, cx, cy)
    mx, my = project(-W, 0, W, size, cx, cy)
    style = f'font-family="\'IBM Plex Mono\',ui-monospace,monospace" font-size="{font_px}" fill="{MUTED}"'
    return (
        f'<text x="{n1(px - 14)}" y="{n1(py + 26)}" text-anchor="end" {style}>Pitch →</text>'
        f'<text x="{n1(tx + 14)}" y="{n1(ty + 24)}" {style}>Timbre →</text>'
        f'<text x="{n1(mx - 12)}" y="{n1(my)}" text-anchor="end" {style}>Motion ↑</text>'
    )


def thin(features: list[dict], limit: int) -> list[dict]:
    """Evenly keep at most `limit` frames (always the first and last)."""
    n = len(features)
    if n <= limit:
        return features
    return [features[round(i * (n - 1) / (limit - 1))] for i in range(limit)]


def clamp01(v: float) -> float:
    return 0.0 if v < 0 else 1.0 if v > 1 else v


# --- hero: five trails, one box ----------------------------------------------
def hero_svg(manifest: list[dict]) -> str:
    Wd, Ht = 540, 470
    size, cx, cy = 400, 262, 236
    by_id = {s["id"]: s for s in manifest}
    parts = [box_svg(size, cx, cy), axis_labels(size, cx, cy)]
    labels = []
    for sid, name, colour, (dx, dy) in HERO:
        feats, _ = load_payload(by_id[sid])
        pts = thin(feats, 180)
        proj = [project(f["pitch"], f["motion"], f["timbre"], size, cx, cy) for f in pts]
        line = " ".join(f"{n1(x)},{n1(y)}" for x, y in proj)
        parts.append(f'<polyline points="{line}" fill="none" stroke="{colour}" stroke-width="0.8" opacity="0.35"/>')
        dots = []
        wsum = sx = sy = 0.0
        for f, (x, y) in zip(pts, proj):
            a = clamp01(f["amplitude"])
            r = 0.9 + math.sqrt(a) * 3.6
            dots.append(f'<circle cx="{n1(x)}" cy="{n1(y)}" r="{n1(r)}"/>')
            w = a + 0.02
            wsum += w
            sx += x * w
            sy += y * w
        parts.append(f'<g fill="{colour}" opacity="0.8">{"".join(dots)}</g>')
        lx, ly = sx / wsum + dx, sy / wsum + dy
        anchor = "end" if dx < 0 else "start"
        labels.append(
            f'<text x="{n1(lx)}" y="{n1(ly)}" text-anchor="{anchor}" '
            f'font-family="\'Instrument Sans\',system-ui,sans-serif" font-size="17" font-weight="600" '
            f'fill="{colour}" stroke="#121A15" stroke-width="3" paint-order="stroke">{name}</text>'
        )
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {Wd} {Ht}">'
            + "".join(parts) + "".join(labels) + "</svg>\n")


# --- "3D Trail" card: one trail coloured by loudness --------------------------
QUIET, MID, LOUD = (79, 143, 99), (232, 176, 75), (244, 239, 228)


def loudness_hex(a: float) -> str:
    p = math.sqrt(clamp01(a))
    lo, hi, f = (QUIET, MID, p / 0.5) if p < 0.5 else (MID, LOUD, (p - 0.5) / 0.5)
    return "#" + "".join(f"{round(lo[i] + (hi[i] - lo[i]) * f):02X}" for i in range(3))


def trail_view_svg(manifest: list[dict]) -> str:
    Wd, Ht = 560, 360
    size, cx, cy = 350, 280, 176
    entry = next(s for s in manifest if s["id"] == TRAIL_VIEW_SAMPLE)
    feats, _ = load_payload(entry)
    pts = thin(feats, 320)
    proj = [project(f["pitch"], f["motion"], f["timbre"], size, cx, cy) for f in pts]
    line = " ".join(f"{n1(x)},{n1(y)}" for x, y in proj)
    parts = [box_svg(size, cx, cy),
             f'<polyline points="{line}" fill="none" stroke="#4F8F63" stroke-width="0.8" opacity="0.45"/>']
    for f, (x, y) in zip(pts, proj):
        a = clamp01(f["amplitude"])
        parts.append(f'<circle cx="{n1(x)}" cy="{n1(y)}" r="{n1(1 + math.sqrt(a) * 4.2)}" '
                     f'fill="{loudness_hex(a)}" opacity="0.85"/>')
    # playhead marker on the loudest frame
    k = max(range(len(pts)), key=lambda i: pts[i]["amplitude"])
    x, y = proj[k]
    parts.append(f'<circle cx="{n1(x)}" cy="{n1(y)}" r="9" fill="none" stroke="{CREAM}" stroke-width="1.5"/>'
                 f'<circle cx="{n1(x)}" cy="{n1(y)}" r="3" fill="{CREAM}"/>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {Wd} {Ht}">' + "".join(parts) + "</svg>\n"


# --- "Spectral panel" card: seven lanes ---------------------------------------
def panel_features() -> list[dict]:
    """key / range / colour for the seven lanes, read from the app's own
    definitions so the art can't drift from the live panel."""
    src = PANEL_FEATURES_JS.read_text()
    rx = re.compile(r"key: '(\w+)',.*?range: \[([^\]]+)\],\s*color: '(#[0-9a-fA-F]{6})'")
    out = []
    for key, rng, colour in rx.findall(src):
        lo, hi = (float(v) for v in rng.split(","))
        out.append({"key": key, "lo": lo, "hi": hi, "color": colour})
    if len(out) != 7:
        raise SystemExit(f"expected 7 panel features in {PANEL_FEATURES_JS}, found {len(out)}")
    return out


def spectral_view_svg(manifest: list[dict]) -> str:
    Wd, Ht = 560, 380
    pad_x, top, lane_h, gap = 0, 8, 46, 6
    entry = next(s for s in manifest if s["id"] == SPECTRAL_VIEW_SAMPLE)
    feats, _ = load_payload(entry)
    pts = thin(feats, 260)
    dur = feats[-1]["t"] or 1.0
    parts = []
    for i, pf in enumerate(panel_features()):
        y0 = top + i * (lane_h + gap)
        parts.append(f'<rect x="{pad_x}" y="{y0}" width="{Wd - 2 * pad_x}" height="{lane_h}" rx="3" fill="#121A15"/>')
        coords = []
        for f in pts:
            t = clamp01((f[pf["key"]] - pf["lo"]) / (pf["hi"] - pf["lo"]))
            x = pad_x + f["t"] / dur * (Wd - 2 * pad_x)
            y = y0 + lane_h - 7 - t * (lane_h - 14)
            coords.append(f"{n1(x)},{n1(y)}")
        parts.append(f'<polyline points="{" ".join(coords)}" fill="none" stroke="{pf["color"]}" '
                     f'stroke-width="1.6" stroke-linejoin="round"/>')
    px = pad_x + 0.32 * (Wd - 2 * pad_x)
    bottom = top + 7 * lane_h + 6 * gap
    parts.append(f'<line x1="{n1(px)}" x2="{n1(px)}" y1="{top}" y2="{bottom}" stroke="{AMBER}" stroke-width="1.5"/>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {Wd} {bottom + 8}">' + "".join(parts) + "</svg>\n"


# --- spectrogram thumbnails (pure-stdlib PNG) ---------------------------------
RAMP = [(0.0, (0x16, 0x20, 0x1A)), (0.35, (0x2F, 0x4A, 0x3A)),
        (0.7, (0xE8, 0xB0, 0x4B)), (1.0, (0xF4, 0xEF, 0xE4))]  # DESIGN_V2.md D5
THUMB_W, THUMB_H = 168, 48


def ramp(v: float) -> tuple[int, int, int]:
    t = clamp01(v / 255)
    for (t0, c0), (t1, c1) in zip(RAMP, RAMP[1:]):
        if t <= t1:
            f = (t - t0) / (t1 - t0)
            return tuple(round(c0[i] + (c1[i] - c0[i]) * f) for i in range(3))
    return RAMP[-1][1]


def thumb_png(spec: dict) -> bytes:
    bins, cols, data = spec["bins"], spec["cols"], spec["data"]
    rows = []
    for y in range(THUMB_H):
        # box-average the source cells under each output pixel (low freq at bottom)
        b0 = (THUMB_H - 1 - y) * bins / THUMB_H
        bs = range(int(b0), max(int(b0) + 1, int(b0 + bins / THUMB_H)))
        row = bytearray([0])  # filter type 0
        for x in range(THUMB_W):
            c0 = x * cols / THUMB_W
            cs = range(int(c0), max(int(c0) + 1, int(c0 + cols / THUMB_W)))
            vals = [data[c * bins + b] for c in cs for b in bs if c < cols and b < bins]
            row += bytes(ramp(sum(vals) / len(vals)))
        rows.append(bytes(row))

    def chunk(tag: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body))

    ihdr = struct.pack(">IIBBBBB", THUMB_W, THUMB_H, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b""))


# --- main ---------------------------------------------------------------------
def main() -> None:
    manifest = load_manifest()
    (OUT_DIR / "thumbs").mkdir(parents=True, exist_ok=True)
    written = {}

    def write(rel: str, content: bytes | str) -> None:
        data = content.encode() if isinstance(content, str) else content
        (OUT_DIR / rel).write_bytes(data)
        written[rel] = len(data)

    write("hero-trails.svg", hero_svg(manifest))
    write("view-trail.svg", trail_view_svg(manifest))
    write("view-spectral.svg", spectral_view_svg(manifest))
    write("samples.json", json.dumps(summary(manifest), indent=1, ensure_ascii=False) + "\n")
    wanted = set()
    for entry in manifest:
        _, spec = load_payload(entry)
        if spec and spec.get("cols"):
            write(f"thumbs/{entry['id']}.png", thumb_png(spec))
            wanted.add(f"{entry['id']}.png")
    for stale in (OUT_DIR / "thumbs").glob("*.png"):  # samples removed from the library
        if stale.name not in wanted:
            stale.unlink()

    for rel, size in written.items():
        print(f"{size / 1024:7.1f} KB  {rel}")
    print(f"{sum(written.values()) / 1024:7.1f} KB  total, {len(manifest)} samples")


if __name__ == "__main__":
    main()
