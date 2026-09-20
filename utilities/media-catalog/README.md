# Media Catalog Utility

This standalone utility creates a reviewable metadata catalog for a local MP3/MP4 library. It is not imported by Media Deck, does not execute Needle tools, and never writes to or renames media files.

## Scan locally

```powershell
cd utilities\media-catalog
node catalog.mjs scan --source "C:\Projects\karaoke_Agent\output"
```

The default output is `work/catalog.local.json`. It contains stable file IDs, relative paths, normalized fields, and the filename/folder values from which each field was inferred.

## Match, then enrich from MusicBrainz

```powershell
node catalog.mjs plan --catalog work/catalog.local.json
node catalog.mjs match --catalog work/catalog.local.json --limit 10 --allow-network
node catalog.mjs enrich --catalog work/catalog.matches.json --allow-network
```

`plan` writes `work/enrichment-plan.json` locally so the exact titles and artists that would be transmitted can be reviewed first. Full albums, compilations, and standalone files matching a split-track album are marked `excluded-album`. Media longer than ten minutes is marked `excluded-long-form`. Both statuses are omitted from matching and metadata retrieval. Numbered files inside album track folders remain eligible only when their individual duration is ten minutes or less.

The local `scan` command uses an existing `ffprobe` executable on `PATH` to read duration. It does not install or bundle FFmpeg, and the playback application has no dependency on it. If duration cannot be read, `durationMs` remains `null` for review rather than guessing from file size.

`match` performs recording search and writes `work/catalog.matches.json`. It retains and caches only the candidate recording ID, title, artist, and match score, discarding other fields returned by search. It does not change catalog metadata. `enrich` then performs an ID lookup only for records with `matched` status; `review`, `unmatched`, and `excluded-album` records never trigger metadata lookups. Both network commands require either `--allow-network` or `--offline`.

The default enriched output is `work/catalog.enriched.json`. Search and metadata responses use separate caches in `.cache/musicbrainz`, and requests are spaced at least 1.1 seconds apart. The utility sends this contact URL in its User-Agent:

`https://github.com/jjmlovesgit/needle3-media-deck`

Override it with `--contact` if the utility is distributed elsewhere. Use `--limit 10` for a small review batch or `--offline` to use cached responses without network access. A network run sends the inferred title and, when present, artist to MusicBrainz.

Only a high-scoring result supported by both title and artist evidence receives `matched` status. Files without enough evidence receive `review` or `unmatched` status and retain their local metadata. Full metadata is applied only after lookup of a matched recording ID.

Lookup normalization removes generic promotional suffixes such as “official video” and can derive an artist from neutral collection patterns such as “3 Hours of Artist for …”. Display metadata remains unchanged until a high-confidence result is accepted.

Each file has uniform `title`, `artist`, `album`, `track`, `year`, `durationMs`, `musicBrainzRecordingId`, `aliases`, `status`, `confidence`, and `provenance` fields. The catalog also preserves the source-relative path and raw local inference for auditing.

Run `npm test` from this directory. MusicBrainz documents its [API](https://musicbrainz.org/doc/MusicBrainz_API), [recording search fields](https://musicbrainz.org/doc/MusicBrainz_API/Search), and [rate limits](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).
