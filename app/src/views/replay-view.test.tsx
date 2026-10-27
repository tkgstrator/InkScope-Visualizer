import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { samplePacket } from "../../../api/test-fixture"
import { ReplayView } from "./replay-view"

test("saved replay shows the bounded record and capture-time range plus page boundary", () => {
  const first = { ...samplePacket("101"), timestamp_ns: "1793059201123456789" }
  const last = samplePacket("102")
  const html = renderToStaticMarkup(
    <ReplayView
      source="live"
      persistence="postgres"
      sessions={[{ session_id: first.session_id, events: "250", first_timestamp_ns: first.timestamp_ns, last_timestamp_ns: last.timestamp_ns }]}
      selectedSessionId={first.session_id}
      selectedEvents={[first, last]}
      loading={false}
      error={null}
      hasMore
      hasPrevious
      pageNumber={2}
      pageStartIndex={100}
      onSelectSession={() => {}}
      onLoadMore={() => {}}
      onLoadPrevious={() => {}}
      position={1}
      playing={false}
      onPositionChange={() => {}}
      onPlayingChange={() => {}}
    />,
  )

  expect(html).toContain("101–102 / 250")
  expect(html).toContain("RECORDS #101–#102")
  expect(html).toContain("CAPTURE RANGE")
  expect(html).toContain("CAPTURE RANGE 2026/10/27 09:00:00–2026/10/27 09:00:01")
  expect(html).toContain("PAGE END · NEXT PAGE")
  expect(html).toContain("Previous page")
  expect(html).toContain("Next page")
  expect(html).not.toContain("MOCK RECORDING")
})
