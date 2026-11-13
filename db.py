"""Echo — SQLite storage layer (M2).

Metadata + file paths only. Audio blobs NEVER live in the DB (locked
decision) — they live on disk under data/audio/ as small transcoded copies.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import Integer, String, Float, DateTime, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

# --- Paths --------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent
# ECHO_DATA_DIR lets the test suite point runtime data at a temp directory
# instead of the real data/ (test-enablement seam; unset in production).
DATA_DIR = Path(os.environ["ECHO_DATA_DIR"]) if os.environ.get("ECHO_DATA_DIR") else ROOT / "data"
AUDIO_DIR = DATA_DIR / "audio"
FEATURES_DIR = DATA_DIR / "features"
DB_PATH = DATA_DIR / "echo.sqlite"

for _d in (DATA_DIR, AUDIO_DIR, FEATURES_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# Retention (docs/LAUNCH.md §1, decision L6; CLAUDE.md Locked Decisions).
RETENTION_PER_OWNER = 20            # newest N clips kept per browser
RETENTION_GLOBAL_CLIPS = 500        # site-wide cap on clip count…
RETENTION_GLOBAL_BYTES = 1024 ** 3  # …or 1 GB of clip data, whichever first
RETENTION_INACTIVE_DAYS = 30        # clips not opened for this long are deleted
RETENTION_WARN_FRACTION = 0.8       # log a warning past 80% of either global cap


class Base(DeclarativeBase):
    pass


class Clip(Base):
    __tablename__ = "clips"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc))
    source_type: Mapped[str] = mapped_column(String)   # upload | recording | pi_mic
    # Original filename of an uploaded file, shown in the history list. NULL for
    # recordings, Pi-mic captures and rows written before this column existed
    # (those older rows also stored browser recordings as "upload").
    source_name: Mapped[str | None] = mapped_column(String, nullable=True)
    duration_s: Mapped[float] = mapped_column(Float)
    feature_path: Mapped[str] = mapped_column(String)  # relative to ROOT
    audio_path: Mapped[str] = mapped_column(String)    # relative to ROOT
    # Extraction-schema version that produced this clip's stored feature JSON
    # (Part 0). NULL = a legacy row written before versioning existed → the
    # schema audit treats it as stale until re-migrated. The JSON payload carries
    # the authoritative copy; this column is the cheap index the audit reads.
    schema_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The browser that made this clip: its `echo_vid` cookie (visitor.py,
    # docs/LAUNCH.md §1). Every clip route matches on it, so only that browser
    # can list, open, play or delete the clip. NULL = a row written before
    # ownership existed; nobody can see those (they were dropped at launch, L7).
    owner_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    # When the clip was made or last opened (GET /history/{id}); the 30-day
    # inactivity rule reads it.
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, default=lambda: datetime.now(timezone.utc))

    def to_summary(self) -> dict:
        return {
            "id": self.id,
            "created_at": self.created_at.replace(tzinfo=timezone.utc).isoformat()
            if self.created_at.tzinfo is None else self.created_at.isoformat(),
            "source_type": self.source_type,
            "name": self.source_name,
            "duration_s": round(self.duration_s, 3),
        }


engine = create_engine(f"sqlite:///{DB_PATH}", echo=False,
                       connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(engine)
    _ensure_columns()


def _ensure_columns() -> None:
    """Add columns introduced after the table was first created.

    `create_all` only creates missing TABLES, never adds columns to an existing
    one, so an already-deployed clips table (e.g. the Pi's 35 rows) won't get
    `schema_version` from the model alone. This adds it in place if missing;
    existing rows get NULL (stale) until the migration stamps them. Same for
    `source_name` (NULL simply means "no filename known"), and for `owner_id`
    (NULL = nobody's clip, invisible to every browser). `last_seen_at` starts
    at "now" for existing rows, so adding the column can never make the
    inactivity rule delete anything on the spot. Idempotent.
    """
    with engine.begin() as conn:
        cols = [row[1] for row in
                conn.exec_driver_sql("PRAGMA table_info(clips)").fetchall()]
        if cols and "schema_version" not in cols:
            conn.exec_driver_sql(
                "ALTER TABLE clips ADD COLUMN schema_version INTEGER")
        if cols and "source_name" not in cols:
            conn.exec_driver_sql(
                "ALTER TABLE clips ADD COLUMN source_name VARCHAR")
        if cols and "owner_id" not in cols:
            conn.exec_driver_sql("ALTER TABLE clips ADD COLUMN owner_id VARCHAR")
        if cols and "last_seen_at" not in cols:
            conn.exec_driver_sql("ALTER TABLE clips ADD COLUMN last_seen_at DATETIME")
            conn.exec_driver_sql("UPDATE clips SET last_seen_at = CURRENT_TIMESTAMP")
        if cols:
            # create_all only indexes a table it creates itself.
            conn.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_clips_owner_id ON clips (owner_id)")
