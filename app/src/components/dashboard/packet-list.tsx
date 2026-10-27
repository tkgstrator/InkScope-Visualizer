import type { Ref } from "react"
import { Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Packet } from "@/demo-data"

export type Filter = "all" | "authenticated" | "failed"

export function StatusBadge({ status }: { status: Packet["status"] }) {
  const label = status === "authentication_failed" ? "FAILED" : status === "proof_verified" ? "PROOF" : status === "authenticated" ? "AUTH" : status.replaceAll("_", " ").toUpperCase()
  const variant = status.includes("fail") || status === "malformed" ? "destructive" : status === "authenticated" || status === "proof_verified" ? "secondary" : "outline"
  return <Badge variant={variant} className="rounded-sm font-mono text-xs">{label}</Badge>
}

export function PacketTable({ packets, selectedId, onSelect }: {
  packets: Packet[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="overflow-auto">
      <Table className="min-w-[610px] font-mono text-xs">
        <TableHeader className="sticky top-0 bg-card">
          <TableRow>
            <TableHead className="w-16">#</TableHead>
            <TableHead className="w-20">TIME</TableHead>
            <TableHead className="w-18">FLOW</TableHead>
            <TableHead>PROTOCOL / TYPE</TableHead>
            <TableHead className="w-23">STATUS</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {packets.length === 0 && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No matching packets</TableCell></TableRow>}
          {packets.map((packet) => (
            <TableRow
              key={packet.id}
              tabIndex={0}
              aria-selected={packet.id === selectedId}
              className={`cursor-pointer focus-visible:outline-2 focus-visible:outline-ring ${packet.id === selectedId ? "bg-muted" : ""}`}
              onClick={() => onSelect(packet.id)}
              onKeyDown={(event) => { if (event.key === "Enter") onSelect(packet.id) }}
            >
              <TableCell className="text-muted-foreground">{packet.id}</TableCell>
              <TableCell>{packet.time}</TableCell>
              <TableCell>{packet.flow}</TableCell>
              <TableCell><span className="font-semibold">{packet.protocol}</span><span className="ml-2 text-muted-foreground">{packet.kind}</span></TableCell>
              <TableCell><StatusBadge status={packet.status} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function FilterBar({ search, onSearch, filter, onFilter, count, inputRef }: {
  search: string
  onSearch: (value: string) => void
  filter: Filter
  onFilter: (value: Filter) => void
  count: number
  inputRef: Ref<HTMLInputElement>
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b p-3">
      <div className="relative min-w-48 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input ref={inputRef} aria-label="Search packets" className="h-8 rounded-sm pl-8 text-xs" placeholder="Protocol, IP, status..." value={search} onChange={(event) => onSearch(event.target.value)} />
      </div>
      <Select value={filter} onValueChange={(value) => onFilter(value as Filter)}>
        <SelectTrigger className="w-36 rounded-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All packets</SelectItem>
          <SelectItem value="authenticated">Authenticated</SelectItem>
          <SelectItem value="failed">Failures</SelectItem>
        </SelectContent>
      </Select>
      <span className="font-mono text-xs text-muted-foreground">{count} shown</span>
    </div>
  )
}
