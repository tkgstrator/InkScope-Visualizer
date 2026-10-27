import type { StagePoint } from "./stage-data"

export type Vec3 = readonly [number, number, number]
export type AxisView = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z"

const directions: Record<AxisView, Vec3> = {
  "+X": [1, 0, 0], "-X": [-1, 0, 0],
  "+Y": [0, 1, 0], "-Y": [0, -1, 0],
  "+Z": [0, 0, 1], "-Z": [0, 0, -1],
}

export function axisPose(view: AxisView, target: Vec3, distance: number): { position: Vec3; up: Vec3 } {
  const [x, y, z] = directions[view]
  return {
    position: [target[0] + x * distance, target[1] + y * distance, target[2] + z * distance],
    up: view === "+Y" ? [0, 0, 1] : view === "-Y" ? [0, 0, -1] : [0, 1, 0],
  }
}

export function spectatorPose(target: Vec3, distance: number): { position: Vec3; up: Vec3 } {
  return {
    position: [target[0] + distance * 0.45, target[1] + distance * 0.77, target[2] + distance * 0.45],
    up: [0, 1, 0],
  }
}

export function quarterTurn(position: Vec3, target: Vec3, up: Vec3, direction: -1 | 1): { position: Vec3; up: Vec3 } {
  const angle = direction * Math.PI / 2
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = position[0] - target[0]
  const dy = position[1] - target[1]
  const dz = position[2] - target[2]
  if (Math.hypot(dx, dz) < 0.0001) {
    return { position, up: [up[0] * cos + up[2] * sin, up[1], -up[0] * sin + up[2] * cos] }
  }
  return {
    position: [target[0] + dx * cos + dz * sin, target[1] + dy, target[2] - dx * sin + dz * cos],
    up,
  }
}

export function characterPose(point: StagePoint): { position: Vec3; target: Vec3 } {
  const yaw = (point.yawDeg ?? 0) * Math.PI / 180
  const position: Vec3 = [point.x, point.y + 1.6, point.z]
  return { position, target: [position[0] + Math.sin(yaw) * 12, position[1], position[2] + Math.cos(yaw) * 12] }
}
