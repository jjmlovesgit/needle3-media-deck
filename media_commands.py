"""Local Cactus Needle command routing for Media Deck."""

from __future__ import annotations

import importlib.util
import os
import re
import threading
import time
from pathlib import Path


# Cactus enables telemetry by default. Media Deck's local command path does not.
os.environ["NEEDLE_TELEMETRY"] = "0"
os.environ["DO_NOT_TRACK"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

ROOT = Path(__file__).resolve().parent
TOOL_INDEX = ROOT / "state" / "needle_tool_index_v3.bin"
_agent = None
_agent_lock = threading.RLock()

EQ_PRESETS = ("Flat", "Rock", "Pop", "Jazz", "Classical", "Vocal", "Bass Boost", "Dance", "Acoustic")
MEDIA_KINDS = ("any", "mp3", "original_video", "karaoke")
LIBRARY_VIEWS = ("all", "albums", "mp3", "original_video", "karaoke")
LIBRARY_SORTS = ("title", "newest", "bitrate", "duration")
KARAOKE_SPEECH_PATTERN = r"\b(?:karaoke|karoake|karaoki|karaokie|karoki|kuroki)(?:\s+version)?\b"

TOOLS = [
    {
        "name": "control_playback",
        "description": "Control only the track that is already loaded in Media Deck. Never use this when the user names an artist, song, album, or media title; named requests must use play_media.",
        "parameters": {"type": "object", "properties": {
            "action": {"type": "string", "enum": ["play", "pause", "toggle", "stop"]},
        }, "required": ["action"]},
        "triggers": ["pause", "resume", "continue", "stop", "play current", "resume playback"],
    },
    {
        "name": "seek_playback",
        "description": "Move the current track forward or backward by a requested number of seconds.",
        "parameters": {"type": "object", "properties": {
            "direction": {"type": "string", "enum": ["forward", "backward"]},
            "seconds": {"type": "integer", "minimum": 1, "maximum": 3600},
        }, "required": ["direction", "seconds"]},
        "triggers": ["skip", "forward", "rewind", "back"],
    },
    {
        "name": "set_volume",
        "description": "Set Media Deck playback volume to an exact percentage from 0 through 100.",
        "parameters": {"type": "object", "properties": {
            "percent": {"type": "integer", "minimum": 0, "maximum": 100},
        }, "required": ["percent"]},
        "triggers": ["volume", "louder", "quieter"],
    },
    {
        "name": "set_mute",
        "description": "Mute or unmute the currently loaded Media Deck track.",
        "parameters": {"type": "object", "properties": {
            "muted": {"type": "boolean"},
        }, "required": ["muted"]},
        "triggers": ["mute", "unmute", "sound on"],
    },
    {
        "name": "apply_equalizer_preset",
        "description": "Apply one of Media Deck's built-in stereo equalizer presets.",
        "parameters": {"type": "object", "properties": {
            "preset": {"type": "string", "enum": list(EQ_PRESETS)},
        }, "required": ["preset"]},
        "triggers": ["equalizer", "EQ", "preset", "rock", "jazz", "classical"],
    },
    {
        "name": "show_library",
        "description": "Open and filter the Media Library, optionally changing its sort order.",
        "parameters": {"type": "object", "properties": {
            "category": {"type": "string", "enum": list(LIBRARY_VIEWS)},
            "sort": {"type": "string", "enum": list(LIBRARY_SORTS)},
        }, "required": ["category"]},
        "triggers": ["show", "library", "albums", "MP3", "karaoke", "sort"],
    },
    {
        "name": "play_media",
        "description": "Find and load saved media whenever the user says play followed by an artist, song, album, or title. Preserve the spoken title in the title argument. Format any means no format preference.",
        "parameters": {"type": "object", "properties": {
            "title": {"type": "string", "minLength": 1, "maxLength": 160},
            "format": {"type": "string", "enum": list(MEDIA_KINDS)},
        }, "required": ["title"]},
        "triggers": ["play", "play song", "play track", "play album", "play artist", "karaoke version", "original video"],
    },
    {
        "name": "set_panel",
        "description": "Open, expand, close, or collapse any Media Deck panel. Performance Monitor means monitor; Graphic Equalizer or EQ means equalizer; Media Library means library; Media Deck Command means command.",
        "parameters": {"type": "object", "properties": {
            "panel": {"type": "string", "enum": ["monitor", "command", "equalizer", "library"]},
            "open": {"type": "boolean"},
        }, "required": ["panel", "open"]},
        "triggers": ["open panel", "close panel", "expand", "collapse", "close equalizer", "close library", "close monitor", "close command"],
    },
]


def command_status() -> dict:
    return {
        "available": importlib.util.find_spec("needle") is not None,
        "loaded": _agent is not None,
        "model": "Cactus Needle 3",
        "telemetry": False,
    }


def _get_agent():
    global _agent
    if _agent is not None:
        return _agent
    with _agent_lock:
        if _agent is None:
            try:
                import needle
            except ImportError as exc:
                raise RuntimeError("Cactus Needle is not installed. Run setup again to enable local commands.") from exc
            TOOL_INDEX.parent.mkdir(parents=True, exist_ok=True)
            _agent = needle.Needle(
                tools=TOOLS,
                system="device: Windows Media Deck; network: local-only; routing rule: play plus any named artist, song, album, or title must call play_media, while control_playback play is only for resuming the currently loaded item",
                tool_index_path=str(TOOL_INDEX),
                auto_date=True,
            )
    return _agent


def _validated_call(call: dict) -> dict | None:
    if not isinstance(call, dict):
        return None
    name = str(call.get("name") or "")
    args = call.get("arguments")
    if not isinstance(args, dict):
        return None
    if name == "control_playback" and args.get("action") in {"play", "pause", "toggle", "stop"}:
        return {"name": name, "arguments": {"action": args["action"]}}
    if name == "seek_playback" and args.get("direction") in {"forward", "backward"}:
        try:
            seconds = max(1, min(3600, int(args.get("seconds"))))
        except (TypeError, ValueError):
            return None
        return {"name": name, "arguments": {"direction": args["direction"], "seconds": seconds}}
    if name == "set_volume":
        try:
            percent = max(0, min(100, int(args.get("percent"))))
        except (TypeError, ValueError):
            return None
        return {"name": name, "arguments": {"percent": percent}}
    if name == "set_mute" and isinstance(args.get("muted"), bool):
        return {"name": name, "arguments": {"muted": args["muted"]}}
    if name == "apply_equalizer_preset" and args.get("preset") in EQ_PRESETS:
        return {"name": name, "arguments": {"preset": args["preset"]}}
    if name == "show_library" and args.get("category") in LIBRARY_VIEWS:
        validated = {"category": args["category"]}
        if args.get("sort") in LIBRARY_SORTS:
            validated["sort"] = args["sort"]
        return {"name": name, "arguments": validated}
    if name == "play_media":
        title = str(args.get("title") or "").strip()[:160]
        media_format = args.get("format", "any")
        if title and media_format in MEDIA_KINDS:
            return {"name": name, "arguments": {"title": title, "format": media_format}}
    if name == "set_panel" and args.get("panel") in {"monitor", "command", "equalizer", "library"} and isinstance(args.get("open"), bool):
        return {"name": name, "arguments": {"panel": args["panel"], "open": args["open"]}}
    return None


def _repair_named_play(text: str, calls: list[dict]) -> tuple[list[dict], bool]:
    """Preserve the full spoken title and prevent a named request becoming transport play."""
    match = re.match(r"^\s*(?:please\s+)?play\s+(.+?)\s*$", text, flags=re.IGNORECASE)
    if not match:
        return calls, False
    title = match.group(1).strip()
    generic = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()
    if generic in {
        "it", "this", "that", "music", "audio", "playback", "current", "current track",
        "current song", "the current track", "the current song", "song", "track", "loudly", "louder",
    }:
        return calls, False
    media_format = "any"
    if re.search(KARAOKE_SPEECH_PATTERN, title, flags=re.IGNORECASE):
        media_format = "karaoke"
        title = re.sub(KARAOKE_SPEECH_PATTERN, "", title, flags=re.IGNORECASE).strip(" -")
    elif re.search(r"\b(?:original\s+video|mp4)\b", title, flags=re.IGNORECASE):
        media_format = "original_video"
        title = re.sub(r"\b(?:original\s+video|mp4)\b", "", title, flags=re.IGNORECASE).strip(" -")
    elif re.search(r"\bmp3\b", title, flags=re.IGNORECASE):
        media_format = "mp3"
        title = re.sub(r"\bmp3\b", "", title, flags=re.IGNORECASE).strip(" -")
    if not title:
        return calls, False
    named_call = {"name": "play_media", "arguments": {"title": title, "format": media_format}}
    if any(call.get("name") == "play_media" for call in calls):
        repaired = [named_call if call.get("name") == "play_media" else call for call in calls]
        return repaired, repaired != calls
    if len(calls) != 1 or calls[0] != {"name": "control_playback", "arguments": {"action": "play"}}:
        return calls, False
    return [named_call], True


def _repair_panel_command(text: str, calls: list[dict]) -> tuple[list[dict], bool]:
    """Make direct panel open/close language deterministic."""
    match = re.match(
        r"^\s*(open|show|expand|close|hide|collapse)\s+(?:the\s+)?(.+?)(?:\s+panel)?\s*$",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return calls, False
    action, spoken_panel = match.groups()
    normalized = re.sub(r"[^a-z0-9]+", " ", spoken_panel.lower()).strip()
    aliases = {
        "monitor": "monitor",
        "performance monitor": "monitor",
        "command": "command",
        "media deck command": "command",
        "voice command": "command",
        "equalizer": "equalizer",
        "graphic equalizer": "equalizer",
        "eq": "equalizer",
        "library": "library",
        "media library": "library",
    }
    panel = aliases.get(normalized)
    if not panel:
        return calls, False
    repaired = [{
        "name": "set_panel",
        "arguments": {"panel": panel, "open": action.lower() in {"open", "show", "expand"}},
    }]
    return repaired, repaired != calls


def route_command(query: str) -> dict:
    text = str(query or "").strip()
    if not text:
        raise ValueError("Enter a Media Deck command first.")
    if len(text) > 500:
        raise ValueError("Media Deck commands are limited to 500 characters.")
    started = time.perf_counter()
    with _agent_lock:
        was_loaded = _agent is not None
        load_started = time.perf_counter()
        agent = _get_agent()
        initialization_ms = round((time.perf_counter() - load_started) * 1000)
        response = agent.complete(text=text, max_new_tokens=384)
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    calls = [validated for call in response.get("function_calls", []) if (validated := _validated_call(call))]
    calls, named_play_adjusted = _repair_named_play(text, calls)
    calls, panel_adjusted = _repair_panel_command(text, calls)
    routing_adjusted = named_play_adjusted or panel_adjusted
    confidence = response.get("confidence")
    return {
        "query": text,
        "calls": calls,
        "confidence": float(confidence) if isinstance(confidence, (int, float)) else None,
        "reasoning": str(response.get("reasoning") or "")[:500],
        "model": "Cactus Needle 3",
        "modelLoaded": True,
        "wasLoaded": was_loaded,
        "initializationMs": initialization_ms,
        "elapsedMs": elapsed_ms,
        "routingAdjusted": routing_adjusted,
        "telemetry": False,
    }
