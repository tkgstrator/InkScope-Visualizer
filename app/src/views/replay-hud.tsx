import { useEffect, useState } from "react"
import { Egg } from "lucide-react"
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

function useAssetReady(url: string): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const image = new Image()
    image.onload = () => setReady(true)
    image.onerror = () => setReady(false)
    image.src = url
    return () => {
      image.onload = null
      image.onerror = null
    }
  }, [url])
  return ready
}

function GoldEggEmblem() {
  const [source, setSource] = useState<"romfs" | "web" | "fallback">("romfs")
  return <span className="absolute left-[143px] top-[13px] flex size-6 items-center justify-center rounded-full bg-[#e7f92a] shadow-[0_0_0_2px_#171717,0_1px_3px_#000]" aria-hidden="true">
    {source === "fallback" ? <Egg className="size-[17px] text-[#172014]" strokeWidth={3} /> :
      <img src={source === "romfs" ? "/local-game-assets/romfs-coop-egg.png" : "/local-game-assets/gold-ikura.svg"} className="size-6 object-contain" alt="" onError={() => setSource(source === "romfs" ? "web" : "fallback")} />}
  </span>
}

function PlayerSlot({ number, romfsReady }: { number: number; romfsReady: boolean }) {
  return <div className="relative h-[53px] w-[40px] opacity-55" aria-label={`Player slot ${number}; participant and weapon unknown`}>
    {romfsReady ? <span className="replay-hud-romfs-squid absolute inset-x-0 top-0 h-[43px] w-[40px]" aria-hidden="true" /> :
      <svg className="absolute inset-x-0 top-0 h-[43px] w-[40px] drop-shadow-[0_1px_2px_#000]" viewBox="0 0 40 43" aria-hidden="true">
      <path d="M20 1.5C17.7 1.5 16.1 3.2 14.6 5.9L3.1 24.5C1.6 27.3 4.3 30.2 8.2 30.1L8 37.2C8 40.3 10.9 41.2 13 39.2L15.4 35.7C16.5 38.7 17.8 41 20 41C22.2 41 23.5 38.7 24.6 35.7L27 39.2C29.1 41.2 32 40.3 32 37.2L31.8 30.1C35.7 30.2 38.4 27.3 36.9 24.5L25.4 5.9C23.9 3.2 22.3 1.5 20 1.5Z" fill="#ee5139" stroke="#ff8b62" strokeWidth="1.2" />
      <path d="M6.5 27.7C12 29.7 28 29.7 33.5 27.7" fill="none" stroke="#ffb285" strokeOpacity=".7" strokeWidth="1.2" />
    </svg>}
  </div>
}

export function ReplayHud({ hud, mapStage, remainingSeconds, keyStatus, persistence }: ReplayHudProps) {
  const timerTextureReady = useAssetReady("/local-game-assets/romfs-coop-timer.png")
  const mainTapeReady = useAssetReady("/local-game-assets/romfs-coop-tape-main.png")
  const lowerTapeReady = useAssetReady("/local-game-assets/romfs-coop-tape-lower.png")
  const tapeLeftReady = useAssetReady("/local-game-assets/romfs-coop-tape-left.png")
  const mainRightReady = useAssetReady("/local-game-assets/romfs-coop-tape-main-right.png")
  const lowerRightReady = useAssetReady("/local-game-assets/romfs-coop-tape-lower-right.png")
  const squidReady = useAssetReady("/local-game-assets/romfs-coop-squid.png")
  return (
    <section className="replay-hud-font pointer-events-none relative -ml-3 w-[320px] max-w-[calc(100%+12px)] text-[#fffaf1] sm:-ml-4 sm:max-w-[calc(100%+16px)]" aria-label="Replay HUD">
      <div className="replay-hud-title-shadow relative h-[27px] text-[20px] leading-none">
        <span className="absolute bottom-[1px] left-12 whitespace-nowrap">Wave <strong className="text-white">{hud.wave ?? "—"}</strong></span>
        <span className="absolute bottom-[1px] left-[190px]">Quota</span>
      </div>
      <div className={`replay-hud-main-band relative h-[50px] w-[310px] max-w-full ${tapeLeftReady && mainRightReady ? "replay-hud-main-band-window-romfs" : ""} ${mainTapeReady ? "replay-hud-main-band-romfs" : ""}`}>
        {timerTextureReady && <span className="replay-hud-timer-texture absolute inset-y-0 left-0 w-[154px]" aria-hidden="true" />}
        {remainingSeconds !== null && hud.remainingSecondsEstimated && <span className="replay-hud-title-shadow absolute left-[47px] top-[20px] text-[12px] text-white/90" aria-hidden="true">≈</span>}
        <strong className="replay-hud-display replay-hud-title-shadow absolute left-[66px] top-[2px] inline-block min-w-12 text-[40px] leading-[46px] tabular-nums text-white" aria-label={remainingSeconds === null ? "Remaining time unavailable" : `${hud.remainingSecondsEstimated ? "Estimated " : ""}remaining time ${remainingSeconds} seconds`}>{remainingSeconds ?? "—"}</strong>
        <GoldEggEmblem />
        <strong className="replay-hud-display replay-hud-title-shadow absolute left-[194px] top-[11px] text-[26px] leading-8 tabular-nums text-white" aria-label="Golden eggs delivered unknown; target unknown">—/—</strong>
      </div>
      <div className={`replay-hud-lower-band relative mt-[3px] h-[55px] w-[270px] max-w-full ${tapeLeftReady && lowerRightReady ? "replay-hud-lower-band-window-romfs" : ""} ${lowerTapeReady ? "replay-hud-lower-band-romfs" : ""}`}>
        <div className="absolute left-[33px] top-[1px] flex gap-[2px]">
          {[1, 2, 3, 4].map((number) => <PlayerSlot key={number} number={number} romfsReady={squidReady} />)}
        </div>
      </div>
      <div className="replay-hud-stage-row mt-[2px] flex h-[20px] w-[270px] max-w-full items-center justify-between gap-2 px-2 text-[11px] leading-none">
        <strong className="min-w-0 truncate" title={mapStage ?? undefined}>{mapStage ?? "STAGE —"}</strong>
        <span className="shrink-0">DIFFICULTY {hud.difficulty ?? "—"}</span>
        <span className="shrink-0">KEY {shortKeyStatus(keyStatus)}</span>
      </div>
      <details className="pointer-events-auto absolute bottom-0 left-[274px] z-30" onKeyDown={(event) => {
        if (event.key === "Escape") event.currentTarget.open = false
      }}>
        <summary className="flex size-8 cursor-pointer list-none items-center justify-center rounded-sm bg-[#1a1b1b]/60 text-base leading-none marker:hidden" aria-label="Replay network details">⋯</summary>
        <div className="absolute right-0 top-9 max-h-40 w-[min(280px,calc(100vw-24px))] overflow-y-auto bg-[#151719]/95 p-2 text-[11px] leading-5 shadow-lg">
          <div>RAW QUOTA {hud.quota ?? "—"}</div>
          <div>ENEMY SPAWN {hud.enemySpawnCount}</div>
          <div>ITEM SPAWN {hud.itemSpawnCount}</div>
          <div>TIDE {hud.tide ?? "—"}</div>
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
