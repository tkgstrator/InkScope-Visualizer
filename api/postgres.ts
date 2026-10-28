import { SQL } from "bun"
import type { PacketPersistence } from "./live-store"
import { parsePacketEnvelope, type PacketEnvelope } from "./wire"

export type StoredSession = {
  session_id: string
  events: string
  first_timestamp_ns: string
  last_timestamp_ns: string
}

function parseStoredPayload(payload: unknown): PacketEnvelope {
  return parsePacketEnvelope(typeof payload === "string" ? payload : JSON.stringify(payload))
}

function storedSession(row: Record<string, unknown>): StoredSession {
  return {
    session_id: String(row.session_id),
    events: String(row.events),
    first_timestamp_ns: String(row.first_timestamp_ns),
    last_timestamp_ns: String(row.last_timestamp_ns),
  }
}

export class PostgresPersistence implements PacketPersistence {
  constructor(private readonly sql: SQL) {}

  async lastRecord(sessionId: string): Promise<string | null> {
    const rows = await this.sql`
      SELECT MAX(record)::text AS record
      FROM inkscope_packet_events
      WHERE session_id = ${sessionId}::uuid
    `
    return (rows[0]?.record as string | null) ?? null
  }

  async save(event: PacketEnvelope): Promise<boolean> {
    const json = JSON.stringify(event)
    const rows = await this.sql`
      INSERT INTO inkscope_packet_events (session_id, record, timestamp_ns, payload)
      VALUES (${event.session_id}::uuid, ${event.record}::numeric, ${event.timestamp_ns}::numeric, ${json}::jsonb)
      ON CONFLICT (session_id, record) DO NOTHING
      RETURNING record::text AS record
    `
    return rows.length === 1
  }

  async listSessions(): Promise<StoredSession[]> {
    const rows = await this.sql`
      SELECT session_id::text AS session_id,
             COUNT(*)::text AS events,
             MIN(timestamp_ns)::text AS first_timestamp_ns,
             MAX(timestamp_ns)::text AS last_timestamp_ns
      FROM inkscope_packet_events
      GROUP BY session_id
      ORDER BY MAX(received_at) DESC
      LIMIT 100
    `
    return (rows as Array<Record<string, unknown>>).map(storedSession)
  }

  async sessionSummary(sessionId: string): Promise<StoredSession | null> {
    const rows = await this.sql`
      SELECT session_id::text AS session_id,
             COUNT(*)::text AS events,
             MIN(timestamp_ns)::text AS first_timestamp_ns,
             MAX(timestamp_ns)::text AS last_timestamp_ns
      FROM inkscope_packet_events
      WHERE session_id = ${sessionId}::uuid
      GROUP BY session_id
    `
    const row = (rows as Array<Record<string, unknown>>)[0]
    return row ? storedSession(row) : null
  }

  async readEvents(sessionId: string, afterRecord: string | null, limit: number): Promise<PacketEnvelope[]> {
    const rows = afterRecord === null
      ? await this.sql`
        SELECT payload FROM inkscope_packet_events
        WHERE session_id = ${sessionId}::uuid
        ORDER BY record ASC LIMIT ${limit}
      `
      : await this.sql`
        SELECT payload FROM inkscope_packet_events
        WHERE session_id = ${sessionId}::uuid AND record > ${afterRecord}::numeric
        ORDER BY record ASC LIMIT ${limit}
      `
    return (rows as Array<{ payload: unknown }>).map((row) => parseStoredPayload(row.payload))
  }

  async countEventsThrough(sessionId: string, afterRecord: string): Promise<number> {
    const rows = await this.sql`
      SELECT COUNT(*)::text AS events
      FROM inkscope_packet_events
      WHERE session_id = ${sessionId}::uuid AND record <= ${afterRecord}::numeric
    `
    const count = String(rows[0]?.events ?? "")
    if (!/^(0|[1-9][0-9]*)$/.test(count) || BigInt(count) > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Invalid saved event count")
    }
    return Number(count)
  }

  async recent(limit: number): Promise<PacketEnvelope[]> {
    const rows = await this.sql`
      SELECT payload FROM inkscope_packet_events
      ORDER BY received_at DESC, session_id DESC, record DESC
      LIMIT ${limit}
    `
    return (rows as Array<{ payload: unknown }>).reverse().map((row) => parseStoredPayload(row.payload))
  }

  async close(): Promise<void> {
    await this.sql.close()
  }
}

export async function openPostgresPersistence(url: string): Promise<PostgresPersistence> {
  if (!/^postgres(?:ql)?:\/\//.test(url)) throw new Error("DATABASE_URL must use postgres:// or postgresql://")
  let sql: SQL | undefined
  try {
    sql = new SQL(url)
    await sql`SELECT 1`
    await sql`
      CREATE TABLE IF NOT EXISTS inkscope_packet_events (
        session_id UUID NOT NULL,
        record NUMERIC(20,0) NOT NULL,
        timestamp_ns NUMERIC(20,0) NOT NULL,
        payload JSONB NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (session_id, record),
        CHECK (record >= 0 AND record <= 18446744073709551615),
        CHECK (timestamp_ns >= 0 AND timestamp_ns <= 18446744073709551615)
      )
    `
    await sql`
      CREATE INDEX IF NOT EXISTS inkscope_packet_events_time_idx
      ON inkscope_packet_events (timestamp_ns, session_id, record)
    `
    return new PostgresPersistence(sql)
  } catch (error) {
    await sql?.close().catch(() => undefined)
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown"
    throw new Error(`PostgreSQL sidecar setup failed (${code}); check DATABASE_URL and service health`)
  }
}
