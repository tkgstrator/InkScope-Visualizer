export type StagePoint = {
  name: string
  kind: "player" | "bank"
  color: string
  x: number
  y: number
  z: number
  yawDeg?: number
  source: "simulated" | "documented static candidate"
}

// Viewer convention: X and Z are horizontal, Y is height. Player poses are demo values.
export function stagePoints(tick: number): StagePoint[] {
  return [
    { name: "P1 · SERVER", kind: "player", color: "#63acff", x: -18 + Math.sin(tick / 5) * 8, y: 10.2, z: -12 + Math.cos(tick / 5) * 5, yawDeg: 30 + tick * 4, source: "simulated" },
    { name: "P2 · CLIENT", kind: "player", color: "#6af6cd", x: 19 + Math.cos(tick / 6) * 7, y: 11.4, z: 7 + Math.sin(tick / 6) * 9, yawDeg: 120 - tick * 3, source: "simulated" },
    { name: "P3", kind: "player", color: "#eaff3e", x: -4 + Math.sin(tick / 7) * 12, y: 8.5, z: 27, yawDeg: 240 + tick * 2, source: "simulated" },
    { name: "P4", kind: "player", color: "#f02d7d", x: 24, y: 12.1, z: -25 + Math.cos(tick / 8) * 12, yawDeg: 300 - tick * 2, source: "simulated" },
    { name: "BANK · Cmn", kind: "bank", color: "#e5e5e5", x: 2.5, y: 9, z: 40, source: "documented static candidate" },
  ]
}
