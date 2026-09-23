# Needle Training Plan

## Purpose

Improve Media Deck's local Needle routing for standalone voice or typed commands without moving identity, matching, safety, or playback decisions into the model.

Needle interprets language and proposes calls. The application validates grounding, resolves media against the local catalog, and executes typed APIs.

```text
Speech or typed command
        ↓
Needle tool proposal
        ↓
Generic schema and grounding validation
        ↓
Deterministic catalog matching
        ↓
Typed Media Deck API
        ↓
Playback or UI action
```

## Training contract

The fine-tune must learn the existing tool schema and these rules:

- Each request is independent. Needle history is reset before every route.
- A named playback call preserves the complete requested title and any explicitly named artist.
- A final literal `MP3` maps to `media_type: "mp3"`.
- A final literal `MP4` maps to `media_type: "mp4"`.
- A command without either literal format uses `media_type: "any"`.
- Catalog labels, aliases, and title words are not commands or inferred arguments.
- Optional arguments are omitted when the user did not state them.
- Unsupported requests produce an empty call list.
- The model does not select catalog records or operate the DOM.

The corpus must contain no application-side title-specific routing logic. Catalog data is a supervised training value only; at runtime, the model receives tools and the user command, then the application resolves truth from its catalog.

## Local dataset

The generator is [generate-needle-training-data.mjs](scripts/generate-needle-training-data.mjs).

```powershell
cd C:\Projects\needle3-media-deck-reference-clone\spa
node scripts\generate-needle-training-data.mjs
```

It reads the local Demo catalog and current tool schema, then writes ignored local files to:

```text
C:\Projects\needle3-media-deck-reference-clone\demo\needle-training-data\
  train.jsonl
  validation.jsonl
  test.jsonl
  manifest.json
```

Each JSONL row uses Needle's documented `query`, `tools`, `answers`, `reasoning`, and `system` fields. The corpus includes named playback, aliases, transport, seeking, library and panel actions, volume, EQ, and unsupported-request examples.

Each row carries only the tool schema relevant to its expected call. This is intentional: serializing all 20 application tools made rows exceed Needle's 1,024-token training cap and truncated the supervised answer, producing a meaningless zero loss. Unsupported-request rows use a small plausible tool set and an empty answer. The browser benchmark still evaluates the tuned model against the full SPA tool schema.

Raw media files, audio, microphone recordings, and external metadata are never included.

## Split policy

The split unit is a normalized **artist + title song group**. Every MP3, original-MP4, karaoke-MP4, and alias associated with one song group goes into exactly one of training, validation, or held-out test.

Target allocation is approximately 70% training, 15% validation, and 15% held-out test. Each split must contain applicable MP3, original-MP4, and karaoke-MP4 coverage when the catalog has enough distinct groups.

The generator records every assignment in `manifest.json`. A split collision is a benchmark failure.

Known real failures are added to the held-out regression suite. They must never be copied into training just to improve their score.

## Benchmark protocol

Before training, run the frozen benchmark against the deployed base model. After training, run the identical harness against the tuned model.

Each row is a fresh Needle turn using the same:

- model depth,
- tool schema,
- routing contract,
- decoding limit,
- catalog snapshot, and
- application validator and matcher.

Record these measures separately:

| Measure | Meaning |
| --- | --- |
| Exact tool-call match | Intended tool was selected. |
| Exact argument match | Title, artist, and media type were correctly grounded. |
| Validator acceptance | The proposed call meets application safety rules. |
| Catalog resolution | The intended record is deterministically selected. |
| Execution success | Playback or UI API action completed. |
| Empty-call accuracy | Unsupported input does not trigger an invented action. |
| Resource measurements | Route latency, model bytes, and WASM memory stay suitable for local deployment. |

A training run is accepted only if the held-out suite improves the target failures without increasing unsupported-command calls or reducing correct catalog resolution.

## Frozen base-model baseline

Captured on 2026-09-21 before any Media Deck fine-tuning:

| Measure | Base-model result |
| --- | --- |
| Held-out rows | 194 |
| Exact expected calls | 23 / 194 (11.9%) |
| Validator and execution success | 158 / 194 (81.4%) |
| Named playback exact calls | 2 / 165 (1.2%) |
| Unsupported requests correctly empty | 1 / 6 |
| Mean local route time | 946 ms |
| Model | Needle 3, 20 layers, 33.7 MiB |
| Initial WASM allocation | 118.1 MiB |

The complete per-row report is ignored local data at:

`C:\Projects\needle3-media-deck-reference-clone\demo\needle-benchmarks\baseline.json`

Exact call match is intentionally strict: tool name and every argument must equal the frozen expected call. Validator and execution success remain separate measures because a catalog-safe, executable proposal can still differ from the intended extraction. The tuned model must be measured against this same JSONL split, unchanged server contract, and same browser harness.

A second local run produced the same accuracy counts and a 950 ms mean route time. This confirms the baseline is repeatable within normal local timing variation.

An initial local training attempt was discarded before completion after reporting zero loss from the first steps. Its full-tool rows exceeded the training cap, so it did not provide valid supervision and is not a training result.

## Active local CPU run

Started 2026-09-21 after regenerating compact per-row schemas.

| Setting | Value |
| --- | --- |
| Backend | CPU, float32 |
| Base depth | 20 layers |
| Training rows | 630 |
| Trainer validation holdout | 63 rows |
| Sequence length | 512 tokens; 1,024-token cap |
| LoRA | rank 16, alpha 32, five weight groups |
| Schedule | 720 steps, 20 epochs, warmup 36, cosine decay, clip 1.0 |
| Seed | 0 |

Observed progress confirms that supervision is present:

| Epoch | Training loss | Validation loss |
| --- | --- | --- |
| 1 | 0.7715 | 0.7641 |
| 2 | 0.6766 | 0.5648 |
| 3 | 0.4859 | 0.3387 |
| 4 | 0.1521 | 0.1769 |
| 5 | 0.0375 | 0.1056 |
| 6 | 0.0669 | 0.0845 |
| 7 | 0.1920 | 0.0733 |
| 8 | 0.1224 | 0.0650 |
| 9 | 0.0891 | 0.0610 |
| 10 | 0.1139 | 0.0569 |
| 11 | 0.0211 | 0.0544 |
| 12 | 0.0596 | 0.0523 |
| 13 | 0.0311 | 0.0495 |
| 14 | 0.0342 | 0.0479 |
| 15 | 0.0309 | 0.0474 |
| 16 | 0.0667 | 0.0473 |
| 17 | 0.0496 | 0.0470 |
| 18 | 0.1284 | 0.0467 |
| 19 | 0.0065 | 0.0467 |
| 20 | 0.0280 | 0.0463 |

The 20-epoch run completed optimization and validation, but did **not** produce an adapter. Needle attempted to write models\\media-deck.adapter.safetensors, but the explicit models parent directory did not exist; serialization failed with Windows error 3. The trainer saves only after the loop, so its in-memory LoRA state was lost when the process exited. The directory was created on 2026-09-22 before rerunning the identical command.

Do not interpret loss as product success; the unchanged held-out SPA benchmark is the acceptance measure after a successful export. This run also used the pre-correction corpus and is therefore not a quality result.

## Five-epoch smoke export

A five-epoch CPU run using the same data and seed was used to verify that the output directory fix works. Its schedule was 180 steps with warmup 9, so its losses are not directly comparable to the 20-epoch schedule.

| Epoch | Training loss | Validation loss |
| --- | --- | --- |
| 1 | 0.7095 | 0.7090 |
| 2 | 0.6527 | 0.5426 |
| 3 | 0.5663 | 0.4244 |
| 4 | 0.3403 | 0.3758 |
| 5 | 0.2419 | 0.3688 |

The adapter exported successfully to models\\media-deck-smoke.adapter.safetensors (7.9 MB). Build it into a separately named .cact; retain the existing base browser artifact until held-out benchmarking is complete.

This adapter and its 63.44 MB merged .cact proved the export and model-selection path. They are **not** quality candidates because they used the corpus described below before collision correction.


## Corpus correction and valid benchmark baseline

A 2026-09-22 audit found a generator defect: an unsuffixed playback phrase was emitted once with `media_type: any` and again with the physical item type. That created contradictory supervision: 204 conflicting prompts in the old 630-row training split, 56 in validation, and 52 in the former 194-row held-out split. The old base report and both pre-correction LoRA artifacts were deleted after the audit to prevent accidental reuse; their documented metrics remain historical context only.

The generator now emits `any` only for unsuffixed playback, and physical media types only when the phrase ends in literal `MP3` or `MP4`. It asserts that no query has more than one target and deduplicates evaluation rows. The corrected splits contain:

| Split | Rows | Conflicting targets |
| --- | ---: | ---: |
| Training | 418 | 0 |
| Validation | 139 | 0 |
| Held-out test | 123 | 0 |

The valid base-model benchmark is `demo/needle-benchmarks/baseline-unambiguous.json`:

| Measure | Base-model result |
| --- | --- |
| Held-out rows | 123 |
| Exact expected calls | 23 / 123 |
| Validator and execution success | 99 / 123 |
| Named playback exact calls | 2 / 94 |
| Unsupported requests correctly empty | 1 / 6 |
| Mean local route time | 967 ms |
| Model / WASM allocation | 33.7 MiB / 118.1 MiB |

The pre-correction five-epoch adapter was evaluated only to verify the test-artifact selection path. It improved exact calls (37) and validator acceptance (109), but execution fell to 92; this is not comparable evidence. Every future LoRA run and comparison must use the corrected splits and this valid baseline.
## Corrected five-epoch gate

Approved on 2026-09-22. Before any corrected 20-epoch run, train and evaluate a five-epoch smoke adapter from the zero-conflict corpus:

```powershell
needle finetune .\demo\needle-training-data\train.jsonl --epochs 5 --seed 0 --out .\models\media-deck-corrected-smoke.adapter.safetensors
```

Build and benchmark it as a separately named model. It advances to a longer run only if the 123-row held-out benchmark improves named-playback extraction while preserving or improving the valid base execution result of 99 / 123 and unsupported-request accuracy of 1 / 6. Otherwise, revise data or examples before spending a longer CPU run.
### Corrected five-epoch run result

The approved corrected CPU gate completed and exported `models\media-deck-corrected-smoke.adapter.safetensors`. Its 120-step schedule and 41-row trainer validation holdout produced:

| Epoch | Training loss | Validation loss |
| --- | --- | --- |
| 1 | 1.0623 | 0.9716 |
| 2 | 0.8905 | 0.8693 |
| 3 | 0.7425 | 0.7860 |
| 4 | 0.7407 | 0.7472 |
| 5 | 0.7156 | 0.7419 |

This confirms the corrected corpus trains and exports. Its routing quality remains undecided until the separately built model completes the 123-row held-out benchmark.
### Corrected five-epoch gate benchmark

The separately staged corrected smoke model was evaluated against the frozen 123-row held-out split. This is the first valid tuned-model comparison because both corpus and evaluation are conflict-free.

| Metric | Base model | Corrected five-epoch model |
| --- | ---: | ---: |
| Exact calls | 23 | 27 |
| Validator acceptance | 99 | 112 |
| Execution passed | 99 | 112 |
| Exact named playback | 2 / 94 | 5 / 94 |
| Unsupported requests correctly empty | 1 / 6 | 2 / 6 |
| Mean route time | 967 ms | 992 ms |
| Model bytes / WASM allocation | 33.7 MiB / 118.1 MiB | 60.5 MiB / 174.5 MiB |

The model meets the approved gate: named playback and execution improved, unsupported-request accuracy did not regress, and the 25 ms latency increase is measured. The corrected 20-epoch run is justified. The complete report is `demo/needle-benchmarks/corrected-smoke-5-epoch.json`.
### Corrected twenty-epoch benchmark: rejected

The corrected 20-epoch run exported successfully with final trainer validation loss 0.1500, then was evaluated against the same frozen 123-row held-out split.

| Metric | Base model | Corrected five-epoch | Corrected twenty-epoch |
| --- | ---: | ---: | ---: |
| Exact calls | 23 | 27 | 27 |
| Validator acceptance | 99 | 112 | 99 |
| Execution passed | 99 | 112 | 92 |
| Exact named playback | 2 / 94 | 5 / 94 | 9 / 94 |
| Unsupported requests correctly empty | 1 / 6 | 2 / 6 | 4 / 6 |
| Mean route time | 967 ms | 992 ms | 805 ms |

The model failed the predeclared acceptance rule because execution fell below the base result (92 versus 99). It is rejected for deployment despite improvements in named playback and unsupported-request handling. The complete review record is `demo/needle-benchmarks/corrected-20-epoch.json`; its adapter and staged test model are removed to prevent accidental selection. This experiment shows that lower trainer validation loss and more epochs do not by themselves predict higher application-level execution success.
## Training paths

### Local LoRA

Local training is the first evaluation path because the data remains on this machine.

**Selected first-run path: native Windows CPU.** The current dataset is small enough to establish a before/after routing result without WSL2. The RTX 5090 path remains available later through WSL2/Linux if iteration time becomes limiting.

```powershell
cd C:\Projects\needle3-media-deck-reference-clone
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install "cactus-needle[train]"
python -c "import jax; print(jax.devices())"
needle finetune .\demo\needle-training-data\train.jsonl --epochs 20 --seed 0 --out .\models\media-deck.adapter.safetensors
needle build --lora .\models\media-deck.adapter.safetensors --layers 20 --out .\models\media-deck-tuned.cact
```

The adapter is merged into a single `.cact` archive. The SPA keeps its WASM engine and uses the tuned archive in place of the base archive for A/B testing.

JAX does not provide native-Windows NVIDIA GPU wheels. Use WSL2/Linux for the RTX 5090 path. Python 3.12 is recommended inside WSL2; Python 3.13 also failed the package resolver during the initial native-Windows attempt. Native Windows can run a CPU-only local fine-tune with `cactus-needle[train]`, which is the selected first-run path.

Local LoRA does not train Needle's confidence head, so the tuned model reports no calibrated confidence. The confidence slider cannot be used as a comparable automatic-execution signal until the UI has an explicit no-confidence policy.

### Hosted full fine-tune

Needle's hosted platform fine-tune trains the full model and calibrated confidence head, but requires uploading the split files to Cactus. That path is not used unless the data-transfer decision is explicitly approved.

## Reproducibility and review

- Commit generator source and this plan; do not commit generated JSONL, adapters, tuned `.cact` archives, raw Demo media, or API keys.
- Fix a dataset seed before any comparison.
- Save the catalog snapshot hash, schema hash, model revision, command line, GPU details, and benchmark report with each run.
- Use the held-out report to decide whether the model improved. Do not tune the prompt, templates, epoch count, or LoRA rank after looking at held-out results without creating a new held-out set.
- Keep application validation active for both base and tuned models.

## Open decisions

1. Finalize whether only literal `MP3` and `MP4` are voice format suffixes. This avoids collisions with legitimate title words such as “Video”.
2. Define the UI behavior when local-LoRA confidence is unavailable.
3. Establish a dedicated held-out regression file for observed production failures before the first baseline run.
4. Decide the target deployment depth after measuring accuracy, latency, and memory on the intended Windows hardware.
