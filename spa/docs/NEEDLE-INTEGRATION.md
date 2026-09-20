# Needle 3 typed-command integration

The reference UI now runs real local Needle inference in one module worker. Reload the page, wait for **WASM READY**, enter a command and select **Run Command**, or hold the microphone button or **Ctrl+Space**, speak, and release. Manual speech uses the browser's on-device recognition API. VAD and wake-word controls remain disabled.

## Try

- Set volume to 35 percent
- Load the Rock EQ preset
- Close the equalizer
- Show karaoke videos
- Play Kryptonite Official Video
- Pause playback

Exact titles resolve through the application library. Partial or duplicate matches present candidates and never start a guessed track. Manual controls remain available.

## Assets and provenance

Official source: https://huggingface.co/Cactus-Compute/needle3/tree/b274efcb211a9eef48c9a88da4b43bd569696a39

Pinned revision: `b274efcb211a9eef48c9a88da4b43bd569696a39`. Full 20-layer model: 35,335,380 bytes. Runtime WASM: 688,521 bytes. License: Apache-2.0; see `licenses/needle3-LICENSE`.

`node scripts/acquire-needle.mjs` downloads the official model, WASM, JavaScript wrapper, API header, and license at that immutable revision. It checks published Git blob/LFS identities and byte lengths, then records SHA-256 values in `needle-assets.lock.json`. Assets live in ignored `app/vendor/needle3/`; they are not added to Git.

The original wrapper is preserved. The generated `needle-browser.mjs` adds an ES module export and initializes `NEEDLE_TELEMETRY=0` and `DO_NOT_TRACK=1`; its header identifies the modification. The development server verifies all installed files against the lock before startup. The worker checks model/WASM hashes before loading. CSP limits connections to this origin and permits WASM compilation.

## Execution boundaries

A single initialized worker serializes requests and resets per-command model state while retaining the model and tool catalogue. Application code validates the entire proposed batch before executing any action. Tool names, arguments, types, enums, numeric ranges, and their presence in the request are checked. The executor calls application APIs; model output cannot supply code, paths, URLs, or DOM selectors.

There is one small grounded normalization: an explicit request to show/list/filter a known media category can convert a model search-category result into a library filter. Other invented arguments are rejected. Confidence is displayed but is not treated as proof of correctness.

Manual push-to-talk is the only microphone owner. Speech-pack readiness, microphone acquisition, and creation of a fresh recognition object happen sequentially for each hold. Release includes a 450 ms final-word tail. Recognition is forced to `processLocally`; no raw audio or transcript history is stored. The browser may install its local language pack on first use. No VAD, wake-word model, native executor, or background listener is added. Shared media remains read-only at `C:\Projects\karaoke_Agent\output`, served through the existing loopback adapter. Offline warm inference works after assets load; a fresh page still needs the local server. This is not a service-worker-cached installed app.

## Validation and limits (2026-09-20)

The actual-model Edge integration test verified playback, pause, volume, EQ, panel control, category filtering, ambiguous-title handling, rejection of “Delete all files”, one worker across commands, reload, and warm inference with the browser offline. External requests were blocked throughout; zero external attempts and zero page errors were observed. The 390px screenshot was inspected and had no horizontal overflow.

On this host: initialization about 4.26 seconds; sampled warm routes 337–569 ms; WASM allocation 116.8 MiB. These are a small local sample, not cross-device benchmarks. The runtime reports invalid negative/zero peak RAM values, so peak RAM is shown as unavailable. WASM allocation is not total browser memory.

Known accuracy issue: “Set volume to 42 percent” and “Set volume to 25 percent” caused the model to add an unrequested preset. Validation rejected those entire calls and preserved settings. The regression test explicitly checks this rejection; it does not count it as successful volume routing. Digit-based volume requests are required by the current validator. Arbitrary phrasing, compound/negated requests, and general routing accuracy need a larger evaluation before voice activation. Only the full model was tested; reduced-depth resource tuning remains open.

Run `npm test`, then `node tests/browser-smoke.cjs` and `node tests/needle-integration.cjs` with an existing Playwright package configured via `PLAYWRIGHT_MODULE`. Set `TEST_ARTIFACTS_DIR` for screenshots and start the local server first. The integration fixture uses the confirmed shared library titles.
