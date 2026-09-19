"""Caption retrieval and karaoke rendering for the standalone extension."""

from __future__ import annotations

import json
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen


YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}
SUNO_HOSTS = {"suno.com", "www.suno.com"}
SIDE_PANEL_LAYOUTS = {"right_roll", "modern_karaoke"}

# Accessibility captions often contain scene descriptions rather than words that
# should be sung.  Keep this deliberately limited to audio/context labels so a
# legitimate lyric containing brackets is not removed indiscriminately.
CONTEXT_LABEL = re.compile(
    r"[\[(]\s*(?:"
    r"music|singing|song|instrumental|applause|clapping|laughter|laughs?|"
    r"cheering|cheers|crowd|audience|background\s+(?:music|noise)|noise|"
    r"inaudible|silence|speaking|speech|vocalizing|humming|hums?|whistling|"
    r"gasps?|gasping|sighs?|sighing|breathes?|breathing|coughs?|coughing|"
    r"sneezes?|sneezing|groans?|groaning|sobs?|sobbing|crying|chuckles?|giggles?"
    r")[^\])]*[\])]",
    re.IGNORECASE,
)


def clean_caption_text(text: str) -> str:
    """Remove non-lyric caption annotations while retaining any lyric text."""
    value = str(text or "").strip()
    # A standalone square-bracket cue is an accessibility annotation, even if
    # YouTube supplies a label we have not encountered before.
    if re.fullmatch(r"\[[^\]\r\n]+\]", value):
        return ""
    value = CONTEXT_LABEL.sub(" ", value)
    # YouTube uses leading chevrons as a speaker-change marker. A marker-only
    # cue is empty after this substitution and is therefore discarded.
    value = re.sub(r"^\s*(?:(?:>>|»|›)\s*)+", "", value)
    return re.sub(r"\s+", " ", value).strip(" -–—:;")


def validate_youtube_url(url: str) -> str:
    value = str(url or "").strip()
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in YOUTUBE_HOSTS:
        raise ValueError("Enter a valid YouTube watch or share URL.")
    return value


def validate_download_url(url: str) -> tuple[str, str]:
    """Validate a direct-download URL and return its provider name."""
    value = str(url or "").strip()
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Enter a valid YouTube or Suno URL.")
    if parsed.hostname in YOUTUBE_HOSTS:
        return value, "youtube"
    if parsed.hostname in SUNO_HOSTS:
        if not re.match(r"^/(?:song|s)/[^/?#]+/?$", parsed.path, re.IGNORECASE):
            raise ValueError("Enter a public Suno song/share URL, not a playlist or library page.")
        return value, "suno"
    raise ValueError("Enter a valid YouTube or Suno URL.")


class _SunoMetaParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta: dict[str, str] = {}
        self.in_title = False
        self.title_parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag.casefold() == "meta":
            key = str(values.get("property") or values.get("name") or "").casefold()
            content = str(values.get("content") or "").strip()
            if key and content:
                self.meta[key] = content
        elif tag.casefold() == "title":
            self.in_title = True

    def handle_endtag(self, tag):
        if tag.casefold() == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title_parts.append(data)


def _extract_suno_metadata(page: str, fallback_id: str) -> tuple[str, str]:
    """Extract the real public audio stream and display title from a Suno page."""
    parser = _SunoMetaParser()
    parser.feed(page)
    # Next.js serializes the clip inside a streamed script payload, where JSON
    # quotes are escaped. A normalized read-only view keeps the matching logic
    # independent of whether Suno emits ordinary JSON or that wire format.
    search_page = page.replace('\\"', '"')
    raw_audio = ""
    # Current Suno pages embed a clip object whose media_urls entry is the real
    # progressive track. Match the requested song ID so related-song cards on
    # the same page cannot be selected accidentally.
    clip_match = re.search(
        rf'"id":"{re.escape(fallback_id)}"(?P<body>.{{0,16000}}?)"image_url"',
        search_page, re.IGNORECASE | re.DOTALL,
    )
    if clip_match:
        media_match = re.search(
            r'"media_urls":\[(?P<items>.*?)\]', clip_match.group("body"),
            re.IGNORECASE | re.DOTALL,
        )
        if media_match:
            url_match = re.search(r'"url":"([^"]+)"', media_match.group("items"))
            raw_audio = url_match.group(1) if url_match else ""
        if not raw_audio:
            audio_match = re.search(r'"audio_url":"([^"]+)"', clip_match.group("body"))
            candidate = audio_match.group(1) if audio_match else ""
            raw_audio = "" if "/api/forbidden" in candidate else candidate
    if not raw_audio:
        candidates = [parser.meta.get(key) for key in (
            "og:audio", "og:audio:url", "og:audio:secure_url", "twitter:player:stream",
        ) if parser.meta.get(key)]
        raw_audio = next((value for value in candidates if not re.search(
            r"/(?:sil|silence)(?:[-_.]|$)", urlparse(value).path, re.IGNORECASE,
        )), "")
    if not raw_audio:
        # Next.js data sometimes contains the CDN URL as escaped JSON rather
        # than an Open Graph tag. Do not use the generic HTML5 media entry: it
        # has historically pointed at Suno's silence placeholder.
        match = re.search(
            r'https?(?::|\\u003a)(?:\\?/){2}[^"\s<>]+?\.mp3(?:\?[^"\s<>\\]*)?', search_page,
            re.IGNORECASE,
        )
        raw_audio = match.group(0) if match else ""
    audio_url = html.unescape(raw_audio).replace("\\u003a", ":").replace("\\u0026", "&").replace("\\/", "/")
    parsed_audio = urlparse(audio_url)
    audio_host = (parsed_audio.hostname or "").casefold()
    if re.search(r"/(?:sil|silence)(?:[-_.]|$)", parsed_audio.path, re.IGNORECASE):
        raise RuntimeError("Suno exposed only its silent placeholder; no MP3 was downloaded.")
    if parsed_audio.scheme != "https" or not (
        audio_host == "suno.ai" or audio_host.endswith(".suno.ai") or
        audio_host == "suno.com" or audio_host.endswith(".suno.com") or
        audio_host == "cloudfront.net" or audio_host.endswith(".cloudfront.net")
    ):
        raise RuntimeError("Suno did not expose a valid public audio stream for this link.")
    raw_title = parser.meta.get("og:title") or "".join(parser.title_parts).strip() or f"Suno Song {fallback_id}"
    title = re.sub(r"\s*[|·-]\s*Suno\s*$", "", html.unescape(raw_title), flags=re.IGNORECASE).strip()
    return title or f"Suno Song {fallback_id}", audio_url


def _run(command: list[str], log=None, timeout=900, cwd=None):
    if log:
        log("[info] " + " ".join(command[:5]) + " …")
    try:
        return subprocess.run(
            command, check=True, capture_output=True, text=True, timeout=timeout, cwd=cwd,
        )
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "command failed").strip()
        raise RuntimeError(detail[-700:]) from exc


def _parse_yt_progress(line: str) -> tuple[float, str, str] | None:
    """Parse the stable progress-template line emitted by yt-dlp."""
    if "KARAOKE_PROGRESS|" not in line:
        return None
    fields = line.strip().split("|", 3)
    if len(fields) != 4:
        return None
    match = re.search(r"(\d+(?:\.\d+)?)%", fields[1])
    if not match:
        return None
    return min(100.0, max(0.0, float(match.group(1)))), fields[2].strip(), fields[3].strip()


def _run_yt_download(
    command: list[str], progress, start: int, end: int, label: str,
    log=None, timeout=900, cwd=None, expected_parts=1,
):
    """Run yt-dlp with live download percentage, speed, and ETA callbacks."""
    if not progress:
        return _run(command, log=log, timeout=timeout, cwd=cwd)
    # yt-dlp accepts these options before its final URL argument. Newline mode
    # avoids carriage-return progress that capture_output cannot surface live.
    live_command = [
        *command[:-1], "--newline", "--no-color", "--progress-delta", "0.25",
        "--progress-template",
        "download:KARAOKE_PROGRESS|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
        command[-1],
    ]
    if log:
        log("[info] " + " ".join(command[:5]) + " …")
    process = subprocess.Popen(
        live_command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace", bufsize=1,
    )
    output_lines: list[str] = []
    started = time.monotonic()
    part = 0
    last_raw = 0.0
    last_reported = float(start)
    last_postprocess_message = ""
    try:
        assert process.stdout is not None
        for raw_line in process.stdout:
            line = raw_line.rstrip()
            output_lines.append(line)
            parsed = _parse_yt_progress(line)
            if parsed:
                percent, speed, eta = parsed
                if percent + 40 < last_raw and part + 1 < max(1, expected_parts):
                    part += 1
                last_raw = percent
                span = max(1, end - start)
                overall = start + span * ((part + percent / 100) / max(1, expected_parts))
                overall = max(last_reported, min(float(end), overall))
                last_reported = overall
                details = [f"{percent:.1f}%"]
                if speed and speed.upper() not in {"N/A", "UNKNOWN"}:
                    details.append(speed)
                if eta and eta.upper() not in {"N/A", "UNKNOWN"}:
                    details.append(f"ETA {eta}")
                component = f" component {part + 1}/{expected_parts}" if expected_parts > 1 else ""
                progress(round(overall), f"{label}{component}: " + " • ".join(details))
            elif line:
                postprocess = None
                post_percent = min(97, end + 2)
                if "[ExtractAudio]" in line:
                    postprocess = "Download complete — converting audio to MP3 with FFmpeg"
                    post_percent = min(97, end + 3)
                elif "[Merger]" in line or "[VideoRemuxer]" in line:
                    postprocess = "Download complete — merging video and audio with FFmpeg"
                    post_percent = min(97, end + 3)
                elif any(marker in line for marker in ("[Metadata]", "[EmbedThumbnail]", "[Fixup", "[MoveFiles]")):
                    postprocess = "Finalizing media metadata"
                    post_percent = min(98, end + 6)
                if postprocess and postprocess != last_postprocess_message:
                    last_postprocess_message = postprocess
                    last_reported = max(last_reported, post_percent)
                    progress(round(last_reported), postprocess)
                if log:
                    log(line)
            if time.monotonic() - started > timeout:
                process.kill()
                raise RuntimeError(f"{label} timed out after {timeout} seconds.")
        return_code = process.wait()
    finally:
        if process.stdout:
            process.stdout.close()
    output = "\n".join(output_lines)
    if return_code:
        raise RuntimeError((output or "download command failed")[-900:])
    return subprocess.CompletedProcess(live_command, return_code, output, "")


def _yt_base() -> list[str]:
    return [sys.executable, "-m", "yt_dlp", "--no-playlist", "--force-ipv4", "--js-runtimes", "node"]


def _choose_language(captions: dict, requested="en") -> str | None:
    keys = list(captions or {})
    requested = requested.casefold()
    return next((key for key in keys if key.casefold() == requested), None) or next(
        (key for key in keys if key.casefold().startswith(requested + "-")), None
    )


def fetch_caption_script(url: str, language="en", log=None) -> dict:
    url = validate_youtube_url(url)
    metadata = json.loads(_run([*_yt_base(), "--skip-download", "--dump-single-json", url], log).stdout)
    manual = _choose_language(metadata.get("subtitles") or {}, language)
    automatic = _choose_language(metadata.get("automatic_captions") or {}, language)
    if manual:
        selected, kind, flag = manual, "manual", "--write-subs"
    elif automatic:
        selected, kind, flag = automatic, "automatic", "--write-auto-subs"
    else:
        raise RuntimeError(f"No {language} captions are available for this video.")
    with tempfile.TemporaryDirectory(prefix="karaoke_captions_") as temporary:
        template = Path(temporary) / f"{metadata.get('id', 'video')}.%(ext)s"
        _run([
            *_yt_base(), "--skip-download", flag, "--sub-langs", selected,
            "--sub-format", "json3", "-o", str(template), url,
        ], log)
        files = list(Path(temporary).glob("*.json3"))
        if not files:
            raise RuntimeError("Caption metadata was found, but timed captions could not be downloaded.")
        payload = json.loads(files[0].read_text(encoding="utf-8"))
    cues = []
    for event in payload.get("events") or []:
        if event.get("tStartMs") is None:
            continue
        raw_text = re.sub(r"\s+", " ", "".join(
            str(segment.get("utf8") or "") for segment in event.get("segs") or []
        )).strip()
        text = clean_caption_text(raw_text)
        if not text:
            continue
        start = float(event["tStartMs"]) / 1000
        duration = max(0.05, float(event.get("dDurationMs") or 0) / 1000)
        cues.append({
            "start": round(start, 3), "end": round(start + duration, 3),
            "text": text, "include": True,
        })
    if not cues:
        raise RuntimeError("The caption track did not contain usable text cues.")
    return {
        "title": str(metadata.get("title") or "YouTube Karaoke"),
        "video_id": str(metadata.get("id") or "video"),
        "url": url,
        "language": selected,
        "caption_kind": kind,
        "cues": cues,
    }


def _ass_time(seconds: float) -> str:
    centis = max(0, round(float(seconds) * 100))
    hours, remainder = divmod(centis, 360000)
    minutes, remainder = divmod(remainder, 6000)
    whole, fraction = divmod(remainder, 100)
    return f"{hours}:{minutes:02d}:{whole:02d}.{fraction:02d}"


def _escape(text: str) -> str:
    return str(text).replace("\\", "＼").replace("{", "(").replace("}", ")").replace("\n", r"\N")


def _wrap_plain_text(text: str, width: int) -> str:
    """Wrap display-only text predictably at word boundaries for ASS."""
    lines = textwrap.wrap(
        str(text), width=width, break_long_words=False, break_on_hyphens=False,
    ) or [""]
    return r"\N".join(_escape(line) for line in lines)


def _merge_modern_fragments(cues: list[dict]) -> list[dict]:
    """Join short trailing caption fragments into readable lyric phrases."""
    merged: list[dict] = []
    for source in cues:
        cue = dict(source)
        text = str(cue.get("text") or "").strip()
        if merged:
            previous = merged[-1]
            previous_text = str(previous["text"]).strip()
            gap = float(cue["start"]) - float(previous.get("end") or cue["start"])
            current_words = text.split()
            combined_words = (previous_text + " " + text).split()
            begins_as_continuation = bool(text and text[0].islower())
            short_tail = len(current_words) <= 3
            previous_is_open = not bool(re.search(r"[.!?;:,]\s*$", previous_text))
            if (
                -0.1 <= gap <= 0.8
                and previous_is_open
                and (short_tail or begins_as_continuation)
                and len(combined_words) <= 9
                and len(previous_text) + 1 + len(text) <= 58
            ):
                previous["text"] = previous_text + " " + text
                previous["end"] = max(float(previous.get("end") or 0), float(cue.get("end") or 0))
                continue
        cue["text"] = text
        merged.append(cue)
    return merged


def _highlight(text: str, start: float, end: float) -> str:
    words = str(text).split()
    if not words:
        return ""
    total = max(len(words), round(max(0.05, end - start) * 100))
    weights = [max(1, len(re.sub(r"\W", "", word))) for word in words]
    remaining, weight_left, parts = total, sum(weights), []
    for index, (word, weight) in enumerate(zip(words, weights)):
        duration = remaining if index == len(words) - 1 else max(1, round(remaining * weight / weight_left))
        parts.append(r"{\kf%d}%s " % (duration, _escape(word)))
        remaining -= duration
        weight_left -= weight
    return "".join(parts).rstrip()


def _count_in_events(first_lyric_start: float, first_lyric: str, layout: str) -> list[str]:
    """Create a four-phase count-in ending exactly at the first lyric."""
    lyric_start = max(0.0, float(first_lyric_start))
    if lyric_start < 0.2:
        return []
    window = min(4.0, lyric_start)
    phase = window / 4
    x, y = (1536, 540) if layout in SIDE_PANEL_LAYOUTS else (960, 430)
    start = lyric_start - window
    prompt = rf"{{\an5\pos({x},{y - 145})\fs38\b1\1c&H00FFFFFF&\3c&H00101010&\bord4}}GET READY TO SING"
    preview = (
        rf"{{\an5\pos({x},{y + 145})\fs42\b1\1c&H00FFFFFF&\3c&H00101010&\bord4}}"
        + _wrap_plain_text(first_lyric, 27)
    )
    result = [
        f"Dialogue: 1,{_ass_time(start)},{_ass_time(lyric_start)},KaraokeReady,,0,0,0,,{prompt}",
        f"Dialogue: 1,{_ass_time(start)},{_ass_time(lyric_start)},KaraokeReady,,0,0,0,,{preview}",
    ]
    for index, number in enumerate(("3", "2", "1"), start=1):
        event_start = start + index * phase
        event_end = start + (index + 1) * phase
        text = (
            rf"{{\an5\pos({x},{y})\fs64\b1\1c&H0000D7FF&"
            rf"\3c&H00101010&\bord4}}{number}"
        )
        result.append(
            f"Dialogue: 1,{_ass_time(event_start)},{_ass_time(event_end)},KaraokeReady,,0,0,0,,{text}"
        )
    return result


def captions_to_ass(script: dict, layout="right_roll") -> str:
    cues = []
    for source in script["cues"]:
        text = clean_caption_text(source.get("text"))
        if source.get("include") is False or not text:
            continue
        cue = dict(source)
        cue["text"] = text
        cues.append(cue)
    cues.sort(key=lambda cue: float(cue["start"]))
    if layout == "modern_karaoke":
        cues = _merge_modern_fragments(cues)
    events = _count_in_events(float(cues[0]["start"]), cues[0]["text"], layout) if cues else []
    if layout == "right_roll" and cues:
        # A stationary guide marks the live reading slot. Phrases roll through
        # it, making the next vocal entrance visually predictable.
        marker_start = float(cues[0]["start"])
        marker_end = max(marker_start + 0.05, float(cues[-1].get("end") or marker_start))
        marker = r"{\an5\pos(1178,540)\fs74\b1\1c&H0000D7FF&\3c&H00101010&\bord2}┃"
        events.append(
            f"Dialogue: 2,{_ass_time(marker_start)},{_ass_time(marker_end)},KaraokeMarker,active-marker,0,0,0,,{marker}"
        )
    previous_end = 0.0
    for index, cue in enumerate(cues):
        start = max(previous_end, float(cue["start"]))
        source_end = max(start + 0.05, float(cue.get("end") or start))
        next_start = float(cues[index + 1]["start"]) if index + 1 < len(cues) else source_end
        end = max(start + 0.05, next_start) if layout in SIDE_PANEL_LAYOUTS and index + 1 < len(cues) else source_end
        if layout == "modern_karaoke":
            # One compact block gives every visible row normal line spacing.
            # It also lets the active phrase wrap without creating giant gaps
            # between adjacent caption cues.
            rows = []
            for context_index in range(max(0, index - 2), min(len(cues), index + 3)):
                context = cues[context_index]
                if context_index == index:
                    rows.append(
                        r"{\fs40\b1\1c&H0000D7FF&\2c&H0000D7FF&}"
                        + _wrap_plain_text(context["text"], 34)
                    )
                else:
                    distance = abs(context_index - index)
                    size, colour = (32, "A8A8A8") if distance == 1 else (26, "686868")
                    rows.append(
                        rf"{{\fs{size}\b0\1c&H00{colour}&\2c&H00{colour}&}}"
                        + _wrap_plain_text(context["text"], 43)
                    )
            text = r"\N".join(rows)
            text = r"{\rKaraokeModern\an4\pos(1210,540)}" + text
            events.append(
                f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},KaraokeModern,,0,0,0,,{text}"
            )
        elif layout == "right_roll":
            # Render each visible phrase in its own fixed-height slot. During the
            # final part of the cue all slots move upward together, so the next
            # state starts exactly where the preceding state finished.
            slot_y = (360, 540, 720)
            duration_ms = max(50, round((end - start) * 1000))
            transition_ms = min(450, max(140, round(duration_ms * 0.28)))
            move_start = max(0, duration_ms - transition_ms)
            moving = index + 1 < len(cues)
            for context_index in range(max(0, index - 1), min(len(cues), index + 2)):
                context = cues[context_index]
                slot = context_index - index + 1
                y = slot_y[slot]
                position = (
                    rf"\move(1210,{y},1210,{y - 180},{move_start},{duration_ms})"
                    if moving else rf"\pos(1210,{y})"
                )
                if context_index == index:
                    text = (
                        r"{\rKaraokeRight\an4" + position
                        + r"\fs64\b1\1c&H00FFFFFF&\2c&H0000D7FF&}"
                        + _highlight(cue["text"], start, source_end)
                    )
                else:
                    text = (
                        r"{\rKaraokeRight\an4" + position
                        + r"\fs44\b0\1c&H00B8B8B8&\2c&H00B8B8B8&\alpha&H48&}"
                        + _escape(context["text"])
                    )
                events.append(
                    f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},KaraokeRight,,0,0,0,,{text}"
                )
        else:
            text, style = _highlight(cue["text"], start, source_end), "Karaoke"
            events.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},{style},,0,0,0,,{text}")
        previous_end = end if layout in SIDE_PANEL_LAYOUTS else previous_end
    return "\n".join([
        "[Script Info]", f"Title: {_escape(script['title'])}", "ScriptType: v4.00+",
        "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Karaoke,Arial,58,&H00FFFFFF,&H0000D7FF,&H00101010,&H90000000,-1,0,0,0,100,100,0,0,1,4,1,2,100,100,70,1",
        "Style: KaraokeRight,Arial,64,&H00FFFFFF,&H0000D7FF,&H00101010,&H90000000,-1,0,0,0,100,100,0,0,1,3,1,4,1195,65,0,1",
        "Style: KaraokeReady,Arial,38,&H00FFFFFF,&H0000D7FF,&H00101010,&H90000000,-1,0,0,0,100,100,0,0,1,4,1,5,60,60,40,1",
        "Style: KaraokeMarker,Arial,74,&H0000D7FF,&H0000D7FF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,5,0,0,0,1",
        "Style: KaraokeModern,Arial,40,&H0000D7FF,&H0000D7FF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,4,1195,65,0,1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        *events, "",
    ])


def safe_file_stem(title: str) -> str:
    return re.sub(r"[^A-Za-z0-9._ -]+", "_", title).strip(" ._")[:90] or "karaoke"


def safe_run_name(title: str, video_id: str) -> str:
    safe = safe_file_stem(title)[:70]
    return f"{safe}_{datetime.now():%Y%m%d_%H%M%S}_{video_id}"


def video_filter(layout: str) -> str:
    """Return the FFmpeg canvas used by each karaoke presentation."""
    if layout in SIDE_PANEL_LAYOUTS:
        return (
            # Keep the image inside the nominal 60% stage instead of allowing
            # it to touch the lyric column. Centering 1088 px inside the
            # 1152 px stage leaves a visible black gutter before the 1195 px
            # lyric origin.
            "scale=1088:1080:force_original_aspect_ratio=decrease,"
            "pad=1920:1080:(1152-iw)/2:(1080-ih)/2:black,"
            "subtitles=lyrics.ass"
        )
    if layout == "classic_bottom":
        return "subtitles=lyrics.ass"
    raise ValueError(f"Unsupported karaoke layout: {layout}")


def _http_get(url: str, referer: str | None = None):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    if referer:
        headers["Referer"] = referer
        headers["Accept"] = "audio/mpeg,audio/*;q=0.9,*/*;q=0.5"
    return urlopen(Request(url, headers=headers), timeout=45)


def _download_http_audio(
    audio_url: str, destination: Path, page_url: str, progress=None,
    start=15, end=92,
):
    temporary = destination.with_suffix(destination.suffix + ".part")
    received = 0
    started = time.monotonic()
    try:
        with _http_get(audio_url, referer=page_url) as response, temporary.open("wb") as output:
            content_type = str(response.headers.get("Content-Type") or "").casefold()
            media_suffixes = {".mp3", ".m4a", ".aac", ".opus", ".ogg"}
            media_suffix = Path(urlparse(audio_url).path).suffix.casefold()
            if "audio" not in content_type and media_suffix not in media_suffixes:
                raise RuntimeError(f"Suno returned an unexpected media type: {content_type or 'unknown'}")
            total = int(response.headers.get("Content-Length") or 0)
            while True:
                chunk = response.read(256 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                received += len(chunk)
                elapsed = max(0.001, time.monotonic() - started)
                speed = received / elapsed
                if total:
                    percent = min(100.0, received * 100 / total)
                    mapped = start + (end - start) * percent / 100
                    eta = max(0, (total - received) / speed)
                    message = f"Downloading Suno MP3: {percent:.1f}% • {speed / 1048576:.2f} MiB/s • ETA {eta:.0f}s"
                    if progress:
                        progress(round(mapped), message)
                elif progress:
                    progress(start, f"Downloading Suno MP3: {received / 1048576:.1f} MiB • {speed / 1048576:.2f} MiB/s")
        if received < 64 * 1024:
            raise RuntimeError("Suno returned an unexpectedly small audio file; download was rejected.")
        temporary.replace(destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def _reject_silent_audio(path: Path):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return
    result = _run([
        ffmpeg, "-hide_banner", "-nostats", "-i", str(path),
        "-af", "volumedetect", "-f", "null", "-",
    ], timeout=180)
    report = f"{result.stdout or ''}\n{result.stderr or ''}"
    match = re.search(r"mean_volume:\s*(-?inf|-?\d+(?:\.\d+)?)\s*dB", report, re.IGNORECASE)
    if match and (match.group(1).casefold() == "-inf" or float(match.group(1)) <= -75):
        path.unlink(missing_ok=True)
        raise RuntimeError("Suno returned a silent placeholder instead of the song; no MP3 was saved.")


def _validate_suno_media_container(path: Path, suffix: str):
    """Reject mislabeled protected/placeholder responses before invoking FFmpeg."""
    with path.open("rb") as stream:
        header = stream.read(64)
    suffix = suffix.casefold()
    if suffix == ".mp3":
        valid = header.startswith(b"ID3") or (
            len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xE0) == 0xE0
        )
    elif suffix == ".m4a":
        valid = len(header) >= 12 and header[4:8] == b"ftyp"
    elif suffix in {".ogg", ".opus"}:
        valid = header.startswith(b"OggS")
    elif suffix == ".aac":
        valid = len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xF0) == 0xF0
    else:
        valid = False
    if not valid:
        path.unlink(missing_ok=True)
        raise RuntimeError(
            "Suno returned protected or non-playable media instead of an audio file. "
            "Download the song through Suno's official Download command, then use the local file."
        )


def _download_suno_mp3(url: str, output_root: Path, log=None, progress=None) -> dict:
    if progress:
        progress(4, "Reading Suno song information")
    with _http_get(url) as response:
        resolved_url = response.geturl()
        page = response.read(8 * 1024 * 1024).decode("utf-8", errors="replace")
    parsed = urlparse(resolved_url)
    song_id = parsed.path.rstrip("/").split("/")[-1] or "song"
    title, audio_url = _extract_suno_metadata(page, song_id)
    file_stem = safe_file_stem(title)
    run_dir = output_root / safe_run_name(title, f"{song_id}_suno_mp3")
    run_dir.mkdir(parents=True, exist_ok=False)
    output = run_dir / f"{file_stem}.mp3"
    if log:
        log(f"[suno] Resolved public audio stream for: {title}")
    source_suffix = Path(urlparse(audio_url).path).suffix.casefold()
    temporary_source = None
    try:
        if source_suffix == ".mp3":
            _download_http_audio(audio_url, output, resolved_url, progress)
            _validate_suno_media_container(output, source_suffix)
        else:
            ffmpeg = shutil.which("ffmpeg")
            if not ffmpeg:
                raise RuntimeError("FFmpeg is required to convert Suno audio to MP3.")
            temporary_source = run_dir / f"_suno_source{source_suffix if source_suffix in {'.m4a', '.aac', '.opus', '.ogg'} else '.media'}"
            _download_http_audio(audio_url, temporary_source, resolved_url, progress, 15, 84)
            _validate_suno_media_container(temporary_source, source_suffix)
            if progress:
                progress(87, "Converting Suno audio to MP3")
            _run([
                ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(temporary_source), "-vn", "-codec:a", "libmp3lame",
                "-q:a", "0", str(output),
            ], log, timeout=900)
        if progress:
            progress(95, "Validating Suno audio")
        _reject_silent_audio(output)
    except Exception:
        output.unlink(missing_ok=True)
        if temporary_source is not None:
            temporary_source.unlink(missing_ok=True)
        try:
            run_dir.rmdir()
        except OSError:
            pass
        raise
    finally:
        if temporary_source is not None:
            temporary_source.unlink(missing_ok=True)
    if progress:
        progress(98, "Suno MP3 file ready")
    return {
        "run_dir": str(run_dir), "output": str(output), "title": title,
        "format": "mp3", "sourceOrigin": "suno_public_stream",
    }


def download_media(
    url: str, output_root: Path, kind: str, log=None, progress=None,
    source_cache: Path | None = None,
) -> dict:
    """Download supported public media as a browser MP4 or high-quality MP3."""
    url, provider = validate_download_url(url)
    if kind not in {"mp4", "mp3"}:
        raise ValueError("Download format must be mp4 or mp3.")
    if provider == "suno":
        if kind != "mp3":
            raise ValueError("Suno links currently support MP3 download only.")
        return _download_suno_mp3(url, output_root, log, progress)
    if kind == "mp3" and not shutil.which("ffmpeg"):
        raise RuntimeError("FFmpeg is required to convert YouTube audio to MP3.")
    if progress:
        progress(3, "Reading YouTube video information")
    metadata = json.loads(_run([*_yt_base(), "--skip-download", "--dump-single-json", url], log).stdout)
    title = str(metadata.get("title") or "YouTube Download")
    video_id = str(metadata.get("id") or "video")
    file_stem = safe_file_stem(title)
    run_dir = output_root / safe_run_name(title, f"{video_id}_{kind}")
    run_dir.mkdir(parents=True, exist_ok=False)
    if progress:
        progress(12, f"Downloading {kind.upper()}")
    source_origin = "youtube"
    if kind == "mp4":
        output = run_dir / f"{file_stem}.mp4"
        _run_yt_download([
            *_yt_base(), "-f",
            "bestvideo[ext=mp4][vcodec^=avc1][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "--merge-output-format", "mp4", "-o", str(output), url,
        ], progress, 12, 90, "Downloading MP4", log, expected_parts=2)
        if progress:
            progress(98, "Finalizing MP4 container")
    else:
        output = run_dir / f"{file_stem}.mp3"
        cached = None
        if source_cache:
            safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", video_id) or "video"
            candidate = source_cache / f"{safe_id}.mp4"
            cached = candidate if _valid_media(candidate) else None
        saved_mp4 = _find_previous_source(output_root, video_id) or cached
        if saved_mp4:
            source_origin = "saved_mp4"
            if log:
                log(f"[cache] Creating MP3 from saved MP4: {saved_mp4}")
            if progress:
                progress(35, "Converting saved MP4 to MP3")
            _run([
                shutil.which("ffmpeg") or "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(saved_mp4), "-vn", "-codec:a", "libmp3lame", "-q:a", "0", str(output),
            ], log)
        else:
            # Keep yt-dlp's fallback output user-facing and title-based. The
            # previous generic audio.%(ext)s template leaked "audio.mp3" into
            # completed downloads whenever no reusable MP4 was available.
            template = run_dir / f"{file_stem}.%(ext)s"
            _run_yt_download([
                *_yt_base(), "-x", "--audio-format", "mp3", "--audio-quality", "0",
                "-o", str(template), url,
            ], progress, 12, 90, "Downloading MP3 audio", log)
            if progress:
                progress(98, "Validating finalized MP3 audio")
    if not output.is_file():
        raise RuntimeError(f"{kind.upper()} download completed but the output file was not found.")
    if progress:
        progress(98, f"{kind.upper()} file ready")
    if kind == "mp4" and source_cache:
        safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", video_id) or "video"
        cache_target = source_cache / f"{safe_id}.mp4"
        source_cache.mkdir(parents=True, exist_ok=True)
        if not _valid_media(cache_target):
            _link_or_copy(output, cache_target)
    return {
        "run_dir": str(run_dir), "output": str(output), "title": title,
        "format": kind, "sourceOrigin": source_origin,
    }


def _valid_media(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def _find_previous_source(output_root: Path, video_id: str) -> Path | None:
    patterns = (
        f"*_{video_id}/source.mp4",
        f"*_{video_id}_mp4/video.mp4",
        f"*_{video_id}_mp4/*.mp4",
    )
    candidates = [path for pattern in patterns for path in output_root.glob(pattern) if _valid_media(path)]
    return max(candidates, key=lambda path: path.stat().st_mtime, default=None)


def _resolve_source_video(
    url: str, video_id: str, output_root: Path, cache_root: Path, log=None, progress=None,
) -> tuple[Path, str]:
    """Return a reusable source video, downloading only as a last resort."""
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", video_id) or "video"
    cache_root.mkdir(parents=True, exist_ok=True)
    cached = cache_root / f"{safe_id}.mp4"
    if _valid_media(cached):
        if log:
            log(f"[cache] Reusing cached source video: {cached.name}")
        if progress:
            progress(55, "Reusing cached source video")
        return cached, "cache"
    previous = _find_previous_source(output_root, video_id)
    if previous:
        shutil.copy2(previous, cached)
        if log:
            log(f"[cache] Reusing source from earlier run: {previous}")
        if progress:
            progress(55, "Reusing source from earlier run")
        return cached, "previous_run"
    if log:
        log("[download] Source not cached; downloading browser-compatible video…")
    if progress:
        progress(15, "Downloading source video")
    _run_yt_download([
        *_yt_base(), "-f",
        "bestvideo[ext=mp4][vcodec^=avc1][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4", "-o", str(cached), url,
    ], progress, 15, 52, "Downloading source video", log, expected_parts=2)
    if not _valid_media(cached):
        raise RuntimeError("YouTube source download completed but the cached MP4 was not found.")
    if progress:
        progress(55, "Source video downloaded and cached")
    return cached, "download"


def _link_or_copy(source: Path, destination: Path):
    """Prefer a disk-saving hard link; copy when folders are on different volumes."""
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)


def render_karaoke(
    script: dict, output_root: Path, layout="right_roll", log=None, progress=None,
    source_cache: Path | None = None,
) -> dict:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("FFmpeg is not installed or is not on PATH.")
    if progress:
        progress(3, "Preparing karaoke run")
    # Normalize again at the render boundary so a transcript already open in an
    # older side-panel session cannot carry context labels into saved artifacts.
    script = dict(script)
    script["cues"] = [
        {**cue, "text": clean_caption_text(cue.get("text"))}
        for cue in script.get("cues") or []
        if cue.get("include") is not False and clean_caption_text(cue.get("text"))
    ]
    run_dir = output_root / safe_run_name(script["title"], script["video_id"])
    run_dir.mkdir(parents=True, exist_ok=False)
    (run_dir / "transcript.json").write_text(json.dumps(script, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (run_dir / "lyrics.ass").write_text(captions_to_ass(script, layout), encoding="utf-8")
    if progress:
        progress(10, "Timed lyrics prepared")
    source = run_dir / "source.mp4"
    cached_source, source_origin = _resolve_source_video(
        script["url"], str(script["video_id"]), output_root,
        source_cache or output_root / ".source_cache", log, progress,
    )
    _link_or_copy(cached_source, source)
    output = run_dir / f"{safe_file_stem(script['title'])} - Karaoke.mp4"
    if log:
        log("[render] Burning synchronized lyrics with FFmpeg…")
    if progress:
        progress(60, "Rendering karaoke video")
    _run([
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(source),
        "-vf", video_filter(layout), "-map", "0:v:0", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(output),
    ], log, cwd=run_dir)
    if progress:
        progress(95, "Karaoke video encoded")
    return {
        "run_dir": str(run_dir), "output": str(output), "title": script["title"],
        "sourceOrigin": source_origin,
    }
