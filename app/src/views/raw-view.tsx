import type { Ref } from "react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FlatCard } from "@/components/dashboard/flat-card"
import { FilterBar, PacketTable, StatusBadge, type Filter } from "@/components/dashboard/packet-list"
import { hexDump, type Packet } from "@/demo-data"

export type RawViewProps = {
  packets: Packet[]
  selected: Packet | undefined
  selectedId: string
  onSelectPacket: (id: string) => void
  search: string
  onSearch: (value: string) => void
  filter: Filter
  onFilter: (value: Filter) => void
  inputRef: Ref<HTMLInputElement>
  source: "demo" | "live" | "replay" | "recorded"
}

function spacedHex(rawHex: string): string {
  return rawHex.replace(/\s+/g, "").match(/.{1,2}/g)?.join(" ") ?? ""
}

export function RawView({
  packets, selected, selectedId, onSelectPacket, search, onSearch, filter, onFilter, inputRef, source,
}: RawViewProps) {
  const rawHex = selected ? spacedHex(selected.rawHex) : ""
  const byteCount = rawHex ? rawHex.split(" ").length : 0

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Raw packet view</h3>
        </div>
        <Badge variant="outline" className="rounded-sm">{source.toUpperCase()} BYTES</Badge>
      </div>
      <div className="grid gap-3 2xl:grid-cols-[minmax(0,1.1fr)_minmax(350px,.9fr)]">
        <Card className="min-w-0 gap-0 overflow-hidden rounded-md border py-0 shadow-none ring-0">
          <FilterBar search={search} onSearch={onSearch} filter={filter} onFilter={onFilter} count={packets.length} inputRef={inputRef} />
          <ScrollArea className="h-[560px]">
            <PacketTable packets={packets} selectedId={selectedId} onSelect={onSelectPacket} />
          </ScrollArea>
        </Card>
        <FlatCard title={selected ? `#${selected.id} · UDP payload` : "Select a packet"} meta={selected ? `${byteCount} BYTES` : "RAW HEX"} className="min-w-0">
          {selected && <>
            <div className="mb-3 flex flex-wrap items-center gap-2 font-mono text-xs">
              <span className="break-all">{selected.source}</span>
              <span className="text-muted-foreground">→</span>
              <span className="break-all">{selected.destination}</span>
              <StatusBadge status={selected.status} />
            </div>
            <pre aria-label="Raw HEX and ASCII" className="overflow-auto border-t py-3 font-mono text-xs leading-6">{rawHex ? hexDump(rawHex) : ""}</pre>
          </>}
        </FlatCard>
      </div>
    </div>
  )
}
