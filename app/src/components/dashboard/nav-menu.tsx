import { Activity, Binary, Database, Eye, MapPinned, Radio, Settings2 } from "lucide-react"
import { TabsList, TabsTrigger } from "@/components/ui/tabs"

const items = [
  { value: "overview", label: "Overview", icon: Activity, shortcut: "1" },
  { value: "debug", label: "Debug", icon: Eye, shortcut: "2" },
  { value: "raw", label: "Raw HEX", icon: Binary, shortcut: "3" },
  { value: "map", label: "3D Map", icon: MapPinned, shortcut: "4" },
  { value: "replay", label: "Replay", icon: Database, shortcut: "5" },
  { value: "obs", label: "OBS", icon: Radio, shortcut: "6" },
  { value: "settings", label: "Settings", icon: Settings2, shortcut: "7" },
] as const

export function NavMenu() {
  return (
    <aside className="flex h-full min-h-0 flex-col border-r bg-sidebar px-2 py-3 max-xl:h-auto max-xl:border-b max-xl:border-r-0" aria-label="Views">
      <div className="hidden px-2 pb-3 pt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground max-xl:block max-sm:hidden">Workspace</div>
      <TabsList variant="line" className="flex h-auto w-full flex-col items-stretch gap-1 p-0 max-xl:flex-row max-xl:overflow-x-auto max-sm:justify-between max-sm:gap-0 max-sm:overflow-visible" aria-label="Visualizer views">
        {items.map(({ value, label, icon: Icon, shortcut }) => (
          <TabsTrigger key={value} value={value} aria-label={label} aria-keyshortcuts={shortcut} className="relative h-10 w-full flex-none justify-center gap-3 rounded-sm px-0 text-xs after:hidden max-xl:w-auto max-xl:justify-start max-xl:px-3 max-sm:w-[calc(100%/7)] max-sm:justify-center max-sm:px-0" title={`${label} (${shortcut})`}>
            <Icon className="size-4" />
            <span className="hidden max-xl:block max-xl:flex-1 max-xl:text-left max-sm:hidden">{label}</span>
            <span className="hidden font-mono text-xs text-muted-foreground max-xl:block max-sm:hidden">{shortcut}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </aside>
  )
}
