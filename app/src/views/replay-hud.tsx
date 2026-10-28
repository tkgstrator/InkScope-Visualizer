import type { ReplayGameSnapshot } from "@/lib/replay-game-state"

type ReplayHudProps = {
  hud: ReplayGameSnapshot
  mapStage: string | null
  remainingSeconds: number | null
  keyStatus: string
  persistence: "memory" | "postgres" | null
}

function shortKeyStatus(status: string): string {
  if (status === "CONFIGURED") return "SET"
  if (status === "LOCKED") return "LOCK"
  return status
}

export function ReplayHud({ hud, mapStage, remainingSeconds, keyStatus, persistence }: ReplayHudProps) {
  const indicators = [
    { label: "ENEMY", fullLabel: "ENEMY SPAWN", value: String(hud.enemySpawnCount) },
    { label: "ITEM", fullLabel: "ITEM SPAWN", value: String(hud.itemSpawnCount) },
    { label: "TIDE", fullLabel: "TIDE", value: hud.tide ?? "—" },
    { label: "KEY", fullLabel: "KEY", value: keyStatus, shortValue: shortKeyStatus(keyStatus) },
  ] as const

  return (
    <section className="replay-hud-font pointer-events-none relative w-[min(320px,100%)] text-[#fffaf1] drop-shadow-[0_2px_5px_rgba(0,0,0,.85)]" aria-label="Replay HUD">
      <div className="grid h-[25px] grid-cols-[162px_1fr] items-end pl-7 text-[20px] leading-none tracking-tight">
        <span>Wave <strong className="text-white">{hud.wave ?? "—"}</strong></span>
        <span>Quota</span>
      </div>

      <div className="mt-0.5 grid h-[51px] grid-cols-[162px_1fr] items-center bg-black/90 pl-7 pr-5">
        <div className="flex items-center gap-1.5">
          {remainingSeconds !== null && hud.remainingSecondsEstimated && <span className="text-[15px] text-white/80" aria-hidden="true">≈</span>}
          <strong className="replay-hud-display inline-block min-w-13 text-center text-[40px] leading-none tabular-nums text-white" aria-label={remainingSeconds === null ? "Remaining time unavailable" : `${hud.remainingSecondsEstimated ? "Estimated " : ""}remaining time ${remainingSeconds} seconds`}>
            {remainingSeconds ?? "—"}
          </strong>
        </div>
        <strong className="replay-hud-display text-[26px] leading-none tabular-nums text-white" aria-label={`Quota ${hud.quota ?? "unknown"}`}>{hud.quota ?? "—"}</strong>
      </div>

      <div className="mt-1 flex gap-2 pl-6">
        {indicators.map((indicator) => <div key={indicator.label} className="flex w-[42px] flex-col items-center" aria-label={`${indicator.fullLabel} ${indicator.value}`} title={`${indicator.fullLabel} ${indicator.value}`}>
          <span className={`flex size-[40px] items-center justify-center rounded-full border-2 border-[#ff9d62] text-center text-[16px] leading-none text-white shadow-[0_1px_3px_#000,0_0_0_1px_#481c17] ${indicator.value === "—" ? "bg-[#743f35]" : "bg-[#d94b2c]"} ${("shortValue" in indicator ? indicator.shortValue : indicator.value).length > 4 ? "text-[10px]" : ""}`}>
            {"shortValue" in indicator ? indicator.shortValue : indicator.value}
          </span>
          <span className="mt-0.5 text-[9px] leading-3 tracking-tight text-white">{indicator.label}</span>
        </div>)}
      </div>

      <div className="mt-1 flex h-6 items-center justify-between gap-2 bg-black/75 px-2 text-[11px] leading-none">
        <strong className="min-w-0 truncate" title={mapStage ?? undefined}>{mapStage ?? "STAGE —"}</strong>
        <span className="shrink-0">DIFFICULTY {hud.difficulty ?? "—"}</span>
      </div>

      <details className="pointer-events-auto absolute right-0 top-0 z-30" onKeyDown={(event) => {
        if (event.key === "Escape") event.currentTarget.open = false
      }}>
        <summary className="flex size-9 cursor-pointer list-none items-center justify-center bg-black/75 text-base leading-none marker:hidden" aria-label="Replay network details">⋯</summary>
        <div className="absolute right-0 top-10 max-h-40 w-[min(280px,calc(100vw-24px))] overflow-y-auto bg-[#151719]/95 p-2 text-[11px] leading-5 shadow-lg">
          <div>SEQUENCE {hud.sequence ?? "—"}</div>
          <div>JOB {hud.jobType ?? "—"}</div>
          {hud.host ? <>
            <div className="truncate">SERVER {hud.host}</div>
            {hud.clients.map((client) => <div className="truncate" key={client.ip}>CLIENT {client.ip} {client.delay ? `${client.delay}ms` : "—"}</div>)}
          </> : <>
            <div className="truncate">SOURCE {hud.source ?? "—"}</div>
            <div className="truncate">DEST {hud.destination ?? "—"}</div>
            <div>DELAY {hud.pairDelay ? `${hud.pairDelay}ms` : "—"}</div>
          </>}
          <div>{persistence?.toUpperCase() ?? "CONNECTING"}</div>
        </div>
      </details>
    </section>
  )
}
