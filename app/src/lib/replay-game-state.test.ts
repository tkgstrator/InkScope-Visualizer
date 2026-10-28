import { describe, expect, it } from "bun:test"
import { samplePacket } from "../../../api/test-fixture"
import type { PacketEnvelope, WireRow } from "../../../api/wire"
import {
  buildReplayGameTimeline, replayActiveSpawns, replayGameSnapshotAt, replayRemainingSecondsAt,
} from "./replay-game-state"

const baseTime = 1_792_939_600_000_000_000n

function packet(record: number, offsetMs: number, rows: WireRow[]): PacketEnvelope {
  return {
    ...samplePacket(String(record)),
    timestamp_ns: String(baseTime + BigInt(offsetMs) * 1_000_000n),
    rows,
  }
}

function row(kind: string, fields: Record<string, string>, status = "authenticated"): WireRow {
  return {
    kind, status,
    fields: Object.entries(fields).map(([name, value]) => ({ name, value })),
  }
}

describe("capture-backed replay game state", () => {
  it("estimates a 100-second countdown from authenticated gameplay frames across two waves", () => {
    const timeline = buildReplayGameTimeline([
      packet(28833, 0, [row("OnlineCoopSetting", { StageResource: "Cop_Shakedent", GameFrame: "139296" })]),
      packet(29060, 10_028, [row("CoopSequenceNetState", { Sequence: "0", Quota: "4" })]),
      packet(29726, 32_470, [row("CoopEnemySpawnNetEvent", { GameFrame: "1358" })]),
      packet(32657, 131_479, [row("CoopEnemySpawnNetEvent", { GameFrame: "7299" })]),
      packet(32813, 136_797, [row("CoopSequenceNetState", { Sequence: "1", Quota: "4" })]),
      packet(33261, 151_815, [row("CoopEnemySpawnNetEvent", { GameFrame: "8517" })]),
      packet(36214, 251_482, [row("CoopItemResponseGetByEnemyEvent", { GameFrame: "14499" })]),
    ])
    expect(replayGameSnapshotAt(timeline, 0).remainingSeconds).toBeNull()
    expect(replayGameSnapshotAt(timeline, 1).remainingSeconds).toBeNull()
    expect(replayGameSnapshotAt(timeline, 2)).toMatchObject({
      remainingSeconds: 100, remainingSecondsEstimated: true, wave: null,
    })
    expect(replayGameSnapshotAt(timeline, 3).remainingSeconds).toBe(1)
    expect(replayGameSnapshotAt(timeline, 4).remainingSeconds).toBeNull()
    expect(replayGameSnapshotAt(timeline, 5).remainingSeconds).toBe(100)
    expect(replayGameSnapshotAt(timeline, 6).remainingSeconds).toBe(1)
  })

  it("does not derive a countdown from unauthenticated, malformed, or mismatched frames", () => {
    const timeline = buildReplayGameTimeline([
      packet(1, 0, [row("CoopSequenceNetState", { Sequence: "0", Wave: "1" })]),
      packet(2, 100, [row("OnlineCoopSetting", { GameFrame: "139296" })]),
      packet(3, 200, [row("CoopEnemySpawnNetEvent", { GameFrame: "1358" }, "authentication_failed")]),
      packet(4, 300, [row("CoopEnemySpawnNetEvent", { GameFrame: "NaN" })]),
      packet(5, 400, [row("CoopEnemySpawnNetEvent", { GameFrame: "139296" })]),
      packet(6, 500, [row("CoopEnemySpawnNetEvent", { GameFrame: "1358" })]),
      packet(7, 600, [row("CoopSequenceNetState", { Sequence: "1" })]),
      packet(8, 700, [row("CoopEnemySpawnNetEvent", { GameFrame: "8517" })]),
    ])
    for (const index of [0, 1, 2, 3, 4, 6]) {
      expect(replayGameSnapshotAt(timeline, index).remainingSeconds).toBeNull()
      expect(replayGameSnapshotAt(timeline, index).remainingSecondsEstimated).toBe(false)
    }
    expect(replayGameSnapshotAt(timeline, 5)).toMatchObject({
      remainingSeconds: 100, remainingSecondsEstimated: true, wave: "1",
    })
    expect(replayGameSnapshotAt(timeline, 7)).toMatchObject({
      remainingSeconds: 100, wave: "1",
    })
  })

  it("interpolates from the latest frame at the playhead and stops after the wave", () => {
    const timeline = buildReplayGameTimeline([
      packet(1, 0, [row("CoopSequenceNetState", { Sequence: "0" })]),
      packet(2, 1_000, [row("CoopEnemySpawnNetEvent", { GameFrame: "1358" })]),
      packet(3, 10_000, [row("CoopSequenceNetState", { Sequence: "0" })]),
    ])
    expect(replayRemainingSecondsAt(timeline, 1, String(baseTime + 11_000_000_000n))).toBe(90)
    expect(replayRemainingSecondsAt(timeline, 2, String(baseTime + 10_000_000_000n))).toBe(91)
    expect(replayRemainingSecondsAt(timeline, 0, String(baseTime + 11_000_000_000n))).toBeNull()
    expect(replayRemainingSecondsAt(timeline, 1, String(baseTime + 999_000_000n))).toBeNull()
    expect(replayRemainingSecondsAt(timeline, 1, "invalid")).toBeNull()
    expect(replayRemainingSecondsAt(timeline, 1, String(baseTime + 102_000_000_000n))).toBeNull()
  })

  it("keeps the countdown moving forward when a delayed packet has an older GameFrame", () => {
    const timeline = buildReplayGameTimeline([
      packet(1, 0, [row("CoopSequenceNetState", { Sequence: "0" })]),
      packet(2, 1_000, [row("CoopEnemySpawnNetEvent", { GameFrame: "1500" })]),
      packet(3, 2_000, [row("CoopEnemySpawnNetEvent", { GameFrame: "1400" })]),
    ])
    expect(replayGameSnapshotAt(timeline, 1).remainingSeconds).toBe(97)
    expect(replayGameSnapshotAt(timeline, 2).remainingSeconds).toBe(96)
    expect(replayRemainingSecondsAt(timeline, 2, String(baseTime + 2_500_000_000n))).toBe(96)
  })

  it("keeps playhead values separate from the remembered session stage", () => {
    const events = [
      packet(1, 0, [row("OnlineCoopSetting", {
        StageResource: "Cop_Shakedent", StageName: "Gone Fission Hydroplant",
        Difficulty: "150", JobType: "1",
      })]),
      packet(2, 500, [row("CoopSequenceNetState", { Quota: "4", Sequence: "0" })]),
      packet(3, 1_000, [row("CoopSequenceNetState", { Sequence: "1" })]),
      packet(4, 1_500, [row("PrivateSetting", { StageId: "" })]),
    ]
    const timeline = buildReplayGameTimeline(events)
    expect(replayGameSnapshotAt(timeline, -1).stageId).toBeNull()
    expect(replayGameSnapshotAt(timeline, 0)).toMatchObject({
      stageId: "Cop_Shakedent", sessionStageId: "Cop_Shakedent",
      stageName: "Gone Fission Hydroplant", difficulty: "150", quota: null,
      wave: null, tide: null,
    })
    expect(replayGameSnapshotAt(timeline, 1)).toMatchObject({ quota: "4", sequence: "0" })
    expect(replayGameSnapshotAt(timeline, 2)).toMatchObject({ quota: "4", sequence: "1" })
    expect(replayGameSnapshotAt(timeline, 3)).toMatchObject({
      stageId: null, sessionStageId: "Cop_Shakedent", quota: "4", sequence: "1",
    })
    expect(replayGameSnapshotAt(timeline, 1).sequence).toBe("0")
  })

  it("follows later stage changes and clears a name that belongs to the old stage", () => {
    const timeline = buildReplayGameTimeline([
      packet(1, 0, [row("OnlineCoopSetting", {
        StageResource: "Cop_Shakedent", StageName: "Gone Fission Hydroplant",
      })]),
      packet(2, 100, [row("OnlineCoopSetting", { StageResource: "Cop_Banc" })]),
      packet(3, 200, [row("PrivateSetting", { StageId: "Cop_Unknown" })]),
      packet(4, 300, [row("PrivateSetting", { StageId: "" })]),
    ])
    expect(replayGameSnapshotAt(timeline, 1)).toMatchObject({
      stageId: "Cop_Banc", sessionStageId: "Cop_Banc", stageName: null,
    })
    expect(replayGameSnapshotAt(timeline, 2)).toMatchObject({
      stageId: "Cop_Unknown", sessionStageId: "Cop_Unknown", stageName: null,
    })
    expect(replayGameSnapshotAt(timeline, 3)).toMatchObject({
      stageId: null, sessionStageId: "Cop_Unknown", stageName: null,
    })
  })

  it("pulses authenticated enemy and item spawns by capture time and supports backward seeks", () => {
    const timeline = buildReplayGameTimeline([
      packet(1, 0, [row("OnlineCoopSetting", { StageResource: "Cop_Shakedent" })]),
      packet(2, 100, [row("CoopEnemySpawnNetEvent", {
        SpawnX: "2.227", SpawnY: "27.700", SpawnZ: "-19.246", SalmonType: "SakeCopter",
      })]),
      packet(3, 1_000, [row("CoopItemSpawnEvent", {
        SpawnX: "16.348", SpawnY: "4.496", SpawnZ: "13.383",
      })]),
    ])
    expect(timeline.spawns).toEqual([
      { record: "2", stageId: "Cop_Shakedent", kind: "enemy", actor: "SakeCopter", position: [2.227, 27.7, -19.246],
        timestampNs: String(baseTime + 100_000_000n) },
      { record: "3", stageId: "Cop_Shakedent", kind: "item", actor: "Item spawn", position: [16.348, 4.496, 13.383],
        timestampNs: String(baseTime + 1_000_000_000n) },
    ])
    expect(replayGameSnapshotAt(timeline, 2)).toMatchObject({
      enemySpawnCount: 1, itemSpawnCount: 1, latestSpawn: timeline.spawns[1],
    })
    expect(replayActiveSpawns(timeline, String(baseTime + 50_000_000n))).toEqual([])
    expect(replayActiveSpawns(timeline, String(baseTime + 100_000_000n))).toEqual([timeline.spawns[0]!])
    expect(replayActiveSpawns(timeline, String(baseTime + 8_100_000_000n))).toEqual(timeline.spawns)
    expect(replayActiveSpawns(timeline, String(baseTime + 8_101_000_000n))).toEqual([timeline.spawns[1]!])
    expect(replayActiveSpawns(timeline, String(baseTime + 100_000_000n))).toEqual([timeline.spawns[0]!])
  })

  it("does not project a recent spawn onto a later stage", () => {
    const timeline = buildReplayGameTimeline([
      packet(1, 0, [row("OnlineCoopSetting", { StageResource: "Cop_Shakedent" })]),
      packet(2, 1_000, [row("CoopEnemySpawnNetEvent", {
        SpawnX: "2", SpawnY: "3", SpawnZ: "4", SalmonType: "SakeCopter",
      })]),
      packet(3, 2_000, [row("OnlineCoopSetting", { StageResource: "Cop_Banc" })]),
    ])
    const playhead = String(baseTime + 2_000_000_000n)
    expect(replayActiveSpawns(timeline, playhead, 8_000, "Cop_Shakedent")).toEqual([timeline.spawns[0]!])
    expect(replayActiveSpawns(timeline, playhead, 8_000, "Cop_Banc")).toEqual([])
  })

  it("ignores unauthenticated and invalid spawn coordinates", () => {
    const timeline = buildReplayGameTimeline([
      packet(1, 0, [row("CoopEnemySpawnNetEvent", {
        SpawnX: "1", SpawnY: "2", SpawnZ: "3", SalmonType: "SakelienTower",
      }, "authentication_failed")]),
      packet(2, 1, [row("CoopEnemySpawnNetEvent", {
        SpawnX: "Infinity", SpawnY: "2", SpawnZ: "3",
      })]),
      packet(3, 2, [row("CoopItemSpawnEvent", {
        SpawnX: "1", SpawnY: "2", SpawnZ: "not-a-number",
      })]),
      packet(4, 3, [row("CoopItemSpawnEvent", {
        SpawnX: "-1", SpawnY: "5.996", SpawnZ: "21.496",
      })]),
    ])
    expect(timeline.spawns).toHaveLength(1)
    expect(timeline.spawns[0]).toMatchObject({
      record: "4", kind: "item", position: [-1, 5.996, 21.496],
    })
    expect(replayGameSnapshotAt(timeline, 0).enemySpawnCount).toBe(0)
    expect(replayGameSnapshotAt(timeline, 3).itemSpawnCount).toBe(1)
  })

  it("keeps endpoint labels until host proof arrives and then exposes verified peers", () => {
    const first = packet(1, 0, [row("RTTProtocol", {
      Type: "1", CaptureResponseDelayMs: "31.250",
    })])
    const second = packet(2, 100, [
      row("BrowseReply", { HostIPv4: first.packet.source_ip }, "proof_verified"),
      row("RTTProtocol", { Type: "1", CaptureResponseDelayMs: "32.500" }),
    ])
    const timeline = buildReplayGameTimeline([first, second])
    expect(replayGameSnapshotAt(timeline, 0)).toMatchObject({
      host: null, source: first.packet.source_ip,
      destination: first.packet.destination_ip, pairDelay: "31.250",
    })
    expect(replayGameSnapshotAt(timeline, 1)).toMatchObject({
      host: first.packet.source_ip,
      clients: [{ ip: first.packet.destination_ip, delay: "32.500" }],
    })
  })
})
