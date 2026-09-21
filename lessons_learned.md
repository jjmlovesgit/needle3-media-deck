# Needle 3 Media Deck: Lessons Learned

Needle 3 works best as a small, typed intent router. The application remains responsible for validation, catalog matching, ambiguity resolution, and execution.

## Tool design

- Use small, explicit tools with narrow responsibilities.
- Prefer clear names such as `show_library_panel`, `show_mp3_files`, and `mute_audio`.
- Separate similar concepts. Showing the library and filtering the library must be different tools.
- Avoid overloaded tools with many optional arguments. Needle sometimes invents defaults or copies the same phrase into title, artist, and album.
- Use enums and required fields wherever possible.
- Keep numeric and nonnumeric actions separate. `set_volume`, `mute_audio`, and `unmute_audio` were more reliable than one general audio tool.
- Relative volume commands such as “louder” and “quieter” were unreliable and were removed.

## Media names and metadata

Messy filenames make routing and matching harder. Playback must not depend directly on filenames.

Each song should have:

- **Title:** required.
- **Artist:** strongly recommended.
- **Aliases:** useful for voice-friendly alternate names.
- **Media type:** MP3, original MP4, or karaoke MP4.
- **Album, track, and year:** optional disambiguation and display fields.

File path, duration, stable IDs, and file format remain system-managed.

The clearest command forms are:

```text
Play Artist Title
Play Artist Title MP3
Play Artist Title MP4
```

Format belongs in `media_type`, outside the title. Aliases participate in exact matching, fallback matching, and library search.

## Treat Needle output as a proposal

Observed model behaviors included:

- Dropping or changing the first word of a title.
- Adding a format that was not explicitly requested.
- Copying the full title into artist or album.
- Inventing optional values such as an equalizer preset.
- Selecting a neighboring tool with high confidence.
- Returning structurally valid output that was semantically wrong.

The execution sequence is therefore:

1. Needle selects the tool and arguments.
2. The validator checks that every argument is grounded in the current command.
3. The catalog matcher resolves the requested media.
4. Typed application APIs execute the result.

The validator rejects incorrect output instead of silently rewriting it. Generic normalization, such as removing a trailing `MP3` token from a title, is acceptable. Media-specific corrections are not.

## Confidence is not correctness

A 100% confidence result can still contain the wrong title, format, or tool.

The confidence slider controls whether a valid proposal waits for confirmation. It does not bypass:

- Schema validation.
- Argument grounding.
- Unsupported-action rejection.
- Explicit MP3/MP4 agreement.
- Missing or invented title-word checks.

A threshold of zero means “automatically execute valid calls,” not “trust everything.”

## Commands are independent

Needle conversation state is cleared after every command while the initialized model remains resident. Commands cannot refer to earlier turns.

`Play Example Song` is self-contained. A later command such as `Play the other version` has no earlier conversational context to resolve against. This produces predictable routing and avoids stale command context.

## Speech recognition is a separate source of errors

The browser speech layer can truncate initial words, as happened with `t the volume to five percent`.

The validator supports grounded digits and English number words without guessing. Manual push-to-talk, a short final-word tail, and one fresh recognition session per command proved more dependable than adding VAD or wake-word behavior prematurely.

## Catalog correction is part of the workflow

MusicBrainz enrichment helps create an initial catalog, but it cannot resolve every file confidently. Manual corrections are part of the product.

The Media Deck provides song-level editing directly in the library. Manual values:

- Update `catalog.json`.
- Never rewrite the media file.
- Take precedence over later enrichment.
- Can add aliases that immediately improve voice matching.

## Honest testing matters

To keep the Needle demonstration credible:

- No real library titles appear in routing code or command examples.
- Regression tests dynamically select catalog entries.
- Every current catalog file is tested for matching and real playback.
- Live Needle tests complement deterministic unit tests.
- Failures and unsupported phrases are documented rather than hidden behind hard-coded fallbacks.

The architecture that worked is:

```text
Speech or typed command
        ↓
Needle tool proposal
        ↓
Generic grounding and schema validation
        ↓
Deterministic catalog matching
        ↓
Typed Media Deck API
        ↓
Playback or UI action
```

Needle provides language interpretation. The application provides truth, safety, identity, and execution.
