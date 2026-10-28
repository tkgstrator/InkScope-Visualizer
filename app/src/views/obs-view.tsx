import { useEffect, useState } from "react"
import { Check, Copy } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FlatCard } from "@/components/dashboard/flat-card"

export type ObsViewProps = {
  wave: number | null
  source: "demo" | "live" | "replay" | "recorded"
  overlayUrl: string
}

export function ObsView({ wave, source, overlayUrl }: ObsViewProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => setCopied(false), [overlayUrl])

  function copyUrl() {
    void navigator.clipboard.writeText(overlayUrl)
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">OBS Browser Source</h3>
        </div>
        <Badge variant="outline" className="rounded-sm">{source.toUpperCase()}</Badge>
      </div>
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b pb-3 text-xs font-semibold uppercase tracking-wider">
            <span>Overlay preview</span>
            <span className="font-mono font-normal text-muted-foreground">16:9{wave === null ? "" : ` · WAVE ${String(wave).padStart(2, "0")}`}</span>
          </div>
          <div className="aspect-video overflow-hidden bg-[repeating-conic-gradient(#383838_0%_25%,#272727_0%_50%)_50%_/_24px_24px]">
            <iframe title="OBS overlay preview" className="h-full w-full" src={overlayUrl} />
          </div>
        </section>
        <FlatCard title="Local source URL" meta="NO KEYS">
          <div className="break-all border-b pb-3 font-mono text-xs">{overlayUrl}</div>
          <Button variant="outline" className="mt-3 w-full rounded-sm" onClick={copyUrl}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy URL"}
          </Button>
        </FlatCard>
      </div>
    </div>
  )
}
