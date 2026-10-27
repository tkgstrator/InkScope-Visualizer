import type { Ref } from "react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { FlatCard } from "@/components/dashboard/flat-card"
import { FilterBar, PacketTable, StatusBadge, type Filter } from "@/components/dashboard/packet-list"
import type { Packet } from "@/demo-data"

export type DebugViewProps = {
  packets: Packet[]
  selected: Packet | undefined
  selectedId: string
  onSelectPacket: (id: string) => void
  search: string
  onSearch: (value: string) => void
  filter: Filter
  onFilter: (value: Filter) => void
  inputRef: Ref<HTMLInputElement>
  source: "demo" | "live" | "replay"
}

export function DebugView({
  packets, selected, selectedId, onSelectPacket, search, onSearch, filter, onFilter, inputRef, source,
}: DebugViewProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Decoded packet view</h3>
        </div>
        <Badge variant="outline" className="rounded-sm">{source.toUpperCase()}</Badge>
      </div>
      <div className="grid gap-3 2xl:grid-cols-[minmax(0,1.35fr)_minmax(290px,.65fr)]">
        <Card className="min-w-0 gap-0 overflow-hidden rounded-md border py-0 shadow-none ring-0">
          <FilterBar search={search} onSearch={onSearch} filter={filter} onFilter={onFilter} count={packets.length} inputRef={inputRef} />
          <ScrollArea className="h-[560px]">
            <PacketTable packets={packets} selectedId={selectedId} onSelect={onSelectPacket} />
          </ScrollArea>
        </Card>
        <FlatCard title={selected ? `#${selected.id} · ${selected.kind}` : "Select a packet"} meta="PARSED FIELDS" className="min-w-0">
          {selected && <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-muted-foreground">{selected.protocol}</span>
              <StatusBadge status={selected.status} />
            </div>
            <div className="space-y-2 font-mono text-xs">
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Source</span><span className="break-all text-right">{selected.source}</span></div>
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Destination</span><span className="break-all text-right">{selected.destination}</span></div>
              <Separator />
              {selected.fields.map(([name, value]) => <div key={name} className="flex justify-between gap-3"><span className="text-muted-foreground">{name}</span><span className="break-all text-right">{value}</span></div>)}
            </div>
          </>}
        </FlatCard>
      </div>
    </div>
  )
}
