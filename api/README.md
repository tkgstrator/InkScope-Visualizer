# InkScope live API

The Bun/Hono server still binds to `127.0.0.1:10252`. Without an InkScope
connection, the UI can use its explicit demo mode. Live event streams do not
generate substitute packets after a disconnect.

## Start the receiver

Set the same nonempty `INKSCOPE_VISUALIZER_TOKEN` in the Visualizer server and
the InkScope process. The publisher WebSocket endpoint is
`ws://127.0.0.1:10252/api/ingest`; it requires an HTTP
`Authorization: Bearer <token>` handshake header. An unset server token
disables ingress with HTTP 503. A wrong token receives HTTP 401. The token is
never sent to browser streams or written to PostgreSQL.

```sh
INKSCOPE_VISUALIZER_TOKEN='<local private token>' bun run start
```

From the sibling InkScope repository, `inspect` or `capture` can opt into the
publisher with global `--visualizer-url ws://127.0.0.1:10252/api/ingest`, or
`INKSCOPE_VISUALIZER_URL` when the flag is omitted. InkScope reads the token
from `INKSCOPE_VISUALIZER_TOKEN`; it does not accept a token in the URL.

## Event contract

`api/fixtures/packet-v1.json` is the checked-in, synthetic v1 golden
event (SHA-256
`e3095bfae5c521d389b36cea1f0204dbe3ba036b7a55b9a8725a481230eba3f8`).
`api/wire.ts` exports its TypeScript contract and validates every received
message. The packet envelope has `version: 1`, `type: "packet"`, a UUID
`session_id`, decimal-string `record` and `timestamp_ns` values, original UDP
`payload_hex`, endpoints and MACs, and sanitized decoded `rows`. Decimal
strings preserve full `u64` precision. Explicit key material and
`authenticated_payload_hex` are excluded from rows. The raw UDP payload is
available only to the full local live stream and stored replay.

The server accepts records in increasing order for each session. A repeated
record gets a `duplicate` acknowledgement; a smaller record gets `stale`.
A jump in record numbers produces a `gap` message before the new packet.
Acknowledgements say `persistence: "memory"` or `"postgres"`. A PostgreSQL
acknowledgement is sent only after an insert succeeds; memory acknowledgements
do not promise durable storage. The in-memory recent window is bounded by
event count and total encoded bytes. Senders also face a bounded processing
queue, and slow browser clients are disconnected.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/status` | Ingest enabled flag, storage mode, retained event count, connected readers. |
| `WS /api/live` | Read-only full packet stream. Sends `hello`, bounded `snapshot`, `packet`, and `gap` messages. |
| `WS /api/overlay` | Read-only OBS stream. Sends `hello`, reduced `snapshot`, `summary`, and `gap`; no raw bytes or decoded fields. |
| `WS /api/ingest` | Native InkScope publisher. Requires the bearer token. |
| `GET /api/sessions` | Saved session summaries when PostgreSQL is configured; `include_session_id=<UUID>` keeps a selected older session in the list. |
| `GET /api/sessions/:id/events?after_record=...&limit=500` | Ordered saved packets; maximum batch size 500. |
| `GET /api/sample` | The locally configured recorded sample window, at most 1,200 packets, or an explicit unavailable/empty state. |

Browser WebSockets with a foreign `Origin` are rejected before upgrade. A
browser stream closes if it tries to publish. All endpoints remain available
only on the local loopback listener.

## Optional InkScope control for Settings

Set a separate `INKSCOPE_CONTROL_TOKEN` of at least 32 printable ASCII bytes
to enable the Settings connection. Generate it randomly; a short token would
make the identity HMAC susceptible to offline guessing, so both processes
reject it.
Use the same token for an InkScope `capture` process started with
`--control-port <port>`; the control listener binds only to `127.0.0.1`.
Settings accepts only the literal `127.0.0.1` and a port from 1 to 65535.
The InkScope capture must already be running. `Connect` may submit a 32-digit
hexadecimal GameKey for future UDP records, or omit the key to discover a
capture already configured by a CLI or mounted key file. It does not start
capture or change the PCAP tee. `Disconnect` clears a control-supplied key at the next packet
boundary while capture and the publisher continue.

The browser talks only to the same-origin Hono API; requests with a non-local
or mismatched HTTP `Host` are rejected before any API read. Hono first requests
`GET /control/v1/identity?nonce=...` without a token or GameKey and verifies
the returned HMAC-SHA256 with `INKSCOPE_CONTROL_TOKEN`. The signature covers
the nonce, instance ID, and actual `127.0.0.1:<port>` listener address, so a
different local port cannot relay a valid proof. Hono sends exactly one
authenticated status/connect/disconnect request on that same TCP connection.
For a key mutation it opens a second connection, verifies identity again, and
pins the instance ID before sending the key. This keeps a newly bound service
from receiving the token or GameKey after the first identity check. The proxy
uses a numeric loopback address with no DNS, environment HTTP proxy, or
redirect following; it limits body and response sizes and times out after 1.5
seconds per request.

| Same-origin endpoint | Result |
| --- | --- |
| `GET /api/control/status` | `unconfigured`, `reachable`, `unreachable`, or `untrusted`; reachable status includes sanitized capture, key state, key source, lock flag, and publisher connection. |
| `POST /api/control/connect` | JSON `{ "host": "127.0.0.1", "port": 10254 }` returns HTTP 200 with reachable status. Add `"game_key": "<32 hex>"` to queue a key and receive HTTP 202 with `key_state: "pending"`. A locked startup key returns HTTP 200 status without receiving the entered key. |
| `POST /api/control/disconnect` | JSON `{}`; HTTP 202 with pending key removal. The target is kept so status can report when the key becomes absent. |

Both POST routes require an exact same-origin `Origin` and
`Content-Type: application/json`. If the control token is unset, mutations
return HTTP 503. A key supplied when InkScope started is locked: status reports
`key_locked: true` and a source such as `file`. A control `disconnect` returns
HTTP 409; a `connect` request returns the reachable locked status without
sending the entered GameKey to InkScope. The proxy never sends a key or token
before the signed identity check on the same socket, returns only allowlisted
status fields, and does not retain the
GameKey in Hono state, packet events, or PostgreSQL. The browser should keep it
only in the password input and clear that input after a successful request.

## Optional PostgreSQL sidecar

The checked-in `compose.yaml` uses PostgreSQL 17 on
`127.0.0.1:10253` and a named local volume. Its password is a public local
development default; choose private credentials if you change its scope.

```sh
docker compose up -d --wait postgres
DATABASE_URL='postgres://inkscope:inkscope_local_only@127.0.0.1:10253/inkscope' \
  INKSCOPE_VISUALIZER_TOKEN='<local private token>' bun run start
```

With `DATABASE_URL`, startup connects and creates `inkscope_packet_events`,
then loads a recent window for reconnecting viewers. A database failure stops
the server with an explicit error. Without `DATABASE_URL`, the status reports
`mode: "memory"`, and replay routes return HTTP 503 rather than demo data.
The table uses `NUMERIC(20,0)` for full unsigned record/timestamp values and
JSONB for the validated envelope. `(session_id, record)` is unique.

For a local recorded sample, set both `INKSCOPE_SAMPLE_SESSION_ID` and
`INKSCOPE_SAMPLE_AFTER_RECORD` in the ignored `.env.local` file. The cursor is
the record immediately before the first packet to show. `/api/sample` reads
through the existing PostgreSQL persistence layer and sends
`Cache-Control: private, no-store`. It returns `state: "unavailable"` without a
sample configuration, `state: "empty"` when that cursor has no records, and
`state: "ready"` with the configured session ID, cursor, exact zero-based
`start_index`, and ordered events.
The server binds to loopback; real packet bytes, peer addresses, and database
content stay local and are never added to the repository.

`bash api/test-postgres.sh` creates a disposable Compose project, verifies
write, deduplication, and replay readback, then removes its own container,
network, and volume. It uses the same loopback port, so stop a separately
running Visualizer PostgreSQL sidecar before that test.
