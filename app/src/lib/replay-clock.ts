type CapturedEvent = { timestamp_ns: string }

/** Milliseconds on the capture clock, relative to the first replayed event. */
export function replayOffsetsMs(events: readonly CapturedEvent[]): number[] {
  if (events.length === 0) return []
  const origin = BigInt(events[0]!.timestamp_ns)
  return events.reduce<number[]>((offsets, event) => {
    const offset = Number(BigInt(event.timestamp_ns) - origin) / 1_000_000
    offsets.push(Math.max(offsets.at(-1) ?? 0, offset))
    return offsets
  }, [])
}

function upperBound(offsets: readonly number[], elapsedMs: number, low: number, high: number): number {
  if (low >= high) return low
  const middle = (low + high) >>> 1
  return offsets[middle]! <= elapsedMs
    ? upperBound(offsets, elapsedMs, middle + 1, high)
    : upperBound(offsets, elapsedMs, low, middle)
}

/** The last captured event at or before the requested replay time. */
export function replayIndexAtMs(offsets: readonly number[], elapsedMs: number): number {
  if (offsets.length === 0) return 0
  return Math.max(0, upperBound(offsets, elapsedMs, 0, offsets.length) - 1)
}
