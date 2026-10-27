export const markerLegend = [
  { kind: "start", label: "StartPos", color: "#a64cf2" },
  { kind: "bank", label: "IkuraBank", color: "#f0ffff" },
  { kind: "enemy", label: "Generic enemy point", color: "#ff9650" },
  { kind: "water", label: "Water level", color: "#63acff" },
  { kind: "bankBase", label: "Bank base", color: "#717985" },
  { kind: "helicopter", label: "Helicopter center", color: "#eaff3e" },
  { kind: "geyser", label: "Geyser", color: "#6af6cd" },
  { kind: "towerArrival", label: "Tower arrival", color: "#ff575c" },
  { kind: "artilleryGun", label: "Artillery gun", color: "#fdd400" },
  { kind: "jumpRoute", label: "Jump route", color: "#9aa8ff" },
] as const

export type MarkerKind = (typeof markerLegend)[number]["kind"]

export function markerKind(actor: string): MarkerKind | null {
  if (actor.startsWith("StartPos")) return "start"
  if (actor === "CoopIkuraBank") return "bank"
  if (actor === "CoopIkuraBankBase") return "bankBase"
  if (actor.startsWith("CoopSpawnPointEnemy")) return "enemy"
  if (actor === "CoopWaterLevelLocator") return "water"
  if (actor === "CoopSpawnGeyser") return "geyser"
  if (actor.startsWith("CoopArrivalPointEnemyTower")) return "towerArrival"
  if (actor.startsWith("CoopSakeArtilleryGunPoint")) return "artilleryGun"
  if (actor === "CoopSakerocketJumpPoint") return "jumpRoute"
  if (actor === "CoopHelicopterCenterPoint") return "helicopter"
  return null
}

export function markerColor(actor: string): string {
  const kind = markerKind(actor)
  return markerLegend.find((item) => item.kind === kind)?.color ?? "#89949f"
}
