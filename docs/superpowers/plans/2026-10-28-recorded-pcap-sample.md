# Recorded PCAP Sample Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the independent tasks below, then verify the integrated app.

**Goal:** Show a local, previously captured Salmon Run packet window as the Visualizer's default sample without presenting synthetic game facts as observed data.

**Architecture:** InkScope imports the original PCAP into the existing local PostgreSQL sidecar. An ignored local environment file identifies a session and the record immediately before a bounded 1,200-packet gameplay window. Hono serves that window from the existing persistence reader; the React recorded mode derives packet and session views from its validated envelopes. The synthetic demo remains an explicit mode and a visible fallback when no sample is configured.

**Tech Stack:** Bun, Hono, PostgreSQL, React, TypeScript, Playwright.

**Spec:** The user's request to use a past played capture as mock data, with the existing Visualizer and PCAP evidence.

## Global Constraints

- Keep the original PCAP, GameKey, PostgreSQL content, and local environment secrets out of Git.
- Only display decoded fields present in the selected window. Quota and Sequence are decoded internal values, not confirmed game HUD WAVE/Quota.
- Enemy SpawnX/Y/Z is an enemy event position, never a player position. No observed player XYZ or tide is available.
- LIVE remains a WebSocket stream; RECORDED remains a bounded database sample; DEMO remains synthetic.
- The Hono server stays loopback-only, and the sample API sends `Cache-Control: private, no-store`.

## Review Focus

- Missing/empty sample and failed sample read produce distinct visible states; only missing config may fall back to synthetic demo.
- The selected cursor maps to exported PCAP records and the window includes OnlineCoopSetting, CoopSequenceNetState, and enemy SpawnX/Y/Z.
- Status, Overview, Map, Replay, and OBS never inherit synthetic WAVE, keys, stage, RTT, or player coordinates in RECORDED mode.
- An explicit `?source=demo` override remains deterministic for existing demos and tests.
- Tests use synthetic envelopes, never copied real events or secrets.

---

### Task 1: Local sample endpoint and loader

**Files:** `api/index.ts`, `api/app.ts`, `api/app.test.ts`, `app/src/lib/recorded-sample.ts`, its tests.

- [x] Validate the optional `INKSCOPE_SAMPLE_SESSION_ID` and `INKSCOPE_SAMPLE_AFTER_RECORD` pair at startup; pass it to `createApp`.
- [x] Add `GET /api/sample` using `PostgresPersistence.readEvents(sessionId, afterRecord, 1200)` with distinct unavailable/empty/ready responses and no-store headers.
- [x] Add a React loader that validates `PacketEnvelope` records and exposes loading/ready/unavailable/empty/error state.
- [x] Test the endpoint and loader with synthetic envelopes, including malformed data and missing session.

### Task 2: Recorded presentation

**Files:** `app/src/components/dashboard/session-status.tsx`, `obs-overlay.tsx`, `stage-map.tsx`, related view prop types/tests.

- [x] Add a RECORDED branch that renders observed values and unknowns, without stream-connection, synthetic key, WAVE, or player-position claims.
- [x] Make the OBS overlay in recorded mode read the same sample instead of synthetic values.
- [x] Keep the Map's recorded mode free of simulated player points and label the selected stage as observed only when the window contains it.
- [x] Test the absence of synthetic values and positions.

### Task 3: Dashboard integration and local import

**Files:** `app/src/views/dashboard.tsx`, relevant Playwright tests, `README.md`, ignored `.env.local`.

- [x] Import the 39,913-packet PCAP through the existing authenticated offline exporter; verify complete PostgreSQL readback and the gameplay cursor.
- [x] Configure the local session ID and cursor; leave both out of Git.
- [x] Default to RECORDED when configured; preserve explicit DEMO and LIVE selection. Show a visible label for each mode and the sample's record range.
- [x] Feed recorded envelopes through the existing packet and observation reducers for Overview/Debug/Raw/status/Map/OBS. Page Debug/Raw through the complete sample window.
- [x] Start RECORDED Replay at the configured `OnlineCoopSetting` window, with the exact PostgreSQL row offset.
- [x] Run Bun tests, build, focused Playwright tests, and a real-browser smoke against the imported sample. Review the diff and confirm no capture or key bytes entered Git.
