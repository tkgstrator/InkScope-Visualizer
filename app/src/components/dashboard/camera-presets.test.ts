/// <reference types="bun" />
import { describe, expect, it } from "bun:test"
import { axisPose, characterPose, quarterTurn, type AxisView, type Vec3 } from "./camera-presets"
import { stagePoints } from "./stage-data"

describe("viewer camera poses", () => {
  it("keeps every axis view's up vector perpendicular to its sight line", () => {
    for (const view of ["+X", "-X", "+Y", "-Y", "+Z", "-Z"] as AxisView[]) {
      const { position, up } = axisPose(view, [1, 2, 3], 20)
      const towardTarget: Vec3 = [1 - position[0], 2 - position[1], 3 - position[2]]
      const dot = towardTarget[0] * up[0] + towardTarget[1] * up[1] + towardTarget[2] * up[2]
      expect(Math.abs(dot)).toBeLessThan(0.00001)
    }
  })

  it("returns to the same camera pose after four quarter turns", () => {
    const target: Vec3 = [0, 10, 0]
    for (const view of ["+X", "+Y", "+Z"] as AxisView[]) {
      let pose = axisPose(view, target, 50)
      for (let i = 0; i < 4; i++) pose = quarterTurn(pose.position, target, pose.up, 1)
      const initial = axisPose(view, target, 50)
      for (let i = 0; i < 3; i++) {
        expect(pose.position[i]!).toBeCloseTo(initial.position[i]!, 8)
        expect(pose.up[i]!).toBeCloseTo(initial.up[i]!, 8)
      }
    }
  })

  it("builds a simulated character eye pose from its yaw", () => {
    const point = { ...stagePoints(0)[0]!, x: 2, y: 5, z: 7, yawDeg: 90 }
    const pose = characterPose(point)
    expect(pose.position).toEqual([2, 6.6, 7])
    expect(pose.target[0]).toBeCloseTo(14)
    expect(pose.target[2]).toBeCloseTo(7)
  })
})
