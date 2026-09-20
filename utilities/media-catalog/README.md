# Media Catalog Utility

This standalone utility creates a reviewable metadata catalog for a local MP3/MP4 library. It is not imported by Media Deck, does not execute Needle tools, and never writes to or renames media files.

## Scan locally

```powershell
cd utilities\media-catalog
node catalog.mjs scan --source "C:\Projects\karaoke_Agent\output"
```

The default output is `work/catalog.local.json`. It contains stable file IDs, relative paths, normalized fields, and the filename/folder values from which each field was inferred.

## Enrich from MusicBrainz

```powershell
node catalog.mjs plan --catalog work/catalog.local.json
node catalog.mjs enrich --catalog work/catalog.local.json --allow-network
```

`plan` writes `work/enrichment-plan.json` locally so the exact titles and artists that would be transmitted can be reviewed first. Full albums, compilations, and standalone files matching a split-track album are marked `excluded-album` and omitted. Numbered files inside album track folders remain eligible as individual songs. `enrich` requires either `--allow-network` or `--offline`; it will not contact MusicBrainz implicitly.

The default enriched output is `work/catalog.enriched.json`. Responses are cached in `.cache/musicbrainz`, and requests are spaced at least 1.1 seconds apart. The utility sends this contact URL in its User-Agent:

`https://github.com/jjmlovesgit/needle3-media-deck`

Override it with `--contact` if the utility is distributed elsewhere. Use `--limit 10` for a small review batch or `--offline` to use cached responses without network access. A network run sends the inferred title and, when present, artist to MusicBrainz.

Only a high-scoring result supported by both title and artist evidence is automatically accepted. Files without enough evidence receive `review` or `unmatched` status and retain their local metadata. Web candidates never silently replace local values.

Lookup normalization removes generic promotional suffixes such as “official video” and can derive an artist from neutral collection patterns such as “3 Hours of Artist for …”. Display metadata remains unchanged until a high-confidence result is accepted.

Each file has uniform `title`, `artist`, `album`, `track`, `year`, `durationMs`, `musicBrainzRecordingId`, `aliases`, `status`, `confidence`, and `provenance` fields. The catalog also preserves the source-relative path and raw local inference for auditing.

Run `npm test` from this directory. MusicBrainz documents its [API](https://musicbrainz.org/doc/MusicBrainz_API), [recording search fields](https://musicbrainz.org/doc/MusicBrainz_API/Search), and [rate limits](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).
