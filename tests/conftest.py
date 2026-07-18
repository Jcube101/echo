"""Shared fixtures for Echo's backend test suite.

Everything here is fully sandboxed: synthetic audio (numpy + soundfile, both
already in requirements.txt), a temp data dir + temp SQLite per test (via the
ECHO_DATA_DIR test-enablement seam in db.py), and a throwaway stub script
standing in for ~/bin/rec. Nothing here ever touches the real data/ directory,
the real ~/bin/rec wrapper, ~/.asoundrc, or any network endpoint, per
CLAUDE.md's guardrails.
"""

from __future__ import annotations

import importlib
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

SAMPLE_RATE = 22050


# --- synthetic waveform builders (pure numpy, no fixture files needed) --------

def make_tone(duration=2.0, freq=440.0, sr=SAMPLE_RATE, amp=0.6):
    """A pure sine tone."""
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def make_silence(duration=1.0, sr=SAMPLE_RATE):
    """True digital silence (all zeros)."""
    return np.zeros(int(sr * duration), dtype=np.float32)


def make_noise(duration=1.0, sr=SAMPLE_RATE, amp=0.3, seed=0):
    """White noise (deterministic via seed) — mostly unvoiced for pyin."""
    rng = np.random.default_rng(seed)
    return (amp * rng.standard_normal(int(sr * duration))).astype(np.float32)


def make_chirp(duration=2.0, f0=300.0, f1=3000.0, sr=SAMPLE_RATE, amp=0.6):
    """A linear frequency sweep — high motion, unlike a steady tone."""
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    k = (f1 - f0) / duration
    phase = 2 * np.pi * (f0 * t + 0.5 * k * t ** 2)
    return (amp * np.sin(phase)).astype(np.float32)


def make_click_train(duration=2.0, rate_hz=8.0, sr=SAMPLE_RATE, amp=0.9, click_ms=3.0):
    """Short periodic clicks — high onset-strength (motion), unlike a steady tone."""
    y = np.zeros(int(sr * duration), dtype=np.float32)
    step = int(sr / rate_hz)
    click_len = max(1, int(sr * click_ms / 1000))
    for i in range(0, len(y) - click_len, step):
        y[i:i + click_len] = amp
    return y


def concat(*parts):
    return np.concatenate(parts).astype(np.float32)


def write_wav(path, y, sr=SAMPLE_RATE):
    sf.write(str(path), y, sr)
    return Path(path)


class AudioFactory:
    """Synthesizes fixture WAVs into a per-test temp dir. No network, no real
    recordings — see the module docstring."""

    def __init__(self, tmp_path: Path):
        self._dir = tmp_path / "audio_fixtures"
        self._dir.mkdir(exist_ok=True)
        self._n = 0

    def _path(self, name: str, ext: str = ".wav") -> Path:
        self._n += 1
        return self._dir / f"{self._n:03d}_{name}{ext}"

    def tone(self, duration=2.0, freq=440.0, sr=SAMPLE_RATE, amp=0.6, name="tone"):
        return write_wav(self._path(name), make_tone(duration, freq, sr, amp), sr)

    def silence(self, duration=1.0, sr=SAMPLE_RATE, name="silence"):
        return write_wav(self._path(name), make_silence(duration, sr), sr)

    def noise(self, duration=1.0, sr=SAMPLE_RATE, amp=0.3, seed=0, name="noise"):
        return write_wav(self._path(name), make_noise(duration, sr, amp, seed), sr)

    def chirp(self, duration=2.0, f0=300.0, f1=3000.0, sr=SAMPLE_RATE, amp=0.6, name="chirp"):
        return write_wav(self._path(name), make_chirp(duration, f0, f1, sr, amp), sr)

    def click_train(self, duration=2.0, rate_hz=8.0, sr=SAMPLE_RATE, amp=0.9, name="clicks"):
        return write_wav(self._path(name), make_click_train(duration, rate_hz, sr, amp), sr)

    def custom(self, y, sr=SAMPLE_RATE, name="custom"):
        return write_wav(self._path(name), y, sr)

    def silent_wav_bytes(self) -> bytes:
        """A tiny valid (but zero-duration-adjacent) WAV, for the empty-upload
        edge distinct from a truly empty file."""
        p = self._path("tiny")
        write_wav(p, make_silence(0.01), SAMPLE_RATE)
        return p.read_bytes()

    def junk_bytes(self, size=4096) -> bytes:
        """Bytes that are not audio at all (undecodable input)."""
        rng = np.random.default_rng(42)
        return rng.integers(0, 256, size=size, dtype=np.uint8).tobytes()

    def junk_file(self, name="junk.bin", size=4096) -> Path:
        p = self._path(name, ext="")
        p.write_bytes(self.junk_bytes(size))
        return p

    def raw_bytes_of(self, size: int) -> bytes:
        """Cheap arbitrary-size byte blob for size-limit tests (content need
        not be valid audio — the 20MB cap is enforced before decoding)."""
        return b"\x00" * size


@pytest.fixture
def audio_factory(tmp_path):
    return AudioFactory(tmp_path)


# --- isolated backend: temp data dir + temp SQLite ----------------------------

def _reload_backend(data_dir: Path, monkeypatch, frontend_dist: Path | None = None):
    """Point db/storage/main at a temp data dir and reload them so every
    module-level path + SQLAlchemy engine rebinds to it. Never touches the
    real data/ (ECHO_DATA_DIR seam) or the real frontend/dist
    (ECHO_FRONTEND_DIST seam)."""
    monkeypatch.setenv("ECHO_DATA_DIR", str(data_dir))
    if frontend_dist is not None:
        monkeypatch.setenv("ECHO_FRONTEND_DIST", str(frontend_dist))
    else:
        monkeypatch.delenv("ECHO_FRONTEND_DIST", raising=False)

    import db
    importlib.reload(db)
    import storage
    importlib.reload(storage)
    import samples
    importlib.reload(samples)
    import main
    importlib.reload(main)
    db.init_db()  # tables must exist before any direct storage.* call (not
                   # just via TestClient, which triggers this through startup)
    return main


@pytest.fixture
def isolated_backend(tmp_path, monkeypatch):
    """Reloaded db + storage + main modules bound to a temp data dir.

    Returns the `main` module; `main.db`-equivalent state is reachable via a
    fresh `import db` after this fixture runs (module identity is shared).
    """
    main = _reload_backend(tmp_path / "data", monkeypatch)
    import db
    import storage
    return main, db, storage


@pytest.fixture
def client(isolated_backend):
    """A TestClient for the isolated app (triggers startup -> init_db())."""
    from fastapi.testclient import TestClient
    main, _db, _storage = isolated_backend
    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def isolated_backend_with_frontend(tmp_path, monkeypatch):
    """Like isolated_backend, but with a fixture frontend/dist mounted via
    the ECHO_FRONTEND_DIST seam — for API-018 (StaticFiles must never
    shadow an API route)."""
    frontend_dist = tmp_path / "dist"
    frontend_dist.mkdir()
    (frontend_dist / "index.html").write_text("<html><body>Echo SPA fixture</body></html>")
    assets_dir = frontend_dist / "assets"
    assets_dir.mkdir()
    (assets_dir / "app.js").write_text("console.log('fixture asset');")

    main = _reload_backend(tmp_path / "data", monkeypatch, frontend_dist=frontend_dist)
    import db
    import storage
    return main, db, storage


@pytest.fixture
def client_with_frontend(isolated_backend_with_frontend):
    from fastapi.testclient import TestClient
    main, _db, _storage = isolated_backend_with_frontend
    with TestClient(main.app) as c:
        yield c


# --- fake ~/bin/rec stub (never the real wrapper) -----------------------------

@pytest.fixture
def rec_stub(tmp_path):
    """Factory for a throwaway script standing in for ~/bin/rec.

    The real wrapper's calling convention (per main.py): `rec <out_path>
    <duration_seconds>`. Tests monkeypatch `main.REC_WRAPPER` to point at the
    returned script — ~/bin/rec itself is never read, modified, or invoked.
    """
    fixture_wav = tmp_path / "rec_stub_source.wav"
    write_wav(fixture_wav, make_tone(duration=2.0, freq=440.0, amp=0.6), SAMPLE_RATE)

    def _make(behavior="ok"):
        script = tmp_path / f"fake_rec_{behavior}.sh"
        if behavior == "ok":
            body = f'#!/bin/sh\ncp "{fixture_wav}" "$1"\nexit 0\n'
        elif behavior == "fail":
            body = '#!/bin/sh\necho "simulated mic failure: audio open error" 1>&2\nexit 1\n'
        elif behavior == "empty":
            body = '#!/bin/sh\n: > "$1"\nexit 0\n'
        else:
            raise ValueError(f"unknown rec_stub behavior: {behavior}")
        script.write_text(body)
        script.chmod(0o755)
        return script

    return _make
