# Web UI live and replay implementation plan

> **For agentic workers:** Use independent file ownership for each task; integrate through Dashboard after the parallel edits finish.

**Goal:** Make the Visualizer's live and replay views reflect authenticated capture data while keeping long sessions usable and preserving demo mode.

**Architecture:** InkScope remains the only packet decoder. The UI folds validated packet envelopes into cumulative observed state, the map consumes that state, and Replay navigates bounded database pages in record order while timing playback from capture timestamps. Unknown values remain unknown.

**Tech Stack:** TypeScript, Bun, Hono, React, shadcn components, PostgreSQL, Playwright.

## Global constraints

- Never infer player XYZ, tide, WAVE, or server role from an unauthenticated packet or from demo data.
- `wave_preview` is conditional and never becomes an observed WAVE.
- Keep compact labels in the product UI; no explanatory paragraphs or nested cards.
- Do not run a live NIC capture. Offline verification uses an immutable saved PCAP and the existing GameKey file without printing either secret or decrypted payloads.
- Agents own disjoint files. Root owns `app/src/views/dashboard.tsx`, end-to-end test orchestration, final integration, review, and publication.

## Task A: cumulative live observation

**Owner:** `app/src/lib/session-observation.ts`, its tests, `app/src/lib/live-feed.ts`, `app/src/components/dashboard/session-status.tsx`, and its tests.

- [ ] Move the existing proof-verified host/client, RTT Type 1 delay, and authenticated setting extraction from `session-status.tsx` into a pure reducer; do not implement a second peer algorithm.
- [ ] Key state by session ID and decimal-string record; compare records using `BigInt`. Duplicate/older events must not change counters or state.
- [ ] Fold both WebSocket snapshots and packets. Preserve state across a same-session reconnect even if its 512-event snapshot omits the original BrowseReply; reset on a new session or different proof-verified host.
- [ ] Preserve observed StageId, Difficulty, quota, sequence, and only explicitly present WAVE/tide fields; an empty StageId clears the stage. Keep conditional wave previews separate.
- [ ] Expose `observation` from `useLiveFeed` and make `SessionStatus` consume it, retaining its public demo behavior. Test >512 events, snapshot overlap, reconnect, host/session reset, and malformed/unverified fields.

## Task B: map source and observed stage

**Owner:** `app/src/components/dashboard/stage-map.tsx`, `stage-viewer.tsx` only if needed, and map tests.

- [ ] Add an explicit demo/live/replay source prop while keeping existing demo behavior.
- [ ] In live and replay, never render `stagePoints()` players or demo coordinates. Keep RomFS static markers and 3D camera controls available.
- [ ] Consume `observedStageId` and an optional explicitly observed tide from Task A's output, without re-decoding packets. Mark a manually selected static stage separately from an observed stage; unknown stage IDs do not silently claim a known stage.
- [ ] Verify stage switching, no demo players in live/replay, and camera controls with Playwright/unit tests.

## Task C: bounded replay navigation and timing

**Owner:** `app/src/lib/replay-archive.ts`, `app/src/views/replay-view.tsx`, replay tests; add a pure timing helper if useful. Avoid `dashboard.tsx` and Task A/B files.

- [ ] Keep only a bounded page/window of events in browser memory. Navigate backward and forward through a PostgreSQL session by record cursor; show the loaded record and capture-time range.
- [ ] Resolve `hasMore` from the session count, including an exact multiple of the page size. Cancel or ignore stale fetches on session switch and clear the pending state.
- [ ] Use `timestamp_ns` BigInt deltas for playback timing within the loaded record-ordered page, clamping equal, decreasing, or very large gaps. On page end, either load the next page or stop with an explicit boundary.
- [ ] Keep the existing demo replay distinct. Test page boundaries, session switches, and time deltas.

## Root integration and verification

- [ ] Wire the observation into Dashboard, Overview, Map, and OBS without displaying fields the overlay protocol does not carry. Pass the Replay interface produced by Task C and remove the old fixed-500 ms live replay timer.
- [ ] Run the saved 8,195,807-byte `gameplay-snapshot-230000-230800.pcap` through InkScope `inspect` offline and the local Hono/PostgreSQL pipeline. Verify record-count correspondence, authenticated RTT/PrivateSetting readback, session replay, and browser rendering. A bounded derived PCAP may be used for a fast UI run; preserve the original bytes and record its SHA-256.
- [ ] Run Bun typecheck/unit tests, Playwright, Rust regression tests if Rust files change, review actual diffs, and verify the final URL.

## Known data boundary

The current InkScope wire envelope has no confirmed live player position fields. The map must show no live player markers until those fields are decoded and validated; static terrain and markers remain useful. A late browser attach can only reconstruct state present in the server snapshot unless a future server-side session summary is added.
