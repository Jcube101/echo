"""Echo — the analysis worker process (docs/LAUNCH.md §3, "option B").

ffmpeg + feature extraction is the only heavy work Echo does. It runs here, in
a separate long-lived process, instead of in a thread of the web server:

  - The web server stays responsive. Parts of the pitch analysis hold Python's
    global lock for seconds at a time; in a thread that froze every other
    request, in another process it can't.
  - A stuck analysis can be stopped. A thread can't be killed; this process is
    killed when a job passes its time limit, and a fresh one takes its place.
  - A crash in the audio libraries takes down the worker, not the site.

The web process sends one job at a time over a pipe and waits for the answer.
This module imports nothing heavy at the top: the web process imports it too,
and only the child loads the audio libraries.
"""

from __future__ import annotations

import logging
import multiprocessing
import threading

log = logging.getLogger("echo.worker")

_CTX = multiprocessing.get_context("spawn")  # never fork a threaded server


class AnalysisTimeout(Exception):
    """The job passed its time limit; the worker was killed."""


class AnalysisCrashed(Exception):
    """The worker died or failed in an unexpected way."""


def _warm_up() -> None:
    """Run one tiny extraction so the compiled-code cache is loaded before the
    first visitor's clip arrives. Best effort."""
    import os
    import tempfile

    import numpy as np
    import soundfile as sf

    import extraction

    fd, path = tempfile.mkstemp(suffix=".wav", prefix="echo_warm_")
    os.close(fd)
    try:
        t = np.linspace(0, 1.0, 22050, endpoint=False)
        sf.write(path, (0.5 * np.sin(2 * np.pi * 440 * t)).astype("float32"), 22050)
        extraction.extract_features(path)
        extraction.compute_spectrogram(path)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _child_main(conn, warm: bool) -> None:
    """The worker process: answer jobs until the pipe closes (which is also
    what happens if the web process dies, so no worker is left behind)."""
    import signal
    signal.signal(signal.SIGINT, signal.SIG_IGN)  # the parent decides when we stop

    import storage
    if warm:
        try:
            _warm_up()
        except Exception:
            pass
    while True:
        try:
            job = conn.recv()
        except (EOFError, OSError):
            return
        try:
            reply = ("ok", storage.process_audio(**job))
        except storage.ProcessingError as e:
            reply = ("bad_input", str(e))
        except Exception as e:  # report it; the parent decides what to do
            reply = ("error", f"{type(e).__name__}: {e}")
        try:
            conn.send(reply)
        except (EOFError, OSError):
            return


class AnalysisWorker:
    """One worker process, started on first use and replaced if it dies or is
    killed. `run` is blocking: call it from a thread, never the event loop."""

    def __init__(self, warm: bool = True):
        self._warm = warm
        self._lock = threading.Lock()   # one job at a time per worker
        self._proc = None
        self._conn = None

    @property
    def pid(self) -> int | None:
        return self._proc.pid if self._proc is not None and self._proc.is_alive() else None

    def start(self) -> None:
        with self._lock:
            self._ensure_started()

    def _ensure_started(self) -> None:
        if self._proc is not None and self._proc.is_alive():
            return
        self._discard()
        parent_conn, child_conn = _CTX.Pipe()
        self._proc = _CTX.Process(target=_child_main, args=(child_conn, self._warm),
                                  name="echo-analysis", daemon=True)
        self._proc.start()
        child_conn.close()  # the child holds its own copy
        self._conn = parent_conn

    def _discard(self) -> None:
        """Kill the worker outright (SIGKILL: it may be stuck in native code)."""
        if self._conn is not None:
            try:
                self._conn.close()
            except OSError:
                pass
        if self._proc is not None:
            if self._proc.is_alive():
                self._proc.kill()
            self._proc.join(timeout=5)
        self._proc = self._conn = None

    def run(self, job: dict, timeout_s: float) -> dict:
        """Run storage.process_audio(**job) in the worker and return its result.

        Raises storage.ProcessingError for a bad file (exactly as an in-process
        call would), AnalysisTimeout if the job overran (the worker is killed),
        AnalysisCrashed if the worker died or hit an unexpected error.
        """
        from storage import ProcessingError
        with self._lock:
            self._ensure_started()
            try:
                self._conn.send(job)
                if not self._conn.poll(timeout_s):
                    self._discard()
                    raise AnalysisTimeout()
                kind, payload = self._conn.recv()
            except (EOFError, OSError) as e:
                self._discard()
                raise AnalysisCrashed("the analysis worker stopped unexpectedly") from e
        if kind == "ok":
            return payload
        if kind == "bad_input":
            raise ProcessingError(payload)
        log.error("Analysis failed in the worker: %s", payload)
        raise AnalysisCrashed(payload)

    def stop(self) -> None:
        with self._lock:
            self._discard()
