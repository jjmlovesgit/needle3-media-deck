"""Incremental metadata index for the local karaoke output library."""

from __future__ import annotations

import json
import hashlib
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT = ROOT / "output"
INDEX_PATH = ROOT / "state" / "library_index.json"


def _content_fingerprint(media: Path, size: int) -> str:
    """Return a fast, stable signature using the start, middle, and end of a file."""
    digest = hashlib.sha256()
    digest.update(str(size).encode("ascii"))
    sample_size = 1024 * 1024
    with media.open("rb") as stream:
        offsets = (0, max(0, size // 2 - sample_size // 2), max(0, size - sample_size))
        for offset in offsets:
            stream.seek(offset)
            digest.update(stream.read(sample_size))
    return digest.hexdigest()


def _display_title(media: Path) -> str:
    if media.name.lower() in {"karaoke.mp4", "source.mp4", "video.mp4", "audio.mp3"}:
        parent = re.sub(r"_\d{8}_\d{6}_.+$", "", media.parent.name)
        title = parent.replace("_", " ")
    else:
        title = media.stem
    title = re.sub(r"^\d{1,3}\s*[-._]\s*", "", title)
    return re.sub(r"\s+", " ", title.replace("_", " ")).strip()


def _kind(media: Path) -> str:
    if media.suffix.lower() == ".mp3":
        return "mp3"
    value = f"{media.parent.name} {media.name}".lower()
    return "karaoke" if "karaoke" in value else "original_video"


def _probe(media: Path) -> dict:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return {}
    command = [
        ffprobe, "-v", "error", "-show_entries",
        "format=duration,bit_rate,format_name:stream=codec_type,codec_name,sample_rate,channels,channel_layout,width,height,r_frame_rate,bit_rate",
        "-of", "json", str(media),
    ]
    try:
        data = json.loads(subprocess.run(command, capture_output=True, text=True, timeout=20, check=True).stdout)
    except (OSError, ValueError, subprocess.SubprocessError):
        return {}
    result = {"duration": round(float(data.get("format", {}).get("duration") or 0), 2),
              "bitrate": int(data.get("format", {}).get("bit_rate") or 0),
              "container": data.get("format", {}).get("format_name", "")}
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "audio" and "audio" not in result:
            result["audio"] = {key: stream.get(key) for key in ("codec_name", "sample_rate", "channels", "channel_layout", "bit_rate")}
        if stream.get("codec_type") == "video" and "video" not in result:
            result["video"] = {key: stream.get(key) for key in ("codec_name", "width", "height", "r_frame_rate", "bit_rate")}
    return result


def load_library_index() -> dict:
    try:
        return json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"root": str(DEFAULT_OUTPUT), "generatedAt": None, "counts": {}, "items": [], "albums": []}


def refresh_library_index(output_root: Path | str = DEFAULT_OUTPUT) -> dict:
    root = Path(output_root).expanduser().resolve()
    prior_index = load_library_index()
    previous = {item["path"]: item for item in prior_index.get("files", prior_index.get("items", []))}
    items = []
    if root.is_dir():
        for media in sorted((path for path in root.rglob("*") if path.suffix.lower() in {".mp3", ".mp4"}), key=lambda path: str(path).lower()):
            try:
                stat = media.stat()
            except OSError:
                continue
            cached = previous.get(str(media))
            signature = {"size": stat.st_size, "mtimeNs": stat.st_mtime_ns}
            if (cached and cached.get("size") == signature["size"]
                    and cached.get("mtimeNs") == signature["mtimeNs"]
                    and cached.get("contentHash")):
                item = cached
            else:
                item = {"path": str(media), "relative": str(media.relative_to(root)), "name": media.name,
                        "title": _display_title(media), "kind": _kind(media), **signature,
                        "contentHash": _content_fingerprint(media, stat.st_size), **_probe(media)}
            parent = media.parent
            item["albumKey"] = str(parent) if media.suffix.lower() == ".mp3" else ""
            item["album"] = re.sub(r"\s*-\s*Tracks$", "", parent.name, flags=re.I).replace("_", " ") if item["albumKey"] else ""
            items.append(item)
    all_items = items
    unique_items = []
    duplicates = []
    seen = {}
    # Prefer the newest copy, then the shortest/clearest relative path.
    for item in sorted(items, key=lambda entry: (
        0 if re.search(r"tracks$", Path(entry["path"]).parent.name, re.I) else 1,
        -entry.get("mtimeNs", 0), len(entry.get("relative", "")), entry.get("relative", "").lower(),
    )):
        identity = (item.get("kind"), item.get("size"), item.get("contentHash"))
        original = seen.get(identity)
        if original:
            duplicates.append({
                "path": item["path"], "relative": item["relative"], "title": item["title"],
                "kind": item["kind"], "duplicateOf": original["path"],
            })
        else:
            seen[identity] = item
            unique_items.append(item)
    items = unique_items
    album_groups = {}
    for item in items:
        if item.get("kind") == "mp3":
            album_groups.setdefault(item["albumKey"], []).append(item)
    albums = [{"key": key, "title": group[0]["album"], "trackCount": len(group)}
              for key, group in album_groups.items() if len(group) > 1 or re.search(r"tracks$", Path(key).name, re.I)]
    counts = {"all": len(items), "total": len(items) + len(duplicates), "duplicatesHidden": len(duplicates),
              "mp3": sum(item["kind"] == "mp3" for item in items),
              "original_video": sum(item["kind"] == "original_video" for item in items),
              "karaoke": sum(item["kind"] == "karaoke" for item in items), "albums": len(albums)}
    index = {"root": str(root), "generatedAt": datetime.now(timezone.utc).isoformat(), "counts": counts,
             "items": items, "files": all_items, "albums": albums, "duplicates": duplicates}
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = INDEX_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(index, indent=2), encoding="utf-8")
    temporary.replace(INDEX_PATH)
    return index
