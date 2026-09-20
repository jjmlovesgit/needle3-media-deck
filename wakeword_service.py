"""CPU-only LiveKit wake-word service for the local Media Deck."""

from __future__ import annotations

import asyncio
import json
import threading
import time
from pathlib import Path


class WakeWordService:
    """Own the idle microphone and publish one-shot wake-word detections.

    The listener is fully closed before a detection is published. This is
    intentional: Chrome can then acquire the same microphone for command STT.
    Listening resumes only after the browser reports that command capture ended.
    """

    def __init__(self, root: Path, threshold: float = 0.55) -> None:
        self.model_path = root / "models" / "hey_jarvis_v0.1.onnx"
        self.settings_path = root / "state" / "wakeword_settings.json"
        self.threshold = threshold
        self._lock = threading.Lock()
        self._sequence_changed = threading.Condition(self._lock)
        self._changed = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._enabled = self._load_enabled()
        self._hold = False
        self._state = "starting" if self._enabled else "disabled"
        self._error = ""
        self._sequence = 0
        self._confidence = 0.0
        self._detected_at = 0.0

    def _load_enabled(self) -> bool:
        try:
            return bool(json.loads(self.settings_path.read_text(encoding="utf-8")).get("enabled", True))
        except (OSError, ValueError, TypeError):
            return True

    def _save_enabled(self) -> None:
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        self.settings_path.write_text(
            json.dumps({"enabled": self._enabled}, indent=2), encoding="utf-8"
        )

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(
            target=self._run, name="media-deck-wakeword", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._changed.set()
        with self._sequence_changed:
            self._sequence_changed.notify_all()

    def configure(self, enabled: bool) -> dict:
        with self._sequence_changed:
            self._enabled = bool(enabled)
            self._hold = False
            self._state = "starting" if self._enabled else "disabled"
            self._error = ""
            self._save_enabled()
            self._sequence_changed.notify_all()
        self._changed.set()
        return self.status()

    def resume(self) -> dict:
        with self._lock:
            self._hold = False
            if self._enabled:
                self._state = "starting"
        self._changed.set()
        return self.status()

    def pause(self) -> dict:
        with self._lock:
            self._hold = True
            if self._enabled:
                self._state = "pausing"
        self._changed.set()
        deadline = time.monotonic() + 2.5
        while time.monotonic() < deadline:
            with self._lock:
                if not self._enabled or self._state == "paused":
                    break
            time.sleep(0.02)
        return self.status()

    def status(self) -> dict:
        with self._lock:
            return {
                "available": self.model_path.is_file(),
                "enabled": self._enabled,
                "paused": self._hold,
                "state": self._state,
                "engine": "LiveKit Wake Word",
                "model": "Hey Jarvis",
                "modelPath": str(self.model_path),
                "threshold": self.threshold,
                "sequence": self._sequence,
                "confidence": round(self._confidence, 4),
                "detectedAt": self._detected_at,
                "error": self._error,
                "local": True,
                "processor": "CPU / ONNX Runtime",
            }

    def wait_for_detection(self, after_sequence: int, timeout: float = 20.0) -> dict:
        """Wait until a newer wake-word detection exists or the timeout expires."""
        after_sequence = max(0, int(after_sequence))
        timeout = min(30.0, max(0.1, float(timeout)))
        deadline = time.monotonic() + timeout
        with self._sequence_changed:
            while self._sequence <= after_sequence and not self._stop.is_set():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self._sequence_changed.wait(remaining)
        return self.status()

    async def _listen_once(self, model):
        from livekit.wakeword import WakeWordListener

        listener = WakeWordListener(model, threshold=self.threshold, debounce=2.0)
        async with listener:
            with self._lock:
                self._state = "listening"
                self._error = ""
            detection_task = asyncio.create_task(listener.wait_for_detection())
            try:
                while not self._stop.is_set():
                    with self._lock:
                        enabled = self._enabled
                        hold = self._hold
                    if not enabled or hold:
                        return None
                    done, _ = await asyncio.wait({detection_task}, timeout=0.1)
                    if done:
                        return detection_task.result()
            finally:
                if not detection_task.done():
                    detection_task.cancel()
                    try:
                        await detection_task
                    except asyncio.CancelledError:
                        pass
        return None

    def _run(self) -> None:
        model = None
        while not self._stop.is_set():
            with self._lock:
                enabled = self._enabled
                hold = self._hold
            if not enabled or hold:
                with self._lock:
                    self._state = "paused" if self._enabled and self._hold else "disabled"
                self._changed.wait(0.5)
                self._changed.clear()
                continue
            try:
                if not self.model_path.is_file():
                    raise FileNotFoundError(f"Wake-word model is missing: {self.model_path}")
                if model is None:
                    with self._lock:
                        self._state = "loading"
                    from livekit.wakeword import WakeWordModel

                    model = WakeWordModel(models=[self.model_path])
                detection = asyncio.run(self._listen_once(model))
                if detection is None:
                    continue
                # _listen_once has exited its context; PyAudio is now released.
                with self._sequence_changed:
                    self._sequence += 1
                    self._confidence = float(detection.confidence)
                    self._detected_at = time.time()
                    self._state = "triggered"
                    self._sequence_changed.notify_all()
                self._changed.clear()
                while not self._stop.is_set():
                    with self._lock:
                        if not self._enabled:
                            break
                    if self._changed.wait(0.25):
                        self._changed.clear()
                        break
            except Exception as exc:  # hardware/runtime faults remain visible in UI
                with self._lock:
                    self._state = "error"
                    self._error = str(exc)
                self._changed.wait(3.0)
                self._changed.clear()
