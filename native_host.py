"""Chrome native-messaging host for the standalone karaoke extension."""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path

from karaoke_core import download_media, fetch_caption_script, render_karaoke, safe_file_stem, safe_run_name
from media_library import refresh_library_index


ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT = ROOT / "output"
STATE = ROOT / "state"
REGISTRY = STATE / "playback_registry.json"
SOURCE_CACHE = ROOT / "cache" / "youtube"
CAPTURES: dict[str, dict] = {}
MAX_CAPTURE_CHUNK = 768 * 1024
MAX_CAPTURE_BYTES = 1024 * 1024 * 1024


def refresh_default_library(created_path: str | Path | None = None):
    """Refresh the output index after a successful in-library media write."""
    if created_path is not None:
        try:
            Path(created_path).resolve().relative_to(DEFAULT_OUTPUT.resolve())
        except (OSError, ValueError):
            return
    refresh_library_index(DEFAULT_OUTPUT)


def send(message: dict):
    payload = json.dumps(message, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("@I", len(payload)))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def log(message: str):
    send({"type": "log", "message": message})


def progress(percent: int, message: str):
    send({"type": "progress", "percent": max(0, min(100, int(percent))), "message": message})


def receive():
    raw = sys.stdin.buffer.read(4)
    if not raw:
        return None
    length = struct.unpack("@I", raw)[0]
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def browse_folder(title: str = "Choose karaoke output folder") -> str:
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    selected = filedialog.askdirectory(title=title)
    root.destroy()
    return selected or ""


def browse_media_file() -> str:
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    selected = filedialog.askopenfilename(
        title="Choose an MP3 or MP4 file",
        filetypes=[("Playable media", "*.mp3 *.mp4"), ("MP3 audio", "*.mp3"), ("MP4 video", "*.mp4")],
    )
    root.destroy()
    return selected or ""


def list_media_files(folder: str) -> tuple[str, list[dict]]:
    """Return a bounded, recursive MP3/MP4 inventory for a selected folder."""
    directory = Path(folder).expanduser().resolve()
    if not directory.is_dir():
        raise ValueError("The selected music folder no longer exists.")
    files = []
    candidates = [item for item in directory.rglob("*") if item.suffix.lower() in {".mp3", ".mp4"}]
    for media in sorted(candidates, key=lambda item: str(item).lower()):
        if len(files) >= 500:
            break
        try:
            relative = str(media.relative_to(directory))
            size = media.stat().st_size
        except OSError:
            continue
        files.append({"path": str(media), "name": relative, "size": size})
    return str(directory), files


def _timestamp_seconds(value: str) -> int:
    parts = [int(part) for part in value.split(":")]
    if len(parts) == 2:
        minutes, seconds = parts
        hours = 0
    elif len(parts) == 3:
        hours, minutes, seconds = parts
    else:
        raise ValueError(f"Invalid timestamp: {value}")
    if minutes >= 60 or seconds >= 60:
        raise ValueError(f"Invalid timestamp: {value}")
    return hours * 3600 + minutes * 60 + seconds


def parse_album_tracklist(text: str) -> list[dict]:
    """Parse timestamp/title pairs, including timestamped Markdown links."""
    content = str(text or "").strip()
    if not content:
        raise ValueError("Paste a timestamped track list first.")
    content = re.sub(
        r"\[((?:\d{1,2}:)?\d{1,2}:\d{2})\]\([^)]*\)", r"\1", content
    )
    matches = list(re.finditer(r"(?<!\d)(\d{1,2}:\d{2}(?::\d{2})?)(?!\d)", content))
    tracks = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(content)
        title = re.sub(r"\s+", " ", content[match.end():end]).strip(" \t\r\n-|–—:;,.")
        title = re.sub(r"https?://\S+", "", title).strip(" \t\r\n-|–—:;,.")
        if not title:
            continue
        start = _timestamp_seconds(match.group(1))
        if tracks and start <= tracks[-1]["start"]:
            raise ValueError("Track timestamps must be in strictly increasing order.")
        tracks.append({"start": start, "timestamp": match.group(1), "title": title})
    if not tracks:
        raise ValueError("No timestamp/title pairs were found in the track list.")
    return tracks


def _audio_duration(path: Path) -> float:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise RuntimeError("FFprobe is required to split an album MP3.")
    completed = subprocess.run([
        ffprobe, "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ], capture_output=True, text=True, timeout=60)
    try:
        duration = float(completed.stdout.strip())
    except ValueError as exc:
        raise RuntimeError("Could not read the source MP3 duration.") from exc
    if completed.returncode != 0 or duration <= 0:
        raise RuntimeError((completed.stderr or "Could not read the source MP3 duration.").strip())
    return duration


def split_album_mp3(source_value: str, tracklist: str) -> dict:
    """Split an existing MP3 without re-encoding and return created track paths."""
    source = Path(source_value).expanduser().resolve()
    if not source.is_file() or source.suffix.lower() != ".mp3":
        raise ValueError("Choose an existing MP3 album file first.")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("FFmpeg is required to split an album MP3.")
    tracks = parse_album_tracklist(tracklist)
    duration = _audio_duration(source)
    if tracks[0]["start"] >= duration:
        raise ValueError("The first track begins after the source MP3 ends.")
    tracks = [track for track in tracks if track["start"] < duration]
    output_dir = source.parent / f"{safe_file_stem(source.stem)} - Tracks"
    output_dir.mkdir(parents=True, exist_ok=True)
    outputs = []
    for index, track in enumerate(tracks):
        end = tracks[index + 1]["start"] if index + 1 < len(tracks) else duration
        if end <= track["start"]:
            continue
        output = output_dir / f"{index + 1:02d} - {safe_file_stem(track['title'])}.mp3"
        progress(5 + int(90 * index / max(1, len(tracks))), f"Splitting track {index + 1} of {len(tracks)}: {track['title']}")
        completed = subprocess.run([
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-ss", f"{track['start']:.3f}", "-i", str(source),
            "-t", f"{end - track['start']:.3f}", "-map", "0:a:0",
            "-c:a", "copy", "-id3v2_version", "3",
            "-metadata", f"title={track['title']}",
            "-metadata", f"track={index + 1}/{len(tracks)}", str(output),
        ], capture_output=True, text=True, timeout=600)
        if completed.returncode != 0 or not output.is_file() or output.stat().st_size < 1024:
            output.unlink(missing_ok=True)
            detail = (completed.stderr or "FFmpeg could not split this track.").strip()
            raise RuntimeError(f"Track {index + 1} failed: {detail[-500:]}")
        outputs.append(str(output))
    progress(97, "Updating media library")
    refresh_default_library(output_dir)
    progress(100, f"Album split complete: {len(outputs)} tracks")
    return {"outputDir": str(output_dir), "files": outputs, "trackCount": len(outputs)}


def ensure_playback_server():
    try:
        with urllib.request.urlopen("http://127.0.0.1:8765/health", timeout=0.5) as response:
            if response.status == 200:
                return
    except Exception:
        pass
    flags = 0
    if os.name == "nt":
        flags = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS
    subprocess.Popen(
        [sys.executable, str(ROOT / "playback_server.py")],
        cwd=ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, creationflags=flags,
    )
    for _ in range(30):
        time.sleep(0.1)
        try:
            urllib.request.urlopen("http://127.0.0.1:8765/health", timeout=0.3).close()
            return
        except Exception:
            continue
    raise RuntimeError("Local playback server did not start on port 8765.")


def register_playback(path: str) -> str:
    STATE.mkdir(parents=True, exist_ok=True)
    try:
        registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        registry = {}
    token = uuid.uuid4().hex
    registry[token] = str(Path(path).resolve())
    temporary = REGISTRY.with_suffix(".tmp")
    temporary.write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    temporary.replace(REGISTRY)
    ensure_playback_server()
    return f"http://127.0.0.1:8765/play/{token}"


def begin_tab_capture(message: dict):
    recording_id = str(message.get("recordingId") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,80}", recording_id):
        raise ValueError("Invalid tab-recording identifier.")
    if recording_id in CAPTURES:
        raise ValueError("That tab recording is already active.")
    title = str(message.get("title") or "Suno Tab Recording").strip()
    title = re.sub(r"\s*[|·-]\s*Suno\s*$", "", title, flags=re.IGNORECASE).strip() or "Suno Tab Recording"
    output_root = Path(str(message.get("outputDir") or "").strip()) if message.get("outputDir") else DEFAULT_OUTPUT
    output_root.mkdir(parents=True, exist_ok=True)
    run_dir = output_root / safe_run_name(title, f"{recording_id}_tab_recording")
    run_dir.mkdir(parents=True, exist_ok=False)
    source = run_dir / "_tab_recording.webm"
    source.touch()
    CAPTURES[recording_id] = {
        "title": title, "run_dir": run_dir, "source": source,
        "next_index": 0, "bytes": 0,
    }
    send({"type": "capture_ready", "recordingId": recording_id})


def append_tab_capture(message: dict):
    recording_id = str(message.get("recordingId") or "")
    capture = CAPTURES.get(recording_id)
    if not capture:
        raise ValueError("The tab recording session is no longer active.")
    index = int(message.get("index", -1))
    if index != capture["next_index"]:
        raise ValueError("Tab-recording chunks arrived out of order.")
    try:
        chunk = base64.b64decode(str(message.get("data") or ""), validate=True)
    except Exception as exc:
        raise ValueError("A tab-recording chunk was invalid.") from exc
    if not chunk or len(chunk) > MAX_CAPTURE_CHUNK:
        raise ValueError("A tab-recording chunk had an invalid size.")
    if capture["bytes"] + len(chunk) > MAX_CAPTURE_BYTES:
        raise ValueError("Tab recording exceeded the 1 GiB safety limit.")
    with capture["source"].open("ab") as stream:
        stream.write(chunk)
    capture["bytes"] += len(chunk)
    capture["next_index"] += 1


def finish_tab_capture(message: dict):
    recording_id = str(message.get("recordingId") or "")
    capture = CAPTURES.pop(recording_id, None)
    if not capture:
        raise ValueError("The tab recording session is no longer active.")
    source = capture["source"]
    run_dir = capture["run_dir"]
    output = run_dir / f"{safe_file_stem(capture['title'])} - Tab Recording.mp3"
    try:
        if capture["bytes"] < 32 * 1024:
            raise ValueError("The tab recording was empty or too short to save.")
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError("FFmpeg is required to convert the tab recording to MP3.")
        progress(92, "Converting tab recording to MP3")
        completed = subprocess.run([
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(source), "-vn", "-codec:a", "libmp3lame", "-b:a", "320k",
            "-ar", "48000", str(output),
        ], capture_output=True, text=True, timeout=1800)
        if completed.returncode != 0 or not output.is_file() or output.stat().st_size < 32 * 1024:
            detail = (completed.stderr or completed.stdout or "FFmpeg could not convert the recording.").strip()
            raise RuntimeError(detail[-700:])
        source.unlink(missing_ok=True)
        progress(98, "Registering recorded MP3")
        result = {
            "type": "capture_complete", "recordingId": recording_id,
            "run_dir": str(run_dir), "output": str(output), "title": capture["title"],
            "format": "mp3", "sourceOrigin": "user_tab_recording",
            "playbackUrl": register_playback(str(output)),
        }
        refresh_default_library(output)
        progress(100, "Suno tab recording saved as MP3")
        send(result)
    except Exception:
        source.unlink(missing_ok=True)
        output.unlink(missing_ok=True)
        try:
            run_dir.rmdir()
        except OSError:
            pass
        raise


def cancel_tab_capture(message: dict):
    recording_id = str(message.get("recordingId") or "")
    capture = CAPTURES.pop(recording_id, None)
    if not capture:
        return
    capture["source"].unlink(missing_ok=True)
    try:
        capture["run_dir"].rmdir()
    except OSError:
        pass


def handle(message: dict):
    action = message.get("action")
    if action == "browse_folder":
        send({"type": "browse_result", "outputDir": browse_folder()})
    elif action in {"browse_media_folder", "scan_media_folder"}:
        selected = (
            browse_folder("Choose local MP3 / MP4 library folder")
            if action == "browse_media_folder"
            else str(message.get("folder") or "")
        )
        if selected:
            folder, files = list_media_files(selected)
            send({"type": "media_library", "folder": folder, "files": files})
        else:
            send({"type": "media_library_cancelled"})
    elif action == "browse_media_file":
        selected = browse_media_file()
        if selected:
            media = Path(selected).resolve()
            send({"type": "media_file", "file": {"path": str(media), "name": media.name, "size": media.stat().st_size}})
        else:
            send({"type": "media_file_cancelled"})
    elif action == "parse_album_tracklist":
        send({"type": "album_tracks", "tracks": parse_album_tracklist(str(message.get("tracklist") or ""))})
    elif action == "split_album":
        result = split_album_mp3(str(message.get("source") or ""), str(message.get("tracklist") or ""))
        send({"type": "album_split_complete", **result})
    elif action == "fetch_transcript":
        script = fetch_caption_script(str(message.get("url") or ""), log=log)
        send({"type": "transcript", "script": script})
    elif action == "render_karaoke":
        script = message.get("script")
        if not isinstance(script, dict) or not script.get("cues"):
            raise ValueError("Fetch and review a transcript before rendering.")
        output_root = Path(str(message.get("outputDir") or "").strip()) if message.get("outputDir") else DEFAULT_OUTPUT
        output_root.mkdir(parents=True, exist_ok=True)
        result = render_karaoke(
            script, output_root, str(message.get("layout") or "right_roll"), log, progress,
            SOURCE_CACHE,
        )
        progress(97, "Registering local playback")
        result["playbackUrl"] = register_playback(result["output"])
        progress(99, "Updating media library")
        refresh_default_library(result["output"])
        progress(100, "Karaoke MP4 complete")
        send({"type": "render_complete", **result})
    elif action in {"download_mp4", "download_mp3"}:
        output_root = Path(str(message.get("outputDir") or "").strip()) if message.get("outputDir") else DEFAULT_OUTPUT
        output_root.mkdir(parents=True, exist_ok=True)
        kind = action.removeprefix("download_")
        result = download_media(
            str(message.get("url") or ""), output_root, kind, log, progress, SOURCE_CACHE,
        )
        progress(99, "Updating media library")
        refresh_default_library(result.get("output"))
        progress(100, f"{kind.upper()} download complete")
        send({"type": "download_complete", **result})
    elif action == "capture_begin":
        begin_tab_capture(message)
    elif action == "capture_chunk":
        append_tab_capture(message)
    elif action == "capture_end":
        finish_tab_capture(message)
    elif action == "capture_cancel":
        cancel_tab_capture(message)
    elif action == "play_file":
        media = Path(str(message.get("path") or "")).resolve()
        if not media.is_file() or media.suffix.lower() not in {".mp4", ".mp3"}:
            raise ValueError("The saved media file was moved, deleted, or is not playable.")
        send({"type": "playback_ready", "playbackUrl": register_playback(str(media))})
    else:
        raise ValueError(f"Unsupported action: {action}")


def main():
    DEFAULT_OUTPUT.mkdir(parents=True, exist_ok=True)
    log("[ready] Karaoke native host connected.")
    try:
        while True:
            message = receive()
            if message is None:
                return
            try:
                handle(message)
            except Exception as exc:
                if message.get("action") == "capture_chunk":
                    cancel_tab_capture(message)
                send({"type": "error", "message": str(exc)})
    finally:
        for recording_id in list(CAPTURES):
            cancel_tab_capture({"recordingId": recording_id})


if __name__ == "__main__":
    main()
