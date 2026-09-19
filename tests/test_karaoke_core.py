import base64
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from karaoke_core import _extract_suno_metadata, _merge_modern_fragments, _parse_yt_progress, _resolve_source_video, _run_yt_download, _validate_suno_media_container, clean_caption_text, captions_to_ass, download_media, render_karaoke, safe_run_name, validate_download_url, validate_youtube_url, video_filter
import playback_server
import native_host
import media_library
import media_commands


class KaraokeCoreTests(unittest.TestCase):
    def tearDown(self):
        for recording_id in list(native_host.CAPTURES):
            native_host.cancel_tab_capture({"recordingId": recording_id})

    def test_youtube_share_url_is_accepted(self):
        url = "https://youtu.be/wBcZxiBiLig?list=RDwBcZxiBiLig"
        self.assertEqual(validate_youtube_url(url), url)

    def test_non_youtube_url_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "YouTube"):
            validate_youtube_url("https://example.com/video")

    def test_album_tracklist_parses_plain_and_markdown_timestamps(self):
        tracks = native_host.parse_album_tracklist(
            "Intro text [00:00:00](https://youtu.be/example) Dreams "
            "[00:04:14](https://youtu.be/example?t=254) Everywhere\n"
            "00:07:57 Go Your Own Way"
        )
        self.assertEqual([track["start"] for track in tracks], [0, 254, 477])
        self.assertEqual([track["title"] for track in tracks], ["Dreams", "Everywhere", "Go Your Own Way"])

    def test_album_tracklist_rejects_non_increasing_timestamps(self):
        with self.assertRaisesRegex(ValueError, "strictly increasing"):
            native_host.parse_album_tracklist("00:10 Second\n00:05 First")

    def test_media_library_indexes_kinds_albums_and_reuses_unchanged_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "output"
            album = root / "Night Drive - Tracks"
            original = root / "Original Video"
            karaoke = root / "Song Build"
            duplicate_folder = root / "Older Copy"
            album.mkdir(parents=True)
            original.mkdir(parents=True)
            karaoke.mkdir(parents=True)
            duplicate_folder.mkdir(parents=True)
            for media in (
                album / "01 - Opening.mp3", album / "02 - Home.mp3",
                original / "Concert.mp4", karaoke / "karaoke.mp4",
            ):
                media.write_bytes(media.name.encode("utf-8"))
            duplicate = duplicate_folder / "Opening Again.mp3"
            duplicate.write_bytes((album / "01 - Opening.mp3").read_bytes())
            index_path = Path(folder) / "state" / "library_index.json"
            metadata = {"duration": 120.0, "bitrate": 320000, "audio": {"codec_name": "mp3"}}
            with patch.object(media_library, "INDEX_PATH", index_path), patch.object(media_library, "_probe", return_value=metadata) as probe:
                index = media_library.refresh_library_index(root)
                self.assertEqual(index["counts"], {"all": 4, "total": 5, "duplicatesHidden": 1, "mp3": 2, "original_video": 1, "karaoke": 1, "albums": 1})
                self.assertEqual(probe.call_count, 5)
                self.assertEqual(len(index["duplicates"]), 1)
            with patch.object(media_library, "INDEX_PATH", index_path), patch.object(media_library, "_probe", side_effect=AssertionError("unchanged media was reprobed")):
                cached = media_library.refresh_library_index(root)
                self.assertEqual(cached["counts"]["all"], 4)

    def test_needle_commands_are_whitelisted_and_validated_before_browser_execution(self):
        fake_agent = SimpleNamespace(complete=lambda **_kwargs: {
            "confidence": 0.91,
            "reasoning": "volume and playback requested",
            "function_calls": [
                {"name": "set_volume", "arguments": {"percent": 145}},
                {"name": "control_playback", "arguments": {"action": "play"}},
                {"name": "delete_library", "arguments": {"confirmed": True}},
            ],
        })
        with patch.object(media_commands, "_get_agent", return_value=fake_agent):
            routed = media_commands.route_command("play loudly")
        self.assertEqual(routed["calls"], [
            {"name": "set_volume", "arguments": {"percent": 100}},
            {"name": "control_playback", "arguments": {"action": "play"}},
        ])
        self.assertFalse(routed["telemetry"])
        self.assertTrue(routed["modelLoaded"])
        self.assertIn("elapsedMs", routed)

    def test_named_play_request_is_routed_to_library_even_if_model_returns_transport_play(self):
        fake_agent = SimpleNamespace(complete=lambda **_kwargs: {
            "confidence": 0.97,
            "reasoning": "play requested",
            "function_calls": [
                {"name": "control_playback", "arguments": {"action": "play"}},
            ],
        })
        with patch.object(media_commands, "_get_agent", return_value=fake_agent):
            routed = media_commands.route_command("Play The Doors Riders on the Storm")
        self.assertEqual(routed["calls"], [{
            "name": "play_media",
            "arguments": {"title": "The Doors Riders on the Storm", "format": "any"},
        }])
        self.assertTrue(routed["routingAdjusted"])

    def test_generic_play_request_remains_transport_control(self):
        calls = [{"name": "control_playback", "arguments": {"action": "play"}}]
        repaired, adjusted = media_commands._repair_named_play("play music", calls)
        self.assertEqual(repaired, calls)
        self.assertFalse(adjusted)

    def test_every_collapsible_player_panel_is_voice_controllable(self):
        for panel in ("monitor", "command", "equalizer", "library"):
            call = {"name": "set_panel", "arguments": {"panel": panel, "open": False}}
            self.assertEqual(media_commands._validated_call(call), call)

    def test_direct_panel_commands_override_model_misrouting(self):
        wrong = [{"name": "apply_equalizer_preset", "arguments": {"preset": "Classical"}}]
        repaired, adjusted = media_commands._repair_panel_command("open equalizer", wrong)
        self.assertEqual(repaired, [{
            "name": "set_panel",
            "arguments": {"panel": "equalizer", "open": True},
        }])
        self.assertTrue(adjusted)
        closed, _ = media_commands._repair_panel_command("collapse media library", [])
        self.assertEqual(closed[0]["arguments"], {"panel": "library", "open": False})

    def test_named_play_preserves_full_spoken_title(self):
        calls = [{
            "name": "play_media",
            "arguments": {"title": "The Doors Riders", "format": "any"},
        }]
        repaired, adjusted = media_commands._repair_named_play(
            "Play The Doors Riders on the Storm", calls
        )
        self.assertEqual(repaired[0]["arguments"]["title"], "The Doors Riders on the Storm")
        self.assertTrue(adjusted)

    def test_common_karaoke_speech_misrecognition_selects_karaoke_media(self):
        calls = [{"name": "control_playback", "arguments": {"action": "play"}}]
        repaired, adjusted = media_commands._repair_named_play(
            "Play the doors Riders on the Storm kuroki", calls
        )
        self.assertEqual(repaired, [{
            "name": "play_media",
            "arguments": {"title": "the doors Riders on the Storm", "format": "karaoke"},
        }])
        self.assertTrue(adjusted)

    def test_album_splitter_creates_numbered_mp3_tracks_without_reencoding(self):
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            self.skipTest("FFmpeg is required for the album splitter smoke test")
        with tempfile.TemporaryDirectory() as folder, patch.object(native_host, "progress"):
            source = Path(folder) / "Test Album.mp3"
            subprocess.run([
                ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
                "-codec:a", "libmp3lame", "-b:a", "192k", str(source),
            ], check=True)
            result = native_host.split_album_mp3(str(source), "00:00 First Track\n00:02 Second Track")
            outputs = [Path(path) for path in result["files"]]
            self.assertEqual(result["trackCount"], 2)
            self.assertEqual([path.name for path in outputs], ["01 - First Track.mp3", "02 - Second Track.mp3"])
            self.assertTrue(all(path.stat().st_size > 1024 for path in outputs))

    def test_public_suno_song_and_share_urls_are_accepted_for_download(self):
        self.assertEqual(validate_download_url("https://suno.com/song/abc-123")[1], "suno")
        self.assertEqual(validate_download_url("https://www.suno.com/s/share123")[1], "suno")
        with self.assertRaises(ValueError):
            validate_download_url("https://suno.com/playlist/abc-123")

    def test_suno_open_graph_audio_is_preferred_over_silence_embed(self):
        page = """
        <html><head>
          <meta property="og:title" content="Midnight Drive | Suno">
          <meta property="og:audio" content="https://cdn1.suno.ai/song-123.mp3">
        </head><body><audio src="https://cdn1.suno.ai/silence.mp3"></audio></body></html>
        """
        title, audio_url = _extract_suno_metadata(page, "song-123")
        self.assertEqual(title, "Midnight Drive")
        self.assertEqual(audio_url, "https://cdn1.suno.ai/song-123.mp3")

    def test_suno_streamed_clip_metadata_uses_real_media_not_silent_og_audio(self):
        page = r'''
        <meta property="og:title" content="Sunset Sighs">
        <meta property="og:audio" content="https://cdn-o.suno.com/sil-100.mp3">
        <script>42:["$",{"clip":{"status":"complete","id":"song-123",
        "audio_url":"https://studio-api.prod.suno.com/api/forbidden",
        "media_urls":[{"url":"https://d2.example.cloudfront.net/1/clip/song-123.m4a",
        "content_type":"m4a-opus","delivery":"progressive"}],
        "image_url":"https://cdn2.suno.ai/image_song-123.jpeg"}}]</script>
        '''
        title, audio_url = _extract_suno_metadata(page, "song-123")
        self.assertEqual(title, "Sunset Sighs")
        self.assertEqual(audio_url, "https://d2.example.cloudfront.net/1/clip/song-123.m4a")

    def test_suno_silent_open_graph_audio_is_rejected(self):
        page = '<meta property="og:audio" content="https://cdn-o.suno.com/sil-100.mp3">'
        with self.assertRaisesRegex(RuntimeError, "silent placeholder"):
            _extract_suno_metadata(page, "song-123")

    def test_suno_mislabeled_protected_m4a_is_rejected_before_ffmpeg(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source.m4a"
            source.write_bytes(bytes(range(64)))
            with self.assertRaisesRegex(RuntimeError, "protected or non-playable"):
                _validate_suno_media_container(source, ".m4a")
            self.assertFalse(source.exists())

    def test_suno_real_m4a_signature_is_accepted(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source.m4a"
            source.write_bytes(b"\x00\x00\x00\x18ftypM4A " + bytes(52))
            _validate_suno_media_container(source, ".m4a")
            self.assertTrue(source.exists())

    def test_tab_recording_chunks_are_written_in_order_and_cancelled_cleanly(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(native_host, "send"):
            recording_id = "recording123"
            native_host.begin_tab_capture({
                "recordingId": recording_id, "title": "My Suno Song | Suno",
                "outputDir": folder,
            })
            native_host.append_tab_capture({
                "recordingId": recording_id, "index": 0,
                "data": "YWJjZA==",
            })
            capture = native_host.CAPTURES[recording_id]
            self.assertEqual(capture["title"], "My Suno Song")
            self.assertEqual(capture["source"].read_bytes(), b"abcd")
            run_dir = capture["run_dir"]
            native_host.cancel_tab_capture({"recordingId": recording_id})
            self.assertFalse(run_dir.exists())

    def test_tab_recording_rejects_out_of_order_chunks(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(native_host, "send"):
            recording_id = "recording456"
            native_host.begin_tab_capture({
                "recordingId": recording_id, "title": "Test", "outputDir": folder,
            })
            with self.assertRaisesRegex(ValueError, "out of order"):
                native_host.append_tab_capture({
                    "recordingId": recording_id, "index": 1, "data": "YWJjZA==",
                })

    def test_tab_recording_webm_is_converted_to_playable_mp3(self):
        ffmpeg = shutil.which("ffmpeg")
        ffprobe = shutil.which("ffprobe")
        if not ffmpeg or not ffprobe:
            self.skipTest("FFmpeg and FFprobe are required for the capture smoke test")
        with tempfile.TemporaryDirectory() as folder, \
                patch.object(native_host, "send") as mocked_send, \
                patch.object(native_host, "register_playback", return_value="http://local/play/test"):
            browser_recording = Path(folder) / "browser-recording.webm"
            subprocess.run([
                ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
                "-c:a", "libopus", "-b:a", "192k", str(browser_recording),
            ], check=True)
            recording_id = "recording789"
            native_host.begin_tab_capture({
                "recordingId": recording_id, "title": "Capture Smoke Test",
                "outputDir": folder,
            })
            payload = browser_recording.read_bytes()
            for index, offset in enumerate(range(0, len(payload), 128 * 1024)):
                chunk = payload[offset:offset + 128 * 1024]
                native_host.append_tab_capture({
                    "recordingId": recording_id, "index": index,
                    "data": base64.b64encode(chunk).decode("ascii"),
                })
            native_host.finish_tab_capture({"recordingId": recording_id})
            completion = next(
                call.args[0] for call in mocked_send.call_args_list
                if call.args and call.args[0].get("type") == "capture_complete"
            )
            output = Path(completion["output"])
            self.assertTrue(output.is_file())
            probe = subprocess.run([
                ffprobe, "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(output),
            ], check=True, capture_output=True, text=True)
            self.assertGreater(float(probe.stdout.strip()), 2.5)

    def test_suno_page_without_public_audio_is_rejected(self):
        with self.assertRaises(RuntimeError):
            _extract_suno_metadata("<title>Private Song | Suno</title>", "private")

    def test_classic_ass_contains_progressive_highlighting(self):
        ass = captions_to_ass({
            "title": "Demo",
            "cues": [{"start": 1.0, "end": 3.0, "text": "Sing this line"}],
        }, "classic_bottom")
        self.assertIn("Dialogue: 0,0:00:01.00,0:00:03.00,Karaoke", ass)
        self.assertIn(r"{\kf", ass)

    def test_right_roll_contains_context_and_right_style(self):
        ass = captions_to_ass({
            "title": "Demo",
            "cues": [
                {"start": 0.0, "end": 1.0, "text": "First"},
                {"start": 1.0, "end": 2.0, "text": "Second"},
                {"start": 2.0, "end": 3.0, "text": "Third"},
            ],
        }, "right_roll")
        self.assertIn("KaraokeRight", ass)
        self.assertIn(r"\move(1210,540,1210,360", ass)
        self.assertIn(r"\move(1210,720,1210,540", ass)
        self.assertIn(r"\fs64", ass)
        self.assertIn("active-marker", ass)

    def test_modern_karaoke_uses_compact_five_level_type_hierarchy(self):
        ass = captions_to_ass({
            "title": "Demo",
            "cues": [
                {"start": 1.0, "end": 2.0, "text": "First complete lyric line."},
                {"start": 2.0, "end": 3.0, "text": "Second complete lyric line."},
                {"start": 3.0, "end": 4.0, "text": "Center active lyric line."},
                {"start": 4.0, "end": 5.0, "text": "Fourth complete lyric line."},
                {"start": 5.0, "end": 6.0, "text": "Fifth complete lyric line."},
            ],
        }, "modern_karaoke")
        self.assertIn("KaraokeModern", ass)
        self.assertIn(r"\pos(1210,540)", ass)
        self.assertIn(r"\fs40\b1\1c&H0000D7FF&", ass)
        self.assertIn(r"\fs32\b0\1c&H00A8A8A8&", ass)
        self.assertIn(r"\fs26\b0\1c&H00686868&", ass)
        self.assertNotIn("active-marker", ass)
        self.assertNotIn(r"\move", ass)

    def test_modern_karaoke_merges_orphaned_caption_tails(self):
        cues = _merge_modern_fragments([
            {"start": 1.0, "end": 2.0, "text": "You smile like someone I"},
            {"start": 2.0, "end": 2.7, "text": "already know."},
            {"start": 3.0, "end": 4.0, "text": "Take me where the fields turn"},
            {"start": 4.0, "end": 4.4, "text": "black."},
        ])
        self.assertEqual([cue["text"] for cue in cues], [
            "You smile like someone I already know.",
            "Take me where the fields turn black.",
        ])

    def test_final_right_roll_state_holds_without_scrolling_away(self):
        ass = captions_to_ass({
            "title": "Demo",
            "cues": [{"start": 0.0, "end": 2.0, "text": "Last line"}],
        }, "right_roll")
        self.assertIn(r"\pos(1210,540)", ass)
        self.assertNotIn(r"\move", ass)

    def test_count_in_ends_when_first_lyric_begins(self):
        ass = captions_to_ass({
            "title": "Demo",
            "cues": [{"start": 6.0, "end": 8.0, "text": "First lyric"}],
        }, "right_roll")
        self.assertIn("GET READY TO SING", ass)
        self.assertEqual(ass.count("GET READY TO SING"), 1)
        self.assertIn("First lyric", ass)
        self.assertIn("Dialogue: 1,0:00:05.00,0:00:06.00,KaraokeReady", ass)
        self.assertIn(r"\pos(1536,540)", ass)
        self.assertNotIn(r"\fad", ass)

    def test_short_intro_uses_compressed_count_in(self):
        ass = captions_to_ass({
            "title": "Demo",
            "cues": [{"start": 2.0, "end": 3.0, "text": "Start"}],
        }, "classic_bottom")
        self.assertIn("Dialogue: 1,0:00:01.50,0:00:02.00,KaraokeReady", ass)
        self.assertIn(r"\pos(960,430)", ass)

    def test_long_first_lyric_wraps_inside_countdown_panel(self):
        ass = captions_to_ass({
            "title": "Demo",
            "cues": [{
                "start": 5.0,
                "end": 8.0,
                "text": "Where the gravel hums beneath the tires tonight",
            }],
        }, "right_roll")
        self.assertIn(r"Where the gravel hums\Nbeneath the tires tonight", ass)

    def test_split_stage_filter_reserves_right_forty_percent_for_lyrics(self):
        value = video_filter("right_roll")
        self.assertIn("scale=1088:1080", value)
        self.assertIn("(1152-iw)/2", value)
        self.assertIn("pad=1920:1080", value)
        self.assertTrue(value.endswith("subtitles=lyrics.ass"))

    def test_modern_karaoke_uses_the_split_stage_canvas(self):
        self.assertEqual(video_filter("modern_karaoke"), video_filter("right_roll"))

    def test_run_name_is_filesystem_safe(self):
        value = safe_run_name('Bad: title? "yes"', "abc")
        self.assertNotIn(":", value)
        self.assertNotIn("?", value)

    def test_direct_mp4_and_mp3_downloads_use_named_run_folders(self):
        calls = []

        def fake_run(command, log=None, timeout=900, cwd=None):
            calls.append(command)
            if "--dump-single-json" in command:
                return SimpleNamespace(stdout=json.dumps({"title": "Demo Song", "id": "abc123"}))
            output_value = command[command.index("-o") + 1] if "-o" in command else command[-1]
            output = Path(str(output_value).replace("%(ext)s", "mp3"))
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(b"media")
            return SimpleNamespace(stdout="")

        with tempfile.TemporaryDirectory() as temporary, patch("karaoke_core._run", side_effect=fake_run), patch("karaoke_core.shutil.which", return_value="ffmpeg"):
            root = Path(temporary)
            mp4 = download_media("https://youtu.be/abc123", root, "mp4")
            mp3 = download_media("https://youtu.be/abc123", root, "mp3")
            self.assertTrue(Path(mp4["output"]).is_file())
            self.assertEqual(Path(mp4["output"]).name, "Demo Song.mp4")
            self.assertTrue(Path(mp3["output"]).is_file())
            self.assertEqual(Path(mp3["output"]).name, "Demo Song.mp3")
            self.assertEqual(mp3["sourceOrigin"], "saved_mp4")
            self.assertFalse(any("-x" in command for command in calls))
            self.assertTrue(any("libmp3lame" in command for command in calls))

    def test_mp3_youtube_fallback_uses_video_title_not_audio(self):
        def fake_run(command, log=None, timeout=900, cwd=None):
            if "--dump-single-json" in command:
                return SimpleNamespace(stdout=json.dumps({"title": "Named Video", "id": "xyz789"}))
            output = Path(command[command.index("-o") + 1].replace("%(ext)s", "mp3"))
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(b"media")
            return SimpleNamespace(stdout="")

        with tempfile.TemporaryDirectory() as temporary, patch("karaoke_core._run", side_effect=fake_run), patch("karaoke_core.shutil.which", return_value="ffmpeg"):
            result = download_media("https://youtu.be/xyz789", Path(temporary), "mp3")
            self.assertEqual(Path(result["output"]).name, "Named Video.mp3")

    def test_ytdlp_live_progress_template_is_parsed(self):
        parsed = _parse_yt_progress("KARAOKE_PROGRESS| 42.7%| 8.12MiB/s|00:18")
        self.assertEqual(parsed, (42.7, "8.12MiB/s", "00:18"))
        self.assertIsNone(_parse_yt_progress("[download] Destination: demo.mp4"))

    def test_ytdlp_download_emits_dynamic_progress(self):
        class Output:
            def __iter__(self):
                return iter([
                    "KARAOKE_PROGRESS| 10.0%| 2.0MiB/s|00:20\n",
                    "KARAOKE_PROGRESS| 55.0%| 4.0MiB/s|00:09\n",
                    "KARAOKE_PROGRESS|100.0%| 5.0MiB/s|00:00\n",
                    "[ExtractAudio] Destination: demo.mp3\n",
                ])

            def close(self):
                pass

        class Process:
            stdout = Output()

            def wait(self):
                return 0

            def kill(self):
                pass

        updates = []
        with patch("karaoke_core.subprocess.Popen", return_value=Process()) as popen:
            _run_yt_download(
                ["python", "-m", "yt_dlp", "https://youtu.be/abc123"],
                lambda percent, message: updates.append((percent, message)),
                12, 90, "Downloading MP4",
            )
        self.assertGreater(len(updates), 2)
        self.assertLess(updates[0][0], updates[-1][0])
        self.assertIn("MiB/s", updates[1][1])
        self.assertTrue(any(percent > 90 and "FFmpeg" in message for percent, message in updates))
        command = popen.call_args.args[0]
        self.assertIn("--progress-template", command)
        self.assertIn("--newline", command)

    def test_rendered_karaoke_file_uses_current_title(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cached = root / "cached.mp4"
            cached.write_bytes(b"source")

            def fake_run(command, log=None, timeout=900, cwd=None):
                Path(command[-1]).write_bytes(b"rendered")
                return SimpleNamespace(stdout="")

            script = {
                "title": "My Edited Song",
                "video_id": "abc123",
                "url": "https://youtu.be/abc123",
                "cues": [{"start": 0.0, "end": 2.0, "text": "Sing this", "include": True}],
            }
            with patch("karaoke_core.shutil.which", return_value="ffmpeg"), patch("karaoke_core._resolve_source_video", return_value=(cached, "cache")), patch("karaoke_core._run", side_effect=fake_run):
                result = render_karaoke(script, root)
            self.assertEqual(Path(result["output"]).name, "My Edited Song - Karaoke.mp4")

    def test_source_video_download_is_cached_and_reused(self):
        calls = []

        def fake_run(command, log=None, timeout=900, cwd=None):
            calls.append(command)
            output = Path(command[command.index("-o") + 1])
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(b"cached video")
            return SimpleNamespace(stdout="")

        with tempfile.TemporaryDirectory() as temporary, patch("karaoke_core._run", side_effect=fake_run):
            root = Path(temporary)
            cache = root / "cache"
            first, first_origin = _resolve_source_video(
                "https://youtu.be/abc123", "abc123", root / "runs", cache,
            )
            second, second_origin = _resolve_source_video(
                "https://youtu.be/abc123", "abc123", root / "runs", cache,
            )
            self.assertEqual(first, second)
            self.assertEqual(first_origin, "download")
            self.assertEqual(second_origin, "cache")
            self.assertEqual(len(calls), 1)

    def test_existing_run_seeds_source_cache_without_download(self):
        with tempfile.TemporaryDirectory() as temporary, patch("karaoke_core._run") as run:
            root = Path(temporary)
            previous = root / "runs" / "Earlier_20260917_120000_abc123" / "source.mp4"
            previous.parent.mkdir(parents=True)
            previous.write_bytes(b"previous source")
            cached, origin = _resolve_source_video(
                "https://youtu.be/abc123", "abc123", root / "runs", root / "cache",
            )
            self.assertEqual(origin, "previous_run")
            self.assertEqual(cached.read_bytes(), b"previous source")
            run.assert_not_called()

    def test_local_playback_accepts_mp4_and_mp3(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            mp4 = root / "Demo.mp4"
            mp3 = root / "Demo.mp3"
            mp4.write_bytes(b"video")
            mp3.write_bytes(b"audio")
            registry = root / "registry.json"
            registry.write_text(json.dumps({"a" * 32: str(mp4), "b" * 32: str(mp3)}), encoding="utf-8")
            with patch("playback_server.REGISTRY", registry):
                self.assertEqual(playback_server.registered_file("a" * 32), mp4)
                self.assertEqual(playback_server.registered_file("b" * 32), mp3)

    def test_local_playback_page_wraps_video_in_console(self):
        page = playback_server.player_page("a" * 32, Path("Demo_Song.mp4")).decode("utf-8")
        self.assertIn("Media Deck", page)
        self.assertIn('src="/media/', page)
        self.assertIn("<video", page)
        self.assertIn('class="telemetry"', page)
        self.assertIn('id="spectrum"', page)
        self.assertIn("/assets/vu-meter-face.svg", page)
        self.assertNotIn("Playback Engine", page)
        self.assertNotIn('class="reel"', page)
        self.assertNotIn("autoplay", page)
        self.assertIn("fitVideoToStage", page)
        self.assertIn("new ResizeObserver(fitMonitorMedia)", page)
        self.assertIn('id="toggleSidePanel"', page)
        self.assertIn("toggle-extension-side-panel", page)
        self.assertIn("side-panel-toggle-icon", page)
        self.assertIn("karaokePlaybackVolume", page)
        self.assertIn("karaokePlaybackMuted", page)
        self.assertIn("?storedVolume:.5", page)
        self.assertIn("scale=Math.min(availableWidth/media.videoWidth,availableHeight/media.videoHeight)", page)
        self.assertIn("VIDEO<br>POSITION", page)
        self.assertIn('id="videoCenter"', page)
        self.assertNotIn('id="videoPosition" type="range"', page)
        self.assertIn(".video-position{display:none!important}", page)
        self.assertIn('id="equalizer"', page)
        self.assertIn("eqFrequencies=[31,62,125,250,500,1000,2000,4000,8000,16000]", page)
        self.assertIn("createBiquadFilter", page)
        self.assertIn("createChannelMerger(2)", page)
        self.assertIn("STEREO LINKED · 10 BAND · ±12 dB", page)
        self.assertIn("addEqLeds", page)
        self.assertIn("#ff294d", page)
        self.assertIn("builtInEqPresets", page)
        self.assertIn("karaokeCustomEqPresets", page)
        self.assertIn("karaokeEqPresetSelection", page)
        self.assertIn("Manual / Unsaved", page)
        self.assertIn("eqPresetSelect.onchange=loadSelectedEqPreset", page)
        self.assertIn("setEqGain(_channel,band,gain)", page)
        self.assertIn('id="eqSavePreset"', page)
        self.assertIn('id="libraryCounts"', page)
        self.assertIn("/api/library?refresh=", page)
        self.assertIn("karaokeLibraryFilter", page)

    def test_extension_side_panel_session_is_persisted(self):
        script = (playback_server.ROOT / "extension" / "sidepanel.js").read_text(encoding="utf-8")
        self.assertIn('SESSION_KEY="karaokeSidePanelSessionV1"', script)
        self.assertIn("sessionSnapshot", script)
        self.assertIn("restoreSession", script)
        self.assertIn("openPanels", script)
        self.assertIn("mediaOptions", script)
        self.assertIn("sourceDownloads", script)
        self.assertIn("downloadStorageKey", script)
        self.assertIn("async function useCurrentTab(source)", script)
        self.assertIn("ui.clearLog.onclick", script)
        self.assertIn("player_diagnostic", script)
        self.assertIn("media_deck_push_to_talk", script)
        self.assertIn("forwardPlayerPushToTalk", script)
        self.assertNotIn("sidebarSpaceIsTyping", script)
        self.assertIn('ui.useYoutubeTab.onclick=()=>useCurrentTab("youtube")', script)
        self.assertNotIn("...sourceDownloads[source],...(all[url]||{})", script)
        self.assertIn("youtube:${id}", script)
        self.assertIn("youtubeUrl&&(!restored||!ui.youtubeUrl.value)", script)
        self.assertIn('window.addEventListener("pagehide"', script)

    def test_vu_meter_face_is_valid_svg(self):
        root = ET.parse(playback_server.METER_FACE).getroot()
        self.assertTrue(root.tag.endswith("svg"))
        self.assertEqual(root.attrib.get("viewBox"), "0 0 320 120")

    def test_local_playback_page_supports_audio_downloads(self):
        page = playback_server.player_page("b" * 32, Path("Demo_Song.mp3")).decode("utf-8")
        self.assertIn("<audio", page)
        self.assertIn('class="audio"', page)
        self.assertIn("DOWNLOAD LOCAL FILE", page)
        self.assertIn("--beat-opacity", page)
        self.assertIn("bassMean", page)
        self.assertIn("prefers-reduced-motion", page)
        self.assertIn("createChannelSplitter", page)
        self.assertIn("meterMotion", page)
        self.assertIn("LEFT POWER OUTPUT", page)
        self.assertIn("height:104px", page)
        self.assertIn('id="audioScope"', page)
        self.assertIn("drawAudioScope", page)
        self.assertIn("frequencyData=new Uint8Array(analyser.frequencyBinCount)", page)
        self.assertIn("frameTime-lastSpectrumFrame<33", page)
        self.assertIn("if(canvas.width!==width||canvas.height!==height)", page)
        self.assertNotIn("loadLibrary(false).then(()=>loadLibrary(true))", page)
        self.assertIn("labels=['L','R','MID','SIDE']", page)
        self.assertNotIn('<div class="album"><span>K</span></div>', page)
        self.assertIn('<details id="monitorPanel" class="panel monitor-panel" open>', page)
        self.assertIn('id="commandPanel"', page)
        self.assertIn('class="command-help"', page)
        self.assertIn("MEDIA DECK VOICE COMMANDS", page)
        self.assertIn("Combined example:", page)
        self.assertIn('id="pushToTalk"', page)
        self.assertNotIn('id="commandConfirm"', page)
        self.assertNotIn("confirmation-required", page)
        self.assertIn("type!=='media-deck-ptt'", page)
        self.assertIn("recognition.processLocally=true", page)
        self.assertIn("LocalSpeechRecognition.install", page)
        self.assertIn("Translator.availability", page)
        self.assertIn("recognition.onaudiostart", page)
        self.assertIn("voiceAudioStarted=true;pushToTalk.classList.remove('arming');pushToTalk.classList.add('recording')", page)
        self.assertIn("function isolateVoicePlayback()", page)
        self.assertIn("playback-isolated", page)
        self.assertIn("playback-restored", page)
        self.assertNotIn("voiceDuckedVolume", page)
        self.assertIn("MIC · FINISHING LOCALLY", page)
        self.assertIn("voiceStopTimer=setTimeout", page)
        self.assertIn("event.code!=='Space'", page)
        self.assertIn("!event.ctrlKey", page)
        self.assertIn("Hold Ctrl+Space or this button to speak", page)
        self.assertIn('id="wakewordToggle"', page)
        self.assertIn('id="wakewordStatus"', page)
        self.assertIn("LIVEKIT · LOCAL CPU · ONNX", page)
        self.assertIn("/api/wakeword/status", page)
        self.assertIn("wakewordRequest('pause')", page)
        self.assertIn("wakewordRequest('resume')", page)
        self.assertIn("beginPushToTalk(true)", page)
        self.assertIn("recognition.onspeechend", page)
        self.assertNotIn("Silero", page)
        self.assertNotIn("spaceIsTyping", page)
        self.assertIn("event.stopPropagation();voiceSpaceHeld=true", page)
        self.assertIn("player-diagnostic", page)
        self.assertIn("recognition.start(inputTrack)", page)
        self.assertIn("['dictation','command']", page)
        self.assertIn("getUserMedia", page)
        self.assertNotIn("preamp.gain", page)
        self.assertNotIn("LanguageModel.create", page)
        self.assertNotIn("MediaRecorder", page)
        self.assertIn("deckLog('needle','model-ready'", page)
        self.assertIn("/api/command", page)
        self.assertIn("executeNeedleCalls", page)
        self.assertIn("command:'commandPanel'", page)
        self.assertIn("next.searchParams.set('start','voice')", page)
        self.assertIn("voice-playback-started", page)
        self.assertIn("voice-playback-blocked", page)
        self.assertIn("Voice-selected media and analyzers started.", page)
        self.assertIn("Performance Monitor</span>", page)
        self.assertIn("fitAudioScopeToStage", page)
        self.assertIn("scopeAspect=16/9", page)
        self.assertIn("new ResizeObserver(fitMonitorMedia)", page)

    def test_legacy_generic_karaoke_gets_title_based_download_name(self):
        with tempfile.TemporaryDirectory() as temporary:
            run = Path(temporary) / "Legacy_20260917_120000_abc123"
            run.mkdir()
            media = run / "karaoke.mp4"
            media.write_bytes(b"video")
            (run / "transcript.json").write_text(json.dumps({"title": "Correct Song Title"}), encoding="utf-8")
            self.assertEqual(playback_server.friendly_media_name(media), "Correct Song Title - Karaoke.mp4")
            page = playback_server.player_page("c" * 32, media).decode("utf-8")
            self.assertIn('download="Correct Song Title - Karaoke.mp4"', page)

    def test_excluded_non_lyric_cue_is_not_rendered(self):
        ass = captions_to_ass({
            "title": "Demo",
            "cues": [
                {"start": 0.0, "end": 1.0, "text": "[music]", "include": False},
                {"start": 1.0, "end": 2.0, "text": "Actual lyric", "include": True},
            ],
        })
        self.assertNotIn("[music]", ass)
        self.assertIn("Actual", ass)

    def test_context_labels_are_removed_but_lyrics_are_retained(self):
        self.assertEqual(clean_caption_text("[Singing] Take me home"), "Take me home")
        self.assertEqual(clean_caption_text("[Background music]"), "")
        self.assertEqual(clean_caption_text("[gasps]"), "")
        self.assertEqual(clean_caption_text("[gasps] Where did you go"), "Where did you go")
        self.assertEqual(clean_caption_text("[unrecognized stage direction]"), "")
        self.assertEqual(clean_caption_text("Stay [with me] tonight"), "Stay [with me] tonight")

    def test_youtube_speaker_markers_do_not_create_empty_lyric_rows(self):
        self.assertEqual(clean_caption_text(">>"), "")
        self.assertEqual(clean_caption_text(">> The radio forgets the words"), "The radio forgets the words")
        self.assertEqual(clean_caption_text("» Another lyric"), "Another lyric")

    def test_context_only_cues_are_removed_from_existing_transcripts(self):
        ass = captions_to_ass({
            "title": "Demo",
            "cues": [
                {"start": 0.0, "end": 1.0, "text": "[Singing]"},
                {"start": 1.0, "end": 2.0, "text": "[Singing] Real lyric"},
            ],
        })
        self.assertNotIn("[Singing]", ass)
        self.assertIn("Real", ass)


if __name__ == "__main__":
    unittest.main()
