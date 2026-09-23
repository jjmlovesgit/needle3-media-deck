"""Loopback-only LiveKit Hey Jarvis wake-word service for Media Deck."""
from __future__ import annotations

import argparse
import asyncio
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class WakeWordService:
    def __init__(self, model_path: Path, threshold: float = 0.55) -> None:
        self.model_path = model_path
        self.threshold = threshold
        self._lock = threading.Lock()
        self._changed = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        try:
            import livekit.wakeword  # noqa: F401
            self._runtime_error = ""
        except Exception as exc:
            self._runtime_error = "LiveKit wake-word runtime is unavailable: " + str(exc)
        self._enabled = False
        self._hold = False
        self._state = "disabled"
        self._error = ""
        self._sequence = 0
        self._confidence = 0.0
        self._detected_at = 0.0

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, name="media-deck-wakeword", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._changed.set()

    def configure(self, enabled: bool) -> dict:
        with self._lock:
            self._enabled = bool(enabled)
            self._hold = False
            self._state = "starting" if self._enabled else "disabled"
            self._error = ""
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

    def resume(self) -> dict:
        with self._lock:
            self._hold = False
            if self._enabled:
                self._state = "starting"
        self._changed.set()
        return self.status()

    def status(self) -> dict:
        with self._lock:
            return {
                "available": self.model_path.is_file() and not self._runtime_error,
                "enabled": self._enabled,
                "paused": self._hold,
                "state": self._state,
                "engine": "LiveKit Wake Word",
                "model": "Hey Jarvis",
                "threshold": self.threshold,
                "sequence": self._sequence,
                "confidence": round(self._confidence, 4),
                "detectedAt": self._detected_at,
                "error": self._error or self._runtime_error,
                "local": True,
                "processor": "CPU / ONNX Runtime",
            }

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
                        enabled, hold = self._enabled, self._hold
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
                enabled, hold = self._enabled, self._hold
            if not enabled or hold:
                with self._lock:
                    self._state = "paused" if self._enabled and self._hold else "disabled"
                self._changed.wait(0.5)
                self._changed.clear()
                continue
            try:
                if not self.model_path.is_file():
                    raise FileNotFoundError("Wake-word model is missing.")
                if model is None:
                    with self._lock:
                        self._state = "loading"
                    from livekit.wakeword import WakeWordModel
                    model = WakeWordModel(models=[self.model_path])
                detection = asyncio.run(self._listen_once(model))
                if detection is None:
                    continue
                # The listener context has closed, so Chrome can acquire the microphone.
                with self._lock:
                    self._sequence += 1
                    self._confidence = float(detection.confidence)
                    self._detected_at = time.time()
                    self._state = "triggered"
                self._changed.clear()
                while not self._stop.is_set():
                    with self._lock:
                        if not self._enabled:
                            break
                    if self._changed.wait(0.25):
                        self._changed.clear()
                        break
            except Exception as exc:
                with self._lock:
                    self._state = "error"
                    self._error = str(exc)
                self._changed.wait(3.0)
                self._changed.clear()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--model", required=True)
    parser.add_argument("--token", required=True)
    args = parser.parse_args()
    service = WakeWordService(Path(args.model))

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def _authorized(self) -> bool:
            return self.headers.get("X-Media-Deck-Wakeword-Token") == args.token

        def _json(self, value: dict, status: int = 200) -> None:
            body = json.dumps(value).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if not self._authorized() or self.path != "/status":
                self._json({"error": "Not found."}, 404)
                return
            self._json(service.status())

        def do_POST(self):
            if not self._authorized() or self.path not in {"/config", "/pause", "/resume"}:
                self._json({"error": "Not found."}, 404)
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if size > 4096:
                    raise ValueError("Request is too large.")
                data = json.loads(self.rfile.read(size) or b"{}")
                if self.path == "/config":
                    if not isinstance(data.get("enabled"), bool):
                        raise ValueError("Wake-word enabled must be true or false.")
                    state = service.configure(data["enabled"])
                elif self.path == "/pause":
                    state = service.pause()
                else:
                    state = service.resume()
                self._json(state)
            except (ValueError, json.JSONDecodeError) as exc:
                self._json({"error": str(exc)}, 400)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(json.dumps({"event": "ready", "port": server.server_port}), flush=True)
    service.start()
    try:
        server.serve_forever()
    finally:
        service.stop()
        server.server_close()


if __name__ == "__main__":
    main()
