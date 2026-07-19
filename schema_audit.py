"""Echo — feature-schema audit (Part 0).

A real, runnable check of whether every stored feature payload was produced by
the CURRENT extraction logic — both the DB-tracked history clips and the
permanent sample library. This is the mechanism that replaces "a session
remembers to re-run the migration" with something the system itself verifies.

A stored clip is CURRENT iff:
  - its stored `schema_version` == extraction.FEATURE_SCHEMA_VERSION, AND
  - its per-frame key set == set(extraction.FEATURE_FIELDS).
Otherwise it is STALE and needs re-migration (see migrate_schema.py). The
second condition catches field drift even if a future session changes the
fields but forgets to bump the version.

Used three ways:
  - `python schema_audit.py`     — CLI, human-readable, exit 1 if any stale
  - GET /api/schema-audit        — JSON, for cheap runtime inspection
  - tests/test_schema.py         — fails the suite if anything is stale

Modules are imported INSIDE the functions on purpose: the test suite reloads
db/samples/extraction against a temp data dir (the ECHO_DATA_DIR seam), and a
local import always binds to the current module object rather than a stale one
captured at import time.
"""

from __future__ import annotations

import json
from pathlib import Path


def _read(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def _payload_status(payload) -> tuple[int | None, set]:
    """(stored_version, per-frame key set) for a loaded feature payload.

    Handles both the legacy plain-array format (a bare list of frames, always
    pre-versioning) and the dict format {schema_version?, features, spectrogram}.
    """
    if isinstance(payload, list):          # legacy: pre-versioning array
        feats, version = payload, None
    elif isinstance(payload, dict):
        feats, version = payload.get("features", []), payload.get("schema_version")
    else:
        return None, set()
    fields = set(feats[0].keys()) if feats else set()
    return version, fields


def _is_current(version, fields) -> bool:
    import extraction
    return (version == extraction.FEATURE_SCHEMA_VERSION
            and fields == set(extraction.FEATURE_FIELDS))


def _reason(version, fields) -> str:
    import extraction
    if _is_current(version, fields):
        return "current"
    parts = []
    if version != extraction.FEATURE_SCHEMA_VERSION:
        parts.append(f"version {version} != {extraction.FEATURE_SCHEMA_VERSION}")
    want = set(extraction.FEATURE_FIELDS)
    if fields != want:
        missing = sorted(want - fields)
        extra = sorted(fields - want)
        if missing:
            parts.append(f"missing fields {missing}")
        if extra:
            parts.append(f"extra fields {extra}")
    return "; ".join(parts) or "stale"


def audit_history() -> list[dict]:
    """Per-clip status for every DB-tracked history clip."""
    import db
    # Ensure the schema_version column exists before querying it — a DB created
    # before Part 0 won't have it until init_db()'s in-place add-column runs.
    db.init_db()
    out = []
    with db.SessionLocal() as session:
        for clip in session.query(db.Clip).all():
            fp = db.ROOT / clip.feature_path
            payload = _read(fp) if fp.exists() else None
            if payload is None:
                out.append({"id": clip.id, "kind": "history", "version": None,
                            "db_version": clip.schema_version, "current": False,
                            "reason": "feature file missing or unreadable"})
                continue
            version, fields = _payload_status(payload)
            out.append({"id": clip.id, "kind": "history", "version": version,
                        "db_version": clip.schema_version,
                        "current": _is_current(version, fields),
                        "reason": _reason(version, fields)})
    return out


def audit_samples() -> list[dict]:
    """Per-clip status for every permanent sample-library clip."""
    import samples as sample_lib
    out = []
    for entry in sample_lib._load_manifest():
        fp = sample_lib.FEATURES_DIR / entry.get("feature_file", "")
        payload = _read(fp) if fp.exists() else None
        if payload is None:
            out.append({"id": entry.get("id"), "kind": "sample", "version": None,
                        "current": False, "reason": "feature file missing or unreadable"})
            continue
        version, fields = _payload_status(payload)
        out.append({"id": entry.get("id"), "kind": "sample", "version": version,
                    "current": _is_current(version, fields),
                    "reason": _reason(version, fields)})
    return out


def audit_all() -> dict:
    """Combined summary across history + samples."""
    import extraction
    details = audit_history() + audit_samples()
    stale = [d for d in details if not d["current"]]
    return {
        "current_version": extraction.FEATURE_SCHEMA_VERSION,
        "fields": list(extraction.FEATURE_FIELDS),
        "total": len(details),
        "current": len(details) - len(stale),
        "stale": len(stale),
        "stale_ids": [d["id"] for d in stale],
        "details": details,
    }


def _print() -> int:
    a = audit_all()
    print(f"schema audit — current version v{a['current_version']}")
    print(f"  fields: {a['fields']}")
    print(f"  total={a['total']}  current={a['current']}  stale={a['stale']}")
    for d in a["details"]:
        flag = "OK   " if d["current"] else "STALE"
        print(f"  [{flag}] {d['kind']:7s} {d['id']}  v={d['version']}  ({d['reason']})")
    if a["stale"]:
        print(f"\n{a['stale']} stale clip(s) — run: python migrate_schema.py")
    else:
        print("\nall stored clips are current.")
    return 0 if a["stale"] == 0 else 1


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.exit(_print())
